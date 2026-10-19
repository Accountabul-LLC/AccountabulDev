import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { reportCommunityMessage } from "@/lib/community-chat/community.functions";
import {
  REPORT_CATEGORIES,
  REPORT_DETAIL_MAX_LENGTH,
  type FlagCategory,
} from "@/lib/community-chat/safeguards";

export function ReportMessageButton({
  messageId,
  roomId,
  authorLabel,
}: {
  messageId: string;
  roomId: string;
  authorLabel: string;
}) {
  const report = useServerFn(reportCommunityMessage);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FlagCategory | "">("");
  const [detail, setDetail] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      report({ data: { messageId, category: category as FlagCategory, detail: detail.trim() } }),
    onSuccess: (result) => {
      toast.success(
        result.alreadyReported
          ? "You already reported this message."
          : "Thanks. Accountabul staff will review it.",
      );
      setOpen(false);
      setCategory("");
      setDetail("");
      // Enough reports can hide the message; refresh so it disappears if so.
      void queryClient.invalidateQueries({ queryKey: ["community-messages", roomId] });
    },
    onError: (cause: Error) => toast.error(cause.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2"
          aria-label={`Report message from ${authorLabel}`}
          title="Report message"
        >
          <Flag className="size-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report message</DialogTitle>
          <DialogDescription>
            Reports go to Accountabul staff. The author is not told who reported them.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (category) submit.mutate();
          }}
        >
          <RadioGroup
            value={category}
            onValueChange={(value) => setCategory(value as FlagCategory)}
            aria-label="Reason"
            className="gap-2"
          >
            {REPORT_CATEGORIES.map((entry) => (
              <div key={entry.value} className="flex items-center gap-2">
                <RadioGroupItem value={entry.value} id={`report-${messageId}-${entry.value}`} />
                <Label htmlFor={`report-${messageId}-${entry.value}`} className="font-normal">
                  {entry.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor={`report-detail-${messageId}`}>
              Anything staff should know? (optional)
            </Label>
            <Textarea
              id={`report-detail-${messageId}`}
              rows={2}
              maxLength={REPORT_DETAIL_MAX_LENGTH}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!category || submit.isPending}>
              {submit.isPending ? "Sending…" : "Send report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
