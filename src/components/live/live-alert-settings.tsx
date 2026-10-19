import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAlertPreferences, saveAlertPreferences } from "@/lib/live/alert-preferences.functions";
import type { AlertPreferencesInput } from "@/lib/live/alerts";

/**
 * Where people choose how they hear that a room went live. Text alerts use
 * their own number and their own checkbox; a phone on the profile is never
 * treated as consent.
 */
export function LiveAlertSettings() {
  const queryClient = useQueryClient();
  const load = useServerFn(getAlertPreferences);
  const save = useServerFn(saveAlertPreferences);

  const preferences = useQuery({ queryKey: ["live-alert-preferences"], queryFn: () => load() });
  const [form, setForm] = useState<AlertPreferencesInput>({
    emailOptIn: true,
    smsOptIn: false,
    smsPhone: null,
  });

  useEffect(() => {
    if (preferences.data) setForm(preferences.data);
  }, [preferences.data]);

  const submit = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: (saved) => {
      setForm(saved);
      void queryClient.invalidateQueries({ queryKey: ["live-alert-preferences"] });
      toast.success("Live alert settings saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="surface-card mt-6 grid gap-4 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Live event alerts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how we tell you a live room is scheduled or starting. You always see the in-app
          banner while a room is live.
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.emailOptIn}
          onChange={(event) => setForm({ ...form, emailOptIn: event.target.checked })}
        />
        <span>
          <span className="font-medium">Email me</span> when a room is scheduled and when it goes
          live.
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.smsOptIn}
          onChange={(event) => setForm({ ...form, smsOptIn: event.target.checked })}
        />
        <span>
          <span className="font-medium">Text me</span> when a room is scheduled and when it goes
          live. Message and data rates may apply. Reply STOP to any alert to opt out.
        </span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Mobile number for text alerts</span>
        <Input
          type="tel"
          inputMode="tel"
          placeholder="+15555550123"
          value={form.smsPhone ?? ""}
          onChange={(event) => setForm({ ...form, smsPhone: event.target.value || null })}
        />
      </label>

      <div>
        <Button type="submit" disabled={submit.isPending || preferences.isLoading}>
          {submit.isPending ? "Saving…" : "Save alert settings"}
        </Button>
      </div>
    </form>
  );
}
