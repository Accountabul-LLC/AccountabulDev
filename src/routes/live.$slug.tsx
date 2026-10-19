import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession, useRoles } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { createEventPassCheckout } from "@/lib/billing/billing.functions";
import {
  getConferencePlayback,
  joinLiveMedia,
  requestSpeakerAccess,
} from "@/lib/conference/conference.functions";
import { getEventAccessOffers } from "@/lib/conference/live-chat.functions";
import { AssistantPanel } from "@/components/live/assistant-panel";
import { LiveChatPanel } from "@/components/live/live-chat-panel";
import { useLiveDock } from "@/components/live/live-dock-context";
import { Countdown } from "@/components/live/countdown";
import { canHostLiveStudio } from "@/lib/conference/studio";
import { formatDateTime, formatMoney } from "@/lib/format";
import { eventAcceptsTips } from "@/lib/tips/eligibility";
import { createTipIntent } from "@/lib/tips.functions";

export const Route = createFileRoute("/live/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Live room ${params.slug} — Accountabul` },
      {
        name: "description",
        content: "Watch the Accountabul conference room, join the chat, and tip the host.",
      },
      { property: "og:title", content: `Live room ${params.slug} — Accountabul` },
      {
        property: "og:description",
        content: "Watch the Accountabul conference room, join the chat, and tip the host.",
      },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LiveRoomPage,
});

function LiveRoomPage() {
  const { slug } = Route.useParams();
  const { session } = useSession();
  const roles = useRoles();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const isHost = canHostLiveStudio(roles.data ?? []);

  const event = useQuery({
    queryKey: ["event", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id, slug, title, description, status, scheduled_start_at, ended_at, chat_enabled, tips_enabled, host_business_id, access_mode, pass_price_minor, pass_currency, speaker_requests_enabled",
        )
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const e = event.data;

  const standards = useQuery({
    queryKey: ["community-standards", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_standards_versions")
        .select("id, version, title, body_markdown, published_at")
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const playback = useServerFn(getConferencePlayback);
  const stream = useQuery({
    queryKey: ["event-stream", e?.id, userId],
    enabled: Boolean(e?.id),
    queryFn: () => playback({ data: e!.id }),
    // Poll hard while the countdown is running so the room opens on time.
    refetchInterval: (query) =>
      query.state.data?.phase === "counting_down" || query.state.data?.phase === "idle"
        ? 5_000
        : 30_000,
  });

  const joinMedia = useServerFn(joinLiveMedia);
  const phase = stream.data?.phase;
  const canWatch = stream.data?.entitlement.canWatch === true;

  // A viewer token is only ever minted for a room that is already public.
  const media = useQuery({
    queryKey: ["live-media", e?.id, userId],
    enabled: Boolean(e?.id && userId) && phase === "live" && canWatch,
    queryFn: () => joinMedia({ data: e!.id }),
    retry: false,
    staleTime: Infinity,
  });

  // The room itself is mounted above the router by LiveDockProvider, so it
  // survives navigation. This page only lends it a container to render into.
  const { openSession, setStageTarget } = useLiveDock();

  useEffect(() => {
    if (!e || !media.data || phase !== "live" || !canWatch) return;
    openSession({
      eventId: e.id,
      slug: e.slug,
      title: e.title,
      authToken: media.data.authToken,
    });
  }, [e, media.data, phase, canWatch, openSession]);

  // A callback ref hands the player box over on mount and releases it on
  // unmount, which is exactly when the video should fall back to the dock.
  const stageRef = useCallback(
    (node: HTMLDivElement | null) => setStageTarget(node),
    [setStageTarget],
  );

  const reminder = useQuery({
    queryKey: ["reminder", userId, e?.id],
    enabled: Boolean(userId && e?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_reminders")
        .select("id")
        .eq("user_id", userId!)
        .eq("event_id", e!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggleReminder = useMutation({
    mutationFn: async () => {
      if (!userId || !e) throw new Error("Sign in to set a reminder.");
      if (reminder.data) {
        const { error } = await supabase
          .from("event_reminders")
          .delete()
          .eq("id", reminder.data.id);
        if (error) throw error;
        return false;
      }
      const { error } = await supabase
        .from("event_reminders")
        .insert({ user_id: userId, event_id: e.id });
      if (error) throw error;
      return true;
    },
    onSuccess: (on) => {
      toast.success(on ? "Reminder set." : "Reminder removed.");
      void queryClient.invalidateQueries({ queryKey: ["reminder"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (event.isLoading) return <PageShell title="Loading room" description="Fetching this event." />;

  if (!e) {
    return (
      <PageShell
        eyebrow="Conference room"
        title="Event not found"
        description="This room does not exist or was canceled."
      >
        <Link to="/live" className="text-sm text-accent underline">
          Back to live events
        </Link>
      </PageShell>
    );
  }

  const playable = stream.data?.playbackUrl ?? null;
  const streamable = e.status === "live" || e.status === "replay_available";

  return (
    <PageShell
      eyebrow={e.status.replace("_", " ")}
      title={e.title}
      description={formatDateTime(e.scheduled_start_at)}
    >
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-[#07100f]">
            {phase === "counting_down" && canWatch && stream.data?.startsAt ? (
              <Countdown startsAt={stream.data.startsAt} onComplete={() => void stream.refetch()} />
            ) : phase === "live" && canWatch && media.data ? (
              <div ref={stageRef} className="size-full p-2" />
            ) : playable ? (
              <iframe
                src={playable}
                title={e.title}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                className="size-full"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
                <span
                  className="grid size-16 place-items-center rounded-full border border-white/25 bg-white/10 text-white/90 backdrop-blur-sm"
                  aria-hidden="true"
                >
                  <Play size={26} className="ml-1" fill="currentColor" />
                </span>
                <p className="font-medium text-white">
                  {streamable && !stream.data?.entitlement.canWatch
                    ? (stream.data?.entitlement.reason ?? "Access is required to watch this room")
                    : e.status === "scheduled"
                      ? "This room has not started yet"
                      : "The stream has ended"}
                </p>
                <p className="max-w-md text-sm text-white/65">
                  {streamable && !stream.data?.entitlement.canWatch
                    ? "Membership and pass access are verified by the server before playback is released."
                    : e.status === "scheduled"
                      ? "Set a reminder and the room will open here when it goes live."
                      : "A replay appears here when the recording is published."}
                </p>
                {streamable && !stream.data?.entitlement.canWatch ? (
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button asChild size="sm">
                      <Link to="/pricing">Become a member</Link>
                    </Button>
                    {stream.data?.requiresSignIn ? (
                      <Link to="/login" search={{}} className="text-sm text-white underline">
                        Already a member? Sign in
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <section className="surface-card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              About this room
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
              {e.description ?? "No description provided."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild variant="outline" size="sm">
                {/* The room keeps playing in the dock while the tool is open. */}
                <Link to="/tools/deal-calculator">Open deal calculator</Link>
              </Button>
              <Button
                variant="secondary"
                disabled={!userId || toggleReminder.isPending}
                onClick={() => toggleReminder.mutate()}
              >
                {reminder.data ? "Remove reminder" : "Remind me"}
              </Button>
              {!userId ? (
                <Link to="/login" search={{}} className="self-center text-sm text-accent underline">
                  Sign in to participate
                </Link>
              ) : null}
              {isHost ? (
                <Button asChild variant="outline" size="sm">
                  <Link to="/live/$slug/studio" params={{ slug }}>
                    Open studio
                  </Link>
                </Button>
              ) : null}
            </div>
            {e.access_mode !== "public" && !stream.data?.entitlement.canWatch ? (
              <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
                <h3 className="text-sm font-semibold">Membership unlocks this room</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Members watch every live room and replay, and chat for free. Plans start at
                  $16/month.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/pricing">View membership plans</Link>
                </Button>
              </div>
            ) : null}
            {e.access_mode === "subscriber_or_pass" && !stream.data?.entitlement.canWatch ? (
              <PassCheckoutButton eventId={e.id} eventSlug={e.slug} />
            ) : null}
          </section>

          {e.speaker_requests_enabled && userId ? <SpeakerRequestPanel eventId={e.id} /> : null}

          {eventAcceptsTips(e) ? <TipPanel eventId={e.id} /> : null}
        </div>

        {e.chat_enabled ? (
          <aside className="surface-card flex h-[32rem] flex-col p-6 lg:h-[40rem]">
            <Tabs defaultValue="chat" className="flex h-full flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="chat" className="flex-1">
                  Room chat
                </TabsTrigger>
                <TabsTrigger value="assistant" className="flex-1">
                  Ask
                </TabsTrigger>
              </TabsList>
              <TabsContent value="chat" className="mt-4 min-h-0 flex-1">
                <LiveChatPanel
                  eventId={e.id}
                  eventSlug={e.slug}
                  standards={standards.data ?? null}
                />
              </TabsContent>
              <TabsContent value="assistant" className="mt-4 min-h-0 flex-1">
                <AssistantPanel eventId={e.id} />
              </TabsContent>
            </Tabs>
          </aside>
        ) : (
          <aside className="surface-card p-6">
            <h2 className="font-semibold">Chat is off</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The host disabled chat for this room.
            </p>
          </aside>
        )}
      </div>
    </PageShell>
  );
}

/**
 * Watch and watch+chat, each at whatever this event is actually configured to
 * charge — fetched from getEventAccessOffers, the same pricing module the
 * backend uses to decide what a purchase is allowed to cost. An access type
 * this event does not sell simply does not render a button for it.
 */
function PassCheckoutButton({ eventId, eventSlug }: { eventId: string; eventSlug: string }) {
  const { session } = useSession();
  const [email, setEmail] = useState("");
  const [pendingType, setPendingType] = useState<"watch" | "watch_and_chat" | null>(null);
  const getOffers = useServerFn(getEventAccessOffers);
  const checkout = useServerFn(createEventPassCheckout);

  const offers = useQuery({
    queryKey: ["event-access-offers", eventId],
    queryFn: () => getOffers({ data: eventId }),
  });

  const start = useMutation({
    mutationFn: async (accessType: "watch" | "watch_and_chat") => {
      setPendingType(accessType);
      const attemptId = crypto.randomUUID();
      if (session) return checkout({ data: { eventId, accessType, attemptId } });
      const response = await fetch("/api/public/event-passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, accessType, attemptId, email }),
      });
      const result = (await response.json()) as {
        checkoutUrl?: string;
        granted?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Checkout could not be started.");
      return { checkoutUrl: result.checkoutUrl ?? null, granted: result.granted === true };
    },
    onSuccess: (result) => {
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else if (result.granted) {
        toast.success("Access granted — refresh to watch.");
        window.location.reload();
      }
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setPendingType(null),
  });

  const watch = offers.data?.watch;
  const watchAndChat = offers.data?.watchAndChat;
  if (offers.isPending || (!watch && !watchAndChat)) return null;

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-border bg-secondary/40 p-4 sm:grid-cols-2">
      {[
        { type: "watch" as const, label: "Watch Event", offer: watch },
        { type: "watch_and_chat" as const, label: "Watch + Chat", offer: watchAndChat },
      ].map(({ type, label, offer }) =>
        offer ? (
          <div key={type} className="rounded-md border border-border bg-background p-3">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-lg font-semibold">
              {offer.free ? "Free" : formatMoney(offer.amountMinor, offer.currency)}
            </p>
            {!session ? (
              <Input
                className="mt-2"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                placeholder="Your email"
                aria-label={`Email for ${label.toLowerCase()}`}
              />
            ) : null}
            <Button
              className="mt-2 w-full"
              size="sm"
              disabled={start.isPending || (!session && !email)}
              onClick={() => start.mutate(type)}
            >
              {start.isPending && pendingType === type
                ? "Starting…"
                : type === "watch"
                  ? "Get Access"
                  : "Join & Chat"}
            </Button>
          </div>
        ) : null,
      )}
    </div>
  );
}

function SpeakerRequestPanel({ eventId }: { eventId: string }) {
  const [topic, setTopic] = useState("");
  const request = useServerFn(requestSpeakerAccess);
  const submit = useMutation({
    mutationFn: () => request({ data: { eventId, topic } }),
    onSuccess: () => {
      setTopic("");
      toast.success("Speaker request sent for staff review.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="surface-card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Request to speak
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Active subscribers can request protected backstage access. Approval does not put you on
        screen automatically.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <Input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          maxLength={500}
          placeholder="What would you like to discuss?"
        />
        <Button type="submit" disabled={submit.isPending}>
          Request
        </Button>
      </form>
    </section>
  );
}

type UsdcQuote = {
  depositAddress: string;
  exactAssetAmount: string;
  network: string;
  expiresAt: string;
  qrPayload: string;
  asset: "USDC";
};

type TipCheckoutResult = {
  tipId: string;
  status: string;
  checkoutUrl: string | null;
  quote: UsdcQuote | null;
  note: string;
};

function TipPanel({ eventId }: { eventId: string }) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [amount, setAmount] = useState("10");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"stripe" | "usdc">("stripe");
  const [quote, setQuote] = useState<UsdcQuote | null>(null);
  const tip = useServerFn(createTipIntent);

  const submit = useMutation({
    mutationFn: async ({
      attemptId,
      submittedAmount,
      submittedName,
      submittedMessage,
      submittedMethod,
    }: {
      attemptId: string;
      submittedAmount: string;
      submittedName: string;
      submittedMessage: string;
      submittedMethod: "stripe" | "usdc";
    }) => {
      const dollars = Number(submittedAmount.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(dollars) || dollars < 1)
        throw new Error("Enter an amount of $1 or more.");
      if (!submittedName.trim()) throw new Error("Enter the name to show with this tip.");
      if (!submittedMessage.trim()) throw new Error("Enter a message to show with this tip.");
      const amountMinor = Math.round(dollars * 100);
      if (userId) {
        return tip({
          data: {
            eventId,
            amountMinor,
            attemptId,
            displayName: submittedName,
            message: submittedMessage,
            method: submittedMethod,
          },
        });
      }
      const response = await fetch("/api/public/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          amountMinor,
          attemptId,
          displayName: submittedName,
          message: submittedMessage,
          method: submittedMethod,
          email,
        }),
      });
      const result = (await response.json()) as TipCheckoutResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Tip checkout could not be started.");
      return result;
    },
    onSuccess: (result) => {
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      if (result.quote) {
        setQuote(result.quote);
        toast.success("Send the exact USDC amount. Your name and message post after confirmation.");
        return;
      }
      toast.success(
        `Tip of ${formatMoney(Math.round(Number(amount) * 100))} recorded. ${result.note}`,
      );
      setMessage("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="surface-card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Tip the host
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Name and message are required. Tips are confirmed by the payment provider. Nothing is marked
        paid from your browser.
      </p>
      {quote ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Send exactly <span className="font-medium">{quote.exactAssetAmount} USDC</span> on{" "}
            {quote.network} before {formatDateTime(quote.expiresAt)}.
          </p>
          <p className="break-all font-mono text-xs">{quote.depositAddress}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(quote.depositAddress)}
          >
            Copy address
          </Button>
        </div>
      ) : null}
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate({
            attemptId: crypto.randomUUID(),
            submittedAmount: amount,
            submittedName: displayName,
            submittedMessage: message,
            submittedMethod: method,
          });
        }}
      >
        <Input
          className="w-28"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          required
          aria-label="Tip amount in dollars"
        />
        <Input
          className="min-w-[10rem] flex-1"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={80}
          placeholder="Your name on the stream"
          aria-label="Display name for this tip"
        />
        <Input
          className="min-w-[12rem] flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          maxLength={280}
          placeholder="Message shown with the tip"
          aria-label="Tip message"
        />
        {!userId ? (
          <Input
            className="min-w-[12rem] flex-1"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            placeholder="Email for receipt"
            aria-label="Email for tip receipt"
          />
        ) : null}
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">Tip payment method</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="tip-method"
              checked={method === "stripe"}
              onChange={() => setMethod("stripe")}
            />
            Card
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="tip-method"
              checked={method === "usdc"}
              onChange={() => setMethod("usdc")}
            />
            USDC
          </label>
        </fieldset>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? "Starting…" : method === "usdc" ? "Get USDC address" : "Send tip"}
        </Button>
      </form>
      {!userId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          You can tip without creating an account.
        </p>
      ) : null}
    </section>
  );
}
