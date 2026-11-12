-- Stored questions and answers (hardening spec phase 3, decision J4).
-- The text kept with a rating is deleted after the organisation's retention period, 30 days unless changed.
-- The rating itself is kept. Keeping the text needs its own notice, accepted by an owner or admin.

alter table public.ai_settings
  add column answer_retention_days integer not null default 30
    constraint ai_settings_answer_retention_days_check check (answer_retention_days between 1 and 365),
  add column log_notice_accepted_at timestamptz,
  add column log_notice_accepted_by uuid references public.profiles (id) on delete set null;

comment on column public.ai_settings.answer_retention_days is
  'How many days the question, answer and comment kept with a rating are stored, from 1 to 365. After that the text is deleted and the rating is kept.';
comment on column public.ai_settings.log_notice_accepted_at is
  'When an owner or admin last accepted the notice that questions and answers will be stored for answer_retention_days and are visible to owners and admins.';
comment on column public.ai_settings.log_notice_accepted_by is 'Who accepted that notice.';

-- Nobody has accepted the new notice yet, so keeping the text is switched off until someone does.
update public.ai_settings set log_answers = false where log_answers;

-- Keeping the text cannot be switched on, and the number of days cannot be changed while it is on, without the notice
-- being accepted in the same save.
create or replace function private.guard_ai_log_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needs_notice boolean;
  v_accepted_now boolean;
begin
  if not new.log_answers then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_needs_notice := true;
    v_accepted_now := new.log_notice_accepted_at is not null;
  else
    v_needs_notice := not old.log_answers or new.answer_retention_days is distinct from old.answer_retention_days;
    v_accepted_now := new.log_notice_accepted_at is not null
      and new.log_notice_accepted_at is distinct from old.log_notice_accepted_at;
  end if;
  if v_needs_notice and not v_accepted_now then
    raise exception 'Accept the notice that questions and answers will be stored for % days and are visible to owners and admins',
      new.answer_retention_days;
  end if;
  if v_accepted_now then
    new.log_notice_accepted_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger ai_settings_log_answers_guard
  before insert or update on public.ai_settings
  for each row execute function private.guard_ai_log_answers();

-- Clears the text on ratings older than each organisation's retention period. Returns how many rows it cleared.
create or replace function private.purge_ai_feedback_text()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ai_feedback as feedback
  set question = null, answer = null, comment = null
  where (feedback.question is not null or feedback.answer is not null or feedback.comment is not null)
    and feedback.at < now() - make_interval(days => coalesce(
      (select settings.answer_retention_days from public.ai_settings as settings where settings.organisation_id = feedback.organisation_id),
      30
    ));
  get diagnostics v_count = row_count;

  -- Proposals nobody confirmed within their ten minutes are marked expired, so the action log is truthful.
  update public.ai_actions set status = 'expired', decided_at = now()
  where status = 'proposed' and expires_at <= now();
  return v_count;
end;
$$;

revoke all on function private.purge_ai_feedback_text() from public, anon, authenticated;

-- pg_cron keeps time in UTC, and 03:15 in Dublin is 03:15 UTC in winter and 02:15 UTC in summer. The job therefore
-- runs at a quarter past every hour and does its work only in the hour that is 03:00 to 03:59 in Dublin.
create or replace function private.purge_ai_feedback_text_nightly()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if extract(hour from (now() at time zone 'Europe/Dublin')) <> 3 then
    return null;
  end if;
  return private.purge_ai_feedback_text();
end;
$$;

revoke all on function private.purge_ai_feedback_text_nightly() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-ai-feedback-text';
select cron.schedule('purge-ai-feedback-text', '15 * * * *', 'select private.purge_ai_feedback_text_nightly()');
