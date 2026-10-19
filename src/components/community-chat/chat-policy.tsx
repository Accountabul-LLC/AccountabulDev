import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { useChatPolicy } from "@/components/community-chat/use-community-chat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ChatPolicy } from "@/lib/community-chat/chat";
import { acceptCommunityChatPolicy } from "@/lib/community-chat/community.functions";

/** Renders the policy body: paragraphs, with **bold** lead-ins. */
function PolicyBody({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {markdown.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>
          {paragraph
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, partIndex) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={partIndex}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            )}
        </p>
      ))}
    </div>
  );
}

function FullPolicyDialog({ policy, trigger }: { policy: ChatPolicy; trigger: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{policy.title}</DialogTitle>
          <DialogDescription>Version {policy.version}</DialogDescription>
        </DialogHeader>
        <PolicyBody markdown={policy.body_markdown} />
      </DialogContent>
    </Dialog>
  );
}

/** Shown in place of the composer until the member accepts the current policy. */
export function ChatPolicyGate({ policy }: { policy: ChatPolicy }) {
  const accept = useServerFn(acceptCommunityChatPolicy);
  const queryClient = useQueryClient();

  const agree = useMutation({
    mutationFn: () => accept({ data: { policyVersionId: policy.id } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["community-chat-policy"] }),
    onError: (cause: Error) => toast.error(cause.message),
  });

  return (
    <section
      aria-labelledby="chat-policy-gate-title"
      className="shrink-0 border-t border-border bg-secondary/30 p-4"
    >
      <h3 id="chat-policy-gate-title" className="text-sm font-semibold">
        Before you post: {policy.title}
      </h3>
      <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        {policy.summary.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => agree.mutate()} disabled={agree.isPending}>
          {agree.isPending ? "Saving…" : "I agree — start chatting"}
        </Button>
        <FullPolicyDialog
          policy={policy}
          trigger={
            <button type="button" className="text-sm text-accent underline">
              Read the full policy
            </button>
          }
        />
      </div>
    </section>
  );
}

/** A quiet link to the current policy, for rooms where the member already agreed. */
export function ChatPolicyLink() {
  const policy = useChatPolicy();
  if (!policy.data?.policy) return null;
  return (
    <FullPolicyDialog
      policy={policy.data.policy}
      trigger={
        <button type="button" className="text-xs text-muted-foreground underline">
          {policy.data.policy.title}
        </button>
      }
    />
  );
}
