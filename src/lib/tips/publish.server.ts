import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Text } from "@/lib/conference/moderation";
import { formatTipChatBody } from "@/lib/tips/speech";

export async function publishPaidTipChat(input: { tipId: string; paymentRecordId: string }) {
  const { data: tip, error: tipError } = await supabaseAdmin
    .from("tips")
    .select(
      "id, event_id, amount_minor, currency, message, guest_display_name, from_user_id, status",
    )
    .eq("id", input.tipId)
    .single();
  if (tipError) throw tipError;
  if (!tip.event_id) throw new Error("Paid tip is missing its event.");
  const displayName =
    typeof tip.guest_display_name === "string" && tip.guest_display_name.trim()
      ? tip.guest_display_name.trim()
      : "Guest";
  const message = typeof tip.message === "string" ? tip.message.trim() : "";
  if (!message) throw new Error("Paid tip is missing its locked message.");
  const body = formatTipChatBody({
    displayName,
    amountMinor: tip.amount_minor,
    message,
    currency: tip.currency,
  });
  const contentSha256 = await sha256Text(body);

  const { data: messageRow, error: messageError } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      event_id: tip.event_id,
      user_id: tip.from_user_id,
      body,
      kind: "tip",
      source: "accountabul",
      external_id: input.paymentRecordId,
      author_display_name: displayName,
      author_badge: tip.from_user_id ? "accountabul_member" : "event_guest",
      moderation_status: "approved",
      content_sha256: contentSha256,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (messageError && messageError.code !== "23505") throw messageError;
  if (messageError?.code === "23505") return;
  if (!messageRow) throw new Error("Tip chat message was not stored.");
}
