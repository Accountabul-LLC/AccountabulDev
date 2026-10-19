import { MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shown while a signed-in user has not confirmed their email yet.
 * Onboarding still works; this only explains the pending state and offers a resend.
 */
export function VerifyEmailNotice({ next }: { next: string }) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);

  const email = session?.user.email ?? "";
  const confirmed = Boolean(session?.user.email_confirmed_at);
  if (!session || confirmed) return null;

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("A new verification link is on the way.");
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
      <MailCheck className="h-5 w-5 shrink-0 text-accent" aria-hidden />
      <p className="flex-1 text-muted-foreground">
        We sent a verification link to <span className="font-medium text-foreground">{email}</span>.
        Confirm it to finish setting up your account — you can keep filling this out in the
        meantime.
      </p>
      <Button variant="outline" size="sm" onClick={resend} disabled={busy}>
        {busy ? "Sending…" : "Resend link"}
      </Button>
    </div>
  );
}
