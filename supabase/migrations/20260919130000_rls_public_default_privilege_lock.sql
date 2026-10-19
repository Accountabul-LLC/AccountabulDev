-- ACC-20260919-005 / 006 root cause.
-- CREATE TABLE in public inherits ALTER DEFAULT PRIVILEGES GRANT ALL
-- (including TRUNCATE) to anon and authenticated. The hop-on grant lock
-- revoked the live table ACLs; this stops the next table created by
-- postgres from getting the same leak. Existing grants are unchanged.
-- Future postgres-created tables fail closed until a migration names an
-- explicit GRANT.
--
-- supabase_admin default ACLs still grant ALL to anon/authenticated.
-- MCP cannot ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin (42501).
-- Owner must run that revoke in the dashboard SQL editor as a superuser.

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
