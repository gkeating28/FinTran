-- Ask Qula quality and actions.
-- ai_settings.log_answers is an opt-in. When it is off a rating keeps only the thumb and the optional comment.
alter table public.ai_settings
  add column log_answers boolean not null default false;

comment on column public.ai_settings.log_answers is
  'When true, a rated answer keeps the question and the answer text with the rating. When false only the rating and comment are kept.';

create table public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  rating smallint not null check (rating in (-1, 1)),
  provider_code text,
  model text,
  comment text check (comment is null or char_length(comment) <= 500),
  question text check (question is null or char_length(question) <= 1000),
  answer text check (answer is null or char_length(answer) <= 4000)
);

create index ai_feedback_organisation_at_idx on public.ai_feedback (organisation_id, at desc);

alter table public.ai_feedback enable row level security;
create policy ai_feedback_select on public.ai_feedback for select to authenticated
  using (private.has_org_role(organisation_id, array['owner', 'admin']));
revoke insert, update, delete on public.ai_feedback from authenticated, anon, public;

create or replace function public.record_ai_feedback(
  p_organisation_id uuid,
  p_rating integer,
  p_question text,
  p_answer text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_provider text;
  v_model text;
  v_log boolean;
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  if p_rating not in (-1, 1) then
    raise exception 'The rating must be thumbs up or thumbs down';
  end if;
  select tenant_id into v_tenant from public.organisations where id = p_organisation_id;
  select provider_code, model, log_answers into v_provider, v_model, v_log
  from public.ai_settings where organisation_id = p_organisation_id;
  insert into public.ai_feedback (
    organisation_id, tenant_id, user_id, rating, provider_code, model, comment, question, answer
  ) values (
    p_organisation_id, v_tenant, auth.uid(), p_rating, v_provider, v_model,
    nullif(left(btrim(coalesce(p_comment, '')), 500), ''),
    case when coalesce(v_log, false) then nullif(left(btrim(coalesce(p_question, '')), 1000), '') end,
    case when coalesce(v_log, false) then nullif(left(btrim(coalesce(p_answer, '')), 4000), '') end
  );
end;
$$;

revoke all on function public.record_ai_feedback(uuid, integer, text, text, text) from public, anon;
grant execute on function public.record_ai_feedback(uuid, integer, text, text, text) to authenticated;

-- A record of what Ask Qula did after a person confirmed it.
create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  action text not null check (action in ('post_draft', 'add_party')),
  summary text not null check (char_length(summary) between 1 and 500),
  outcome text not null check (outcome in ('done', 'failed')),
  detail text check (detail is null or char_length(detail) <= 500)
);

create index ai_actions_organisation_at_idx on public.ai_actions (organisation_id, at desc);

alter table public.ai_actions enable row level security;
create policy ai_actions_select on public.ai_actions for select to authenticated
  using (private.has_org_role(organisation_id, array['owner', 'admin']));
revoke insert, update, delete on public.ai_actions from authenticated, anon, public;

create or replace function public.record_ai_action(
  p_organisation_id uuid,
  p_action text,
  p_summary text,
  p_outcome text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  if p_action not in ('post_draft', 'add_party') or p_outcome not in ('done', 'failed') then
    raise exception 'That action record is not recognised';
  end if;
  insert into public.ai_actions (organisation_id, tenant_id, user_id, action, summary, outcome, detail)
  select p_organisation_id, tenant_id, auth.uid(), p_action,
    left(btrim(p_summary), 500), p_outcome, nullif(left(btrim(coalesce(p_detail, '')), 500), '')
  from public.organisations where id = p_organisation_id;
end;
$$;

revoke all on function public.record_ai_action(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_ai_action(uuid, text, text, text, text) to authenticated;
