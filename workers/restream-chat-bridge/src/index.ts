interface Env {
  RESTREAM_ROOMS: DurableObjectNamespace;
  OPERATIONS_API_KEY: string;
  RESTREAM_BRIDGE_API_KEY: string;
  ACCOUNTABUL_ORIGIN: string;
}

type RoomConfig = {
  accountabulEventId: string;
  restreamEventId: string;
  lastHistoryTimestamp: number;
};

type NormalizedMessage = {
  eventId: string;
  source: string;
  externalId: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  body: string;
  sourceCreatedAt: string;
};

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function operationsBearerMatches(request: Request, expected: string) {
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice("Bearer ".length), expected);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (!operationsBearerMatches(request, env.OPERATIONS_API_KEY)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const eventId = url.searchParams.get("eventId");
    if (!eventId) return new Response("eventId is required", { status: 400 });
    return env.RESTREAM_ROOMS.get(env.RESTREAM_ROOMS.idFromName(eventId)).fetch(request);
  },
};

export class RestreamRoom implements DurableObject {
  private config: RoomConfig | null = null;
  private socket: WebSocket | null = null;
  private lastHeartbeat = 0;
  private tokenCache: { value: string; expiresAt: number } | null = null;
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      this.config = (await this.state.storage.get<RoomConfig>("config")) ?? null;
    });
  }

  async fetch(request: Request) {
    if (request.method === "POST") {
      const value = (await request.json()) as Partial<RoomConfig>;
      if (!value.accountabulEventId || !value.restreamEventId) {
        return new Response("Both event identifiers are required", { status: 400 });
      }
      this.config = {
        accountabulEventId: value.accountabulEventId,
        restreamEventId: value.restreamEventId,
        lastHistoryTimestamp: Math.max(
          0,
          value.lastHistoryTimestamp ?? Math.floor(Date.now() / 1000) - 60,
        ),
      };
      await this.state.storage.put("config", this.config);
      await this.connectRestream();
      return Response.json({ status: "connecting" }, { status: 202 });
    }
    if (request.method === "DELETE") {
      this.socket?.close(1000, "stopped");
      this.socket = null;
      await this.state.storage.deleteAlarm();
      return Response.json({ status: "stopped" });
    }
    return Response.json({
      configured: Boolean(this.config),
      connected: this.socket?.readyState === WebSocket.OPEN,
      lastHeartbeat: this.lastHeartbeat || null,
    });
  }

  async alarm() {
    if (!this.config) return;
    const heartbeatExpired = !this.lastHeartbeat || Date.now() - this.lastHeartbeat > 60_000;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || heartbeatExpired) {
      this.socket?.close(1012, "reconnecting");
      await this.backfill();
      await this.connectRestream();
    }
    await this.state.storage.setAlarm(Date.now() + 30_000);
  }

  private async connectRestream() {
    if (!this.config || this.socket?.readyState === WebSocket.OPEN) return;
    const url = new URL("https://chat.api.restream.io/ws");
    url.searchParams.set("accessToken", await this.accessToken());
    const response = await fetch(url, { headers: { Upgrade: "websocket" } });
    const socket = response.webSocket;
    if (!socket) throw new Error(`Restream WebSocket upgrade failed (${response.status}).`);
    socket.accept();
    this.socket = socket;
    this.lastHeartbeat = Date.now();
    socket.addEventListener("message", (event) => void this.onMessage(String(event.data)));
    socket.addEventListener("close", () => {
      this.socket = null;
      void this.state.storage.setAlarm(Date.now() + 1_000);
    });
    socket.addEventListener("error", () => {
      this.socket = null;
      void this.state.storage.setAlarm(Date.now() + 1_000);
    });
    await this.state.storage.setAlarm(Date.now() + 30_000);
  }

  private async onMessage(raw: string) {
    const action = JSON.parse(raw) as Record<string, unknown>;
    if (action["action"] === "heartbeat") {
      this.lastHeartbeat = Date.now();
      return;
    }
    if (action["action"] !== "event" || !this.config) return;
    const normalized = await normalizeWebSocketAction(action, this.config.accountabulEventId);
    if (normalized) await this.ingest(normalized);
  }

  private async backfill() {
    if (!this.config) return;
    let pageToken: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(
        `https://api.restream.io/v2/user/events/${encodeURIComponent(this.config.restreamEventId)}/chat/history`,
      );
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      else url.searchParams.set("timestamp", String(this.config.lastHistoryTimestamp));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      });
      if (!response.ok) throw new Error(`Restream history failed (${response.status}).`);
      const history = (await response.json()) as {
        messages?: Array<Record<string, unknown>>;
        nextPageToken?: string | null;
      };
      for (const message of history.messages ?? []) {
        const normalized = await normalizeHistoryMessage(message, this.config.accountabulEventId);
        if (normalized) await this.ingest(normalized);
      }
      pageToken = history.nextPageToken ?? null;
      if (!pageToken) return;
    }
    throw new Error("Restream history exceeded the 100-page recovery limit.");
  }

  private async ingest(message: NormalizedMessage) {
    const response = await fetch(
      `${this.env.ACCOUNTABUL_ORIGIN}/api/internal/ops/restream-ingest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPERATIONS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    if (!response.ok) throw new Error(`Accountabul ingest failed (${response.status}).`);
    const timestamp = Math.floor(new Date(message.sourceCreatedAt).getTime() / 1000);
    if (this.config && Number.isFinite(timestamp)) {
      this.config.lastHistoryTimestamp = Math.max(this.config.lastHistoryTimestamp, timestamp);
      await this.state.storage.put("config", this.config);
    }
  }

  private async accessToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.value;
    }
    const response = await fetch(`${this.env.ACCOUNTABUL_ORIGIN}/api/internal/restream-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.RESTREAM_BRIDGE_API_KEY}` },
    });
    if (!response.ok) throw new Error(`Restream token broker failed (${response.status}).`);
    const value = (await response.json()) as { accessToken?: string; expiresAt?: string };
    if (!value.accessToken || !value.expiresAt) {
      throw new Error("Restream token broker returned an invalid response.");
    }
    this.tokenCache = { value: value.accessToken, expiresAt: new Date(value.expiresAt).getTime() };
    return this.tokenCache.value;
  }
}

export async function normalizeWebSocketAction(
  action: Record<string, unknown>,
  eventId: string,
): Promise<NormalizedMessage | null> {
  const payload = action["payload"] as Record<string, unknown> | undefined;
  const eventPayload = payload?.["eventPayload"] as Record<string, unknown> | undefined;
  const text = stringFrom(eventPayload, ["text", "message"]);
  if (!payload || !eventPayload || !text) return null;
  const timestamp =
    typeof action["timestamp"] === "number" ? action["timestamp"] : Date.now() / 1000;
  const sourceCreatedAt = new Date(timestamp * 1000).toISOString();
  const platform = platformForEventSource(payload["eventSourceId"]);
  const author = (eventPayload["author"] as Record<string, unknown> | undefined) ?? {};
  const seed = JSON.stringify([
    payload["connectionIdentifier"],
    payload["eventIdentifier"],
    timestamp,
    text,
  ]);
  return {
    eventId,
    source: sourceFor(platform),
    externalId: await sha256(seed),
    authorDisplayName: stringFrom(author, ["displayName", "name", "username"]) || "External guest",
    authorAvatarUrl: stringFrom(author, ["avatar", "avatarUrl", "picture"]) || null,
    body: text,
    sourceCreatedAt,
  };
}

export async function normalizeHistoryMessage(
  message: Record<string, unknown>,
  eventId: string,
): Promise<NormalizedMessage | null> {
  const text = typeof message["text"] === "string" ? message["text"].trim() : "";
  const timestamp = typeof message["timestamp"] === "string" ? message["timestamp"] : "";
  if (!text || !timestamp) return null;
  const seed = JSON.stringify([
    timestamp,
    message["platform"],
    message["channelName"],
    message["author"],
    text,
  ]);
  return {
    eventId,
    source: sourceFor(String(message["platform"] ?? "restream")),
    externalId: await sha256(seed),
    authorDisplayName: String(message["author"] ?? "External guest"),
    authorAvatarUrl: null,
    body: text,
    sourceCreatedAt: timestamp,
  };
}

function sourceFor(platform: string) {
  const value = platform.toLowerCase();
  if (value.includes("youtube")) return "youtube";
  if (value.includes("facebook")) return "facebook";
  if (value.includes("linkedin")) return "linkedin";
  if (value.includes("twitch")) return "twitch";
  if (value === "x" || value.includes("twitter")) return "x";
  return "restream";
}

export function platformForEventSource(value: unknown) {
  if (value === 2) return "twitch";
  if (value === 13) return "youtube";
  if (value === 19 || value === 20) return "facebook";
  if (value === 26) return "linkedin";
  if (value === 28) return "x";
  return "restream";
}

function stringFrom(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) if (typeof record?.[key] === "string") return record[key] as string;
  return "";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
