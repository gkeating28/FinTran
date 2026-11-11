-- Ask Qula actions, hardened (hardening spec phase 2, decisions J2 and J3).
-- Actions are off for every organisation until an owner or admin switches them on.
-- A proposal is written down before its token is handed out. The token works once, for ten minutes, and only while the
-- document it names has not changed.

-- 1. The switch. Every existing organisation starts with actions off.
alter table public.ai_settings
  add column actions_enabled boolean not null default false;

comment on column public.ai_settings.actions_enabled is
  'When true, Ask Qula may propose posting a draft or adding a customer or supplier. It can only be true while enabled is true. Nothing happens until a person confirms.';

update public.ai_settings set actions_enabled = false where actions_enabled;

-- Actions can only be on while AI answers are on. Switching answers off switches actions off with them.
create or replace function private.guard_ai_actions_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.enabled then
    new.actions_enabled := false;
  end if;
  return new;
end;
$$;

create trigger ai_settings_actions_guard
  before insert or update on public.ai_settings
  for each row execute function private.guard_ai_actions_enabled();

-- 2. A row per proposal. The rows written before this migration recorded only what was done, so they become confirmed
-- or failed.
alter table public.ai_actions
  add column status text,
  add column token_hash text,
  add column expires_at timestamptz,
  add column target_id uuid,
  add column target_version timestamptz,
  add column proposal jsonb,
  add column decided_at timestamptz;

update public.ai_actions
set status = case when outcome = 'done' then 'confirmed' else 'failed' end,
    decided_at = at;

alter table public.ai_actions
  alter column status set not null,
  alter column status set default 'proposed',
  add constraint ai_actions_status_check check (status in ('proposed', 'confirmed', 'failed', 'expired', 'superseded')),
  add constraint ai_actions_token_hash_check check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  add constraint ai_actions_proposed_has_token check (status <> 'proposed' or (token_hash is not null and expires_at is not null)),
  drop column outcome;

create unique index ai_actions_token_hash_key on public.ai_actions (token_hash) where token_hash is not null;
create index ai_actions_open_idx on public.ai_actions (organisation_id, user_id) where status = 'proposed';

comment on column public.ai_actions.status is
  'proposed until the person decides. confirmed once the token is used and the action ran. failed when it was used and the action did not run. expired after ten minutes. superseded when the same person was given a newer proposal for the same thing.';
comment on column public.ai_actions.token_hash is
  'SHA-256 of the confirmation token, in hex. The token itself is never stored.';
comment on column public.ai_actions.expires_at is 'Proposal time plus ten minutes.';
comment on column public.ai_actions.target_id is 'The document being posted, when there is one.';
comment on column public.ai_actions.target_version is 'The target header''s updated_at when it was proposed.';
comment on column public.ai_actions.proposal is 'The summary the server built from the database and showed to the person.';

-- The old way of writing a row after the fact is gone. Rows are written only by the three functions below.
drop function public.record_ai_action(uuid, text, text, text, text);

-- 3. Propose. Called with the person's own session when Ask Qula has checked a request against the data.
create or replace function public.propose_ai_action(
  p_organisation_id uuid,
  p_action text,
  p_token_hash text,
  p_target_id uuid,
  p_summary text,
  p_proposal jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_version timestamptz;
  v_status text;
  v_id uuid;
begin
  if v_user is null or not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  if not exists (
    select 1 from public.ai_settings
    where organisation_id = p_organisation_id and enabled and actions_enabled
  ) then
    raise exception 'Ask Qula actions are switched off for this organisation';
  end if;
  if p_action not in ('post_draft', 'add_party') then
    raise exception 'That action is not recognised';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'That action could not be proposed';
  end if;
  if p_action = 'post_draft' then
    select status::text, updated_at into v_status, v_version
    from public.transaction_headers
    where id = p_target_id and organisation_id = p_organisation_id;
    if v_status is null then
      raise exception 'That document could not be found';
    end if;
    if v_status <> 'draft' then
      raise exception 'Only a draft can be posted';
    end if;
  elsif p_target_id is not null then
    raise exception 'That action could not be proposed';
  end if;
  select tenant_id into v_tenant from public.organisations where id = p_organisation_id;

  -- Anything this person left unanswered has run out, or is replaced by this newer proposal for the same thing.
  update public.ai_actions
  set status = 'expired', decided_at = now()
  where organisation_id = p_organisation_id and user_id = v_user and status = 'proposed' and expires_at <= now();
  update public.ai_actions
  set status = 'superseded', decided_at = now()
  where organisation_id = p_organisation_id and user_id = v_user and status = 'proposed'
    and action = p_action and target_id is not distinct from p_target_id;

  insert into public.ai_actions (
    organisation_id, tenant_id, user_id, action, summary, status, token_hash, expires_at, target_id, target_version, proposal
  ) values (
    p_organisation_id, v_tenant, v_user, p_action,
    left(btrim(coalesce(nullif(btrim(p_summary), ''), p_action)), 500),
    'proposed', p_token_hash, now() + interval '10 minutes', p_target_id, v_version, coalesce(p_proposal, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.propose_ai_action(uuid, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.propose_ai_action(uuid, text, text, uuid, text, jsonb) to authenticated;

-- 4. Confirm. One statement moves the row from proposed to confirmed, so a token can only ever be used once.
-- Returns: confirmed, used, expired, unknown, changed or disabled.
create or replace function public.confirm_ai_action(p_organisation_id uuid, p_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.ai_actions;
  v_status text;
  v_version timestamptz;
begin
  if v_user is null or not private.is_org_member(p_organisation_id) then
    return 'unknown';
  end if;
  if not exists (
    select 1 from public.ai_settings
    where organisation_id = p_organisation_id and enabled and actions_enabled
  ) then
    return 'disabled';
  end if;

  update public.ai_actions
  set status = 'confirmed', decided_at = now()
  where token_hash = p_token_hash
    and status = 'proposed'
    and expires_at > now()
    and user_id = v_user
    and organisation_id = p_organisation_id
  returning * into v_row;

  if v_row.id is null then
    -- Nothing moved. Say why, without telling one person about another person's token.
    select status into v_status
    from public.ai_actions
    where token_hash = p_token_hash and user_id = v_user and organisation_id = p_organisation_id;
    if v_status is null then
      return 'unknown';
    end if;
    if v_status = 'proposed' then
      update public.ai_actions set status = 'expired', decided_at = now()
      where token_hash = p_token_hash and status = 'proposed';
      return 'expired';
    end if;
    if v_status in ('confirmed', 'failed') then
      return 'used';
    end if;
    return 'expired';
  end if;

  if v_row.action = 'post_draft' then
    select status::text, updated_at into v_status, v_version
    from public.transaction_headers
    where id = v_row.target_id and organisation_id = p_organisation_id;
    if v_status is distinct from 'draft' or v_version is distinct from v_row.target_version then
      update public.ai_actions
      set status = 'failed', detail = 'The document changed after it was proposed.'
      where id = v_row.id;
      return 'changed';
    end if;
  end if;
  return 'confirmed';
end;
$$;

revoke all on function public.confirm_ai_action(uuid, text) from public, anon;
grant execute on function public.confirm_ai_action(uuid, text) to authenticated;

-- 5. Record how a confirmed action ended. Only the person who confirmed it can, and only once it is confirmed.
create or replace function public.finish_ai_action(p_token_hash text, p_ok boolean, p_summary text, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_actions
  set status = case when p_ok then 'confirmed' else 'failed' end,
      summary = coalesce(nullif(left(btrim(coalesce(p_summary, '')), 500), ''), summary),
      detail = nullif(left(btrim(coalesce(p_detail, '')), 500), '')
  where token_hash = p_token_hash
    and status = 'confirmed'
    and user_id = auth.uid();
end;
$$;

revoke all on function public.finish_ai_action(text, boolean, text, text) from public, anon;
grant execute on function public.finish_ai_action(text, boolean, text, text) to authenticated;
