import {
  normalizeYouTubeChatMessage,
  type NormalizedChatMessage,
} from "../chat-adapters/normalize.ts";

// Network and sink are injected so the whole loop runs against fixtures in tests.
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;
export type IngestFn = (message: NormalizedChatMessage) => Promise<void>;

const API = "https://www.googleapis.com/youtube/v3";
// YouTube bills liveChatMessages.list at 5 units against a 10,000/day default quota,
// so never poll faster than this even if the API suggests it.
const MIN_INTERVAL_MS = 5_000;

export type ChatPage = {
  items: unknown[];
  nextPageToken: string | null;
  pollingIntervalMillis: number;
};

async function getJson(fetchFn: FetchLike, url: string, accessToken: string) {
  const response = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YouTube API request failed (${response.status}).`);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * The liveChatId of `channelId`'s active broadcast, or null. A broadcast from any
 * other channel is refused so one mapping can never ingest another channel's chat.
 */
export async function findActiveLiveChatId(
  fetchFn: FetchLike,
  accessToken: string,
  channelId: string,
) {
  if (!channelId) return null;
  const body = await getJson(
    fetchFn,
    `${API}/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all`,
    accessToken,
  );
  const items = Array.isArray(body["items"]) ? (body["items"] as Record<string, unknown>[]) : [];
  for (const item of items) {
    const snippet = item["snippet"] as Record<string, unknown> | undefined;
    if (snippet?.["channelId"] === channelId && typeof snippet["liveChatId"] === "string") {
      return snippet["liveChatId"];
    }
  }
  return null;
}

export async function fetchChatPage(
  fetchFn: FetchLike,
  accessToken: string,
  liveChatId: string,
  pageToken: string | null,
): Promise<ChatPage> {
  const url = new URL(`${API}/liveChat/messages`);
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const body = await getJson(fetchFn, url.toString(), accessToken);
  const interval = body["pollingIntervalMillis"];
  return {
    items: Array.isArray(body["items"]) ? body["items"] : [],
    nextPageToken: typeof body["nextPageToken"] === "string" ? body["nextPageToken"] : null,
    pollingIntervalMillis:
      typeof interval === "number" ? Math.max(interval, MIN_INTERVAL_MS) : MIN_INTERVAL_MS,
  };
}

/** One poll cycle: fetch a page, normalize, hand each text message to `ingest`. */
export async function pollOnce(options: {
  fetchFn: FetchLike;
  accessToken: string;
  liveChatId: string;
  eventId: string;
  pageToken: string | null;
  ingest: IngestFn;
}) {
  const page = await fetchChatPage(
    options.fetchFn,
    options.accessToken,
    options.liveChatId,
    options.pageToken,
  );
  let ingested = 0;
  let failed = 0;
  for (const item of page.items) {
    const message = normalizeYouTubeChatMessage(item, options.eventId);
    if (!message) continue;
    // One failing message must not pin the cursor; it stays unpublished (fail closed).
    try {
      await options.ingest(message);
      ingested += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    ingested,
    failed,
    // Keep the old token if the API returned none so we never rewind or drop the cursor.
    nextPageToken: page.nextPageToken ?? options.pageToken,
    waitMs: page.pollingIntervalMillis,
  };
}
