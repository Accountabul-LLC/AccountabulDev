import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { INQUIRY_LIMITS, normalizeInquiryInput } from "@/lib/inquiry";

export function ServiceInquiryForm({
  businessId,
  serviceId,
}: {
  businessId: string;
  serviceId: string;
}) {
  const { session } = useSession();
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    message: "",
  });
  const submit = useMutation({
    mutationFn: async () => {
      const inquiry = normalizeInquiryInput(form);
      const { error } = await supabase.from("service_inquiries").insert({
        business_id: businessId,
        service_id: serviceId,
        ...inquiry,
        from_user_id: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ contact_name: "", contact_email: "", contact_phone: "", message: "" });
      toast.success("Request sent to the business.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <Input
        placeholder="Your name"
        aria-label="Your name"
        maxLength={INQUIRY_LIMITS.contactName}
        required
        value={form.contact_name}
        onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
      />
      <Input
        type="email"
        placeholder="Email"
        aria-label="Email"
        maxLength={INQUIRY_LIMITS.contactEmail}
        required
        value={form.contact_email}
        onChange={(event) => setForm({ ...form, contact_email: event.target.value })}
      />
      <Input
        placeholder="Phone (optional)"
        aria-label="Phone"
        maxLength={INQUIRY_LIMITS.contactPhone}
        value={form.contact_phone}
        onChange={(event) => setForm({ ...form, contact_phone: event.target.value })}
      />
      <Textarea
        placeholder="What do you need?"
        aria-label="Message"
        rows={3}
        maxLength={INQUIRY_LIMITS.message}
        required
        value={form.message}
        onChange={(event) => setForm({ ...form, message: event.target.value })}
      />
      <Button type="submit" size="sm" disabled={submit.isPending}>
        {submit.isPending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
