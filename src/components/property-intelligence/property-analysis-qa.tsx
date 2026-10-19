// The ask-a-question panel, the UI half of property-analysis-qa.functions.ts.
//
// The distinction this panel has to make visible, because it is the whole
// point of the routing layer: an answer the system can support from evidence
// looks different from one it cannot. `routePropertyQuestion` decides that
// server-side and reports it as `handlerCanAnswer` plus a list of missing
// sources. Rendering both as the same confident paragraph would turn "we
// don't have the records for this" into what reads like a finding.
//
// Nothing here computes an answer. The component sends a question and a
// workspace id; the answer, the routing decision and the missing-source list
// all come back from the server, which also appends them to an append-only
// audit trail. A client-supplied answer would be a forged trail entry, so
// the server function's validator refuses those fields outright.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askPropertyAnalysisQuestion } from "@/lib/property-intelligence/property-analysis-qa.functions";

type MissingSource = { key: string; label: string; reason: string };

// Mirrors the serializable projection the ask server function returns -- the
// routing trace is deliberately not part of it.
type AskResult = {
  questionId: string;
  answerId: string;
  runId: string;
  question: string;
  answer: string;
  decision: {
    intent: string;
    route: string;
    status: string;
    handlerCanAnswer: boolean;
    validationPassed: boolean;
    missingSources: MissingSource[];
  };
};

function sourceLabel(source: MissingSource, index: number) {
  return source.label || source.key || `source ${index + 1}`;
}

export function PropertyAnalysisQa({ threadId }: { threadId: string }) {
  const ask = useServerFn(askPropertyAnalysisQuestion);
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<AskResult[]>([]);

  const mutation = useMutation({
    mutationFn: () => ask({ data: { threadId, question: question.trim() } }) as Promise<AskResult>,
    onSuccess: (result: AskResult) => {
      // Newest first; the durable record is the server-side trail, not this list.
      setExchanges((current) => [result, ...current]);
      setQuestion("");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "That question could not be answered.");
    },
  });

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Ask about this property</h3>
        <p className="text-sm text-muted-foreground">
          Answers come from the records this workspace has. Every question and answer is recorded.
        </p>
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) mutation.mutate();
        }}
      >
        <Textarea
          rows={3}
          value={question}
          maxLength={1000}
          placeholder="e.g. Are there open permits on this property?"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" disabled={mutation.isPending || !question.trim()}>
          {mutation.isPending ? "Asking…" : "Ask"}
        </Button>
      </form>

      <ul className="space-y-3">
        {exchanges.map((exchange, index) => (
          <li key={exchange.answerId} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{exchange.question}</p>
            <p className="mt-1 text-sm text-muted-foreground">{exchange.answer}</p>
            {exchange.decision.handlerCanAnswer ? null : (
              <div className="mt-2 rounded border border-amber-500/40 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                <p className="font-medium">This could not be answered from the records on file.</p>
                {exchange.decision.missingSources.length > 0 ? (
                  <p className="mt-1">
                    Missing:{" "}
                    {exchange.decision.missingSources
                      .map((source, sourceIndex) => sourceLabel(source, sourceIndex))
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PropertyAnalysisQa;
