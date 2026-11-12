# Archived migrations

These are the 84 migration files from before the baseline, kept for reference. They are not applied to anything.

`supabase/migrations/20261112101106_baseline.sql` replaces them. It builds the database as the live project had it on 12 November 2026.

They were replaced because they could not rebuild the database from empty:

- Five of the last ones patched `save_document` by matching its text, and that text is not what the earlier files produce.
- Four e-document migrations of 25 October 2026 were applied to the live project without their SQL being recorded, so the files here differ from what the live project ran.

New migrations go in `supabase/migrations`, after the baseline.
