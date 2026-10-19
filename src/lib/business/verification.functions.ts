import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

const ENTITY_TYPES = [
  "llc",
  "c_corp",
  "s_corp",
  "partnership",
  "sole_proprietor",
  "nonprofit",
] as const;

export type VerificationOutcome = {
  status: "verified" | "in_review" | "rejected";
  message: string;
};

export type VerificationInput = {
  businessId: string;
  legalName: string;
  entityType: (typeof ENTITY_TYPES)[number];
  formationState: string;
  taxId: string;
  representativeName: string;
  representativeEmail: string;
};

export const submitBusinessVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: VerificationInput) => {
    if (!UUID.test(input.businessId)) throw new Error("Invalid business.");
    const legalName = input.legalName.trim();
    if (legalName.length < 2 || legalName.length > 200)
      throw new Error("Enter the full legal entity name.");
    if (!ENTITY_TYPES.includes(input.entityType)) throw new Error("Select an entity type.");
    const formationState = input.formationState.trim();
    if (formationState.length < 2 || formationState.length > 60)
      throw new Error("Enter the state or region of formation.");
    const taxId = input.taxId.replace(/\D/g, "");
    if (taxId.length !== 9) throw new Error("Enter a 9-digit EIN.");
    const representativeName = input.representativeName.trim();
    if (representativeName.length < 2) throw new Error("Enter the authorized representative.");
    const representativeEmail = input.representativeEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(representativeEmail))
      throw new Error("Enter a valid representative email.");
    return {
      businessId: input.businessId,
      legalName,
      entityType: input.entityType,
      formationState,
      taxId,
      representativeName,
      representativeEmail,
    };
  })
  .handler(async ({ data, context }): Promise<VerificationOutcome> => {
    const { data: canManage, error: canManageError } = await context.supabase.rpc(
      "can_manage_business",
      { _business_id: data.businessId, _user_id: context.userId },
    );
    if (canManageError) throw canManageError;
    if (!canManage) throw new Error("You cannot submit verification for this business.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Paid plan is a precondition: verification is a benefit of a business membership.
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from("membership_subscriptions")
      .select("status, current_period_end, grace_expires_at, tier_key")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    const { hasActiveMembership } = await import("@/lib/conference/entitlements");
    const paid = hasActiveMembership(
      subscription
        ? {
            status: subscription.status as never,
            currentPeriodEnd: subscription.current_period_end,
            graceExpiresAt: subscription.grace_expires_at,
          }
        : null,
    );
    if (!paid) {
      throw new Error("An active business membership is required before verification.");
    }
    const tierKey = typeof subscription?.tier_key === "string" ? subscription.tier_key : "";
    const { data: tier, error: tierError } = tierKey
      ? await supabaseAdmin
          .from("membership_tiers")
          .select("grants_vendor_verification")
          .eq("slug", tierKey)
          .eq("is_active", true)
          .maybeSingle()
      : { data: null, error: null };
    if (tierError) throw tierError;
    if (!tier?.grants_vendor_verification) {
      throw new Error("Your membership plan does not include vendor verification.");
    }

    let reference: string | null = null;
    const outcome: VerificationOutcome = {
      status: "in_review",
      message:
        "Your entity details were received. Accountabul staff review the filing and confirm your verified vendor status shortly.",
    };

    try {
      const { getStripeRuntime } = await import("@/lib/stripe/client.server");
      const { client } = getStripeRuntime();
      const account = await client.accounts.create(
        {
          type: "custom",
          business_type: "company",
          capabilities: { transfers: { requested: true } },
          company: {
            name: data.legalName,
            tax_id: data.taxId,
            ...(data.entityType === "llc"
              ? { structure: "single_member_llc" as const }
              : data.entityType === "nonprofit"
                ? { structure: "incorporated_non_profit" as const }
                : {}),
          },
          email: data.representativeEmail,
          metadata: {
            accountabul_business_id: data.businessId,
            accountabul_formation_state: data.formationState,
            accountabul_representative: data.representativeName,
          },
        },
        { idempotencyKey: `business-verification-${data.businessId}` },
      );
      reference = account.id;
    } catch {
      // Provider outage still leaves a staff-reviewable submission.
    }

    const verifiedPatch = {
      verification_status: "in_review" as const,
      profile_status: "pending_review" as const,
    };

    const patch = {
      legal_name: data.legalName,
      entity_type: data.entityType,
      formation_state: data.formationState,
      tax_id_last4: data.taxId.slice(-4),
      verification_reference: reference,
      verification_checked_at: new Date().toISOString(),
      verification_failure_reason: null,
      ...verifiedPatch,
    };

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update(patch)
      .eq("id", data.businessId);
    if (updateError) throw updateError;

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: context.userId,
      action: `vendor.verification.${outcome.status}`,
      target_table: "businesses",
      target_id: data.businessId,
      diff: {
        entity_type: data.entityType,
        formation_state: data.formationState,
        tax_id_last4_present: true,
        verification_reference: reference,
      },
    });

    return outcome;
  });
