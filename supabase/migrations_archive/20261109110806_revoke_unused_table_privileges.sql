-- Supabase grants every privilege on a new table to anon and authenticated. The API only uses select, insert, update
-- and delete, and row level security covers those. TRUNCATE skips row level security, and REFERENCES and TRIGGER are
-- never needed by a signed in person, so they are removed from every table and from the defaults for new ones.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
