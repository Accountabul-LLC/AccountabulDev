export const BUSINESS_WORKSPACE_MANAGEMENT_ROLES = ["owner", "manager"] as const;

/**
 * Owner and manager are the only business-membership roles that can change
 * the business profile, services, or property-listing drafts.
 *
 * The UI uses this for truthful controls; Postgres RLS remains authoritative.
 */
export function canManageBusinessWorkspace(role: string | null | undefined) {
  return BUSINESS_WORKSPACE_MANAGEMENT_ROLES.includes(
    role as (typeof BUSINESS_WORKSPACE_MANAGEMENT_ROLES)[number],
  );
}
