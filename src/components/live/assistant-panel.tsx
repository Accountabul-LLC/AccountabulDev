import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSISTANT_MAX_QUESTION, type AssistantTurn } from "@/lib/live/assistant";
import { askLiveAssistant } from "@/lib/live/assistant.functions";

/**
 * Side-panel lookups. The person stays on the event page, so the video and the
 * room chat keep running while they ask.
 */
export function AssistantPanel({ eventId }: { eventId: string }) {
  const ask = useServerFn(askLiveAssistant);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async () => {
      const asked = question.trim();
      const result = await ask({ data: { eventId, question: asked, history: turns } });
      return { asked, answer: result.answer };
    },
    onSuccess: ({ asked, answer }) => {
      setTurns((current) => [
        ...current,
        { role: "user", content: asked },
        { role: "assistant", content: answer },
      ]);
      setQuestion("");
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask a quick question about this event or about Accountabul. Answers appear here without
            interrupting the stream.
          </p>
        ) : null}
        {turns.map((turn, index) => (
          <div
            key={`${turn.role}-${index}`}
            className={
              turn.role === "user"
                ? "rounded-md bg-muted/60 px-3 py-2 text-sm"
                : "rounded-md border border-border px-3 py-2 text-sm leading-relaxed"
            }
          >
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {turn.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="whitespace-pre-line">{turn.content}</p>
          </div>
        ))}
        {send.isPending ? <p className="text-sm text-muted-foreground">Looking that up…</p> : null}
        {send.isError ? (
          <p className="text-sm text-destructive">
            {send.error instanceof Error ? send.error.message : "That lookup failed."}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim() || send.isPending) return;
          send.mutate();
        }}
      >
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this event"
          maxLength={ASSISTANT_MAX_QUESTION}
          aria-label="Question for the room assistant"
        />
        <Button type="submit" disabled={send.isPending || !question.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
