import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { ChatPolicyGate } from "@/components/community-chat/chat-policy";
import {
  useChatPolicy,
  useMyChatRestriction,
} from "@/components/community-chat/use-community-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMUNITY_MESSAGE_MAX_LENGTH,
  validateMessageBody,
  type CommunityRoomSummary,
} from "@/lib/community-chat/chat";
import { postCommunityMessage } from "@/lib/community-chat/community.functions";
import { describeRestriction } from "@/lib/community-chat/safeguards";

export function Composer({ room }: { room: CommunityRoomSummary }) {
  const policy = useChatPolicy();
  const restriction = useMyChatRestriction(room.id);

  if (restriction.data) {
    return (
      <p
        role="status"
        className="shrink-0 border-t border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground"
      >
        {describeRestriction(restriction.data)}
      </p>
    );
  }

  if (policy.data?.needsAcceptance && policy.data.policy) {
    return <ChatPolicyGate policy={policy.data.policy} />;
  }

  return <MessageForm room={room} />;
}

function MessageForm({ room }: { room: CommunityRoomSummary }) {
  const post = useServerFn(postCommunityMessage);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: async (text: string) => {
      const validated = validateMessageBody(text);
      if (!validated.ok) throw new Error(validated.error);
      return post({
        data: { roomId: room.id, body: validated.body, attemptId: crypto.randomUUID() },
      });
    },
    // Clear immediately: the message is live as soon as the server answers.
    onMutate: () => setBody(""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community-messages", room.id] });
    },
    onError: (cause: Error, text) => {
      // Give the text back so a refused send is never lost.
      setBody((current) => current || text);
      toast.error(cause.message);
      // A mute, ban, or policy change may be why; refresh what gates the form.
      void queryClient.invalidateQueries({ queryKey: ["community-chat-restriction"] });
      void queryClient.invalidateQueries({ queryKey: ["community-chat-policy"] });
    },
  });

  const remaining = COMMUNITY_MESSAGE_MAX_LENGTH - body.length;
  const submit = () => {
    if (!send.isPending && body.trim()) send.mutate(body);
  };

  return (
    <form
      className="shrink-0 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={COMMUNITY_MESSAGE_MAX_LENGTH}
        placeholder={`Message ${room.name}`}
        aria-label={`Message ${room.name}`}
        className="resize-none"
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter starts a new line.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Enter sends · Shift + Enter adds a line</p>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${remaining < 40 ? "text-accent" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {remaining}
          </span>
          <Button type="submit" size="sm" disabled={send.isPending || body.trim().length === 0}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </form>
  );
}
