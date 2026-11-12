-- Seven functions in the private schema could be executed by anyone, including a visitor who is not signed in.
-- Six are trigger functions, which cannot be called directly, and one only formats a number, so nothing was exposed.
-- They are closed all the same, so that no function in the private schema is open to anon.
-- supabase/tests/phase1.sql checks this.
revoke all on function private.enforce_requisition_type() from public, anon, authenticated, service_role;
revoke all on function private.enforce_source_line() from public, anon, authenticated, service_role;
revoke all on function private.guard_access_point_settings() from public, anon, authenticated, service_role;
revoke all on function private.guard_ai_actions_enabled() from public, anon, authenticated, service_role;
revoke all on function private.guard_ai_log_answers() from public, anon, authenticated, service_role;
revoke all on function private.guard_ai_settings() from public, anon, authenticated, service_role;
revoke all on function private.plain_quantity(numeric) from public, anon, authenticated, service_role;
