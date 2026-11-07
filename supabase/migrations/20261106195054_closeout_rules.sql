-- Close-out rules: event reasons, Ask Qula limits, settings guards, and audits.

create or replace function private.set_e_document_status(
  p_id uuid,
  p_to public.e_document_status,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.e_documents%rowtype;
begin
  select * into v_row from public.e_documents where id = p_id for update;
  if v_row.id is null then
    raise exception 'That e-document was not found';
  end if;
  if not private.e_document_transition_allowed(v_row.direction, v_row.status, p_to) then
    raise exception 'That e-document status change is not allowed';
  end if;

  perform set_config('fintran.e_document_detail', coalesce(p_detail, '{}'::jsonb)::text, true);
  update public.e_documents
  set status = p_to,
      duplicate_of = coalesce(nullif(p_detail->>'duplicateOf', '')::uuid, duplicate_of),
      rejection_reason = case
        when p_to = 'rejected' then nullif(btrim(p_detail->>'reason'), '')
        else rejection_reason
      end,
      header_id = coalesce(nullif(p_detail->>'headerId', '')::uuid, header_id),
      validated_at = case
        when p_to in ('valid', 'invalid', 'duplicate') then coalesce(validated_at, now())
        else validated_at
      end,
      updated_at = now(),
      updated_by = (select auth.uid())
  where id = p_id;
end;
$$;

create or replace function private.record_e_document_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail jsonb := nullif(current_setting('fintran.e_document_detail', true), '')::jsonb;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and not private.e_document_transition_allowed(new.direction, old.status, new.status) then
    raise exception 'That e-document status change is not allowed';
  end if;
  if new.status = 'rejected' and nullif(btrim(new.rejection_reason), '') is null then
    raise exception 'A rejection needs a reason';
  end if;

  insert into public.e_document_events (
    e_document_id, organisation_id, from_status, to_status, actor, detail
  ) values (
    new.id,
    new.organisation_id,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    (select auth.uid()),
    v_detail
  );
  return new;
end;
$$;

create or replace function private.guard_ai_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data_notice_accepted_at is not null and new.data_notice_accepted_by is null then
    new.data_notice_accepted_by := auth.uid();
  end if;
  if new.enabled then
    if new.provider_code is null or nullif(btrim(new.model), '') is null or new.data_notice_accepted_at is null then
      raise exception 'Choose a provider and model, and accept the data notice';
    end if;
    if not exists (
      select 1 from public.organisation_secrets
      where organisation_id = new.organisation_id and kind = 'ai_api_key'
    ) then
      raise exception 'Add an API key before enabling Ask Qula';
    end if;
  end if;
  if new.config->>'baseUrl' is not null and new.config->>'baseUrl' <> '' and new.config->>'baseUrl' not like 'https://%' then
    raise exception 'The base URL must use https';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_settings_guard on public.ai_settings;
create trigger ai_settings_guard
  before insert or update on public.ai_settings
  for each row execute function private.guard_ai_settings();

create or replace function private.guard_access_point_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.environment = 'production' and not exists (
    select 1 from public.organisation_defaults
    where organisation_id = new.organisation_id and nullif(btrim(peppol_id), '') is not null
  ) then
    raise exception 'Add a Peppol ID before using production';
  end if;
  if tg_op = 'UPDATE'
     and old.participant_registered
     and new.provider_code is distinct from old.provider_code then
    raise exception 'Deregister the Peppol ID with the current provider before switching.';
  end if;
  if new.config->>'baseUrl' is not null and new.config->>'baseUrl' <> '' and new.config->>'baseUrl' not like 'https://%' then
    raise exception 'The base URL must use https';
  end if;
  return new;
end;
$$;

drop trigger if exists access_point_settings_guard on public.access_point_settings;
create trigger access_point_settings_guard
  before insert or update on public.access_point_settings
  for each row execute function private.guard_access_point_settings();

drop trigger if exists ai_settings_audit on public.ai_settings;
create trigger ai_settings_audit
  after insert or update or delete on public.ai_settings
  for each row execute function private.write_audit_log();

drop trigger if exists access_point_settings_audit on public.access_point_settings;
create trigger access_point_settings_audit
  after insert or update or delete on public.access_point_settings
  for each row execute function private.write_audit_log();

create or replace function public.ai_usage_allowance(p_organisation_id uuid)
returns table (user_hour integer, organisation_month integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  return query
  select
    (select count(*)::integer from public.ai_usage
      where organisation_id = p_organisation_id
        and user_id = auth.uid()
        and at >= now() - interval '1 hour'),
    (select count(*)::integer from public.ai_usage
      where organisation_id = p_organisation_id
        and at >= date_trunc('month', now()));
end;
$$;

revoke all on function public.ai_usage_allowance(uuid) from public, anon;
grant execute on function public.ai_usage_allowance(uuid) to authenticated;
