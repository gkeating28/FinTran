-- E-document repository. XML stays in Postgres so it can be hashed with the record.
-- Nothing is written by ordinary inserts. Phase 2 adds the signed store function.

create type public.e_document_direction as enum ('outbound', 'inbound');
create type public.e_document_status as enum (
  'generated',
  'received',
  'invalid',
  'valid',
  'duplicate',
  'imported',
  'rejected'
);

create table public.e_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  direction public.e_document_direction not null,
  status public.e_document_status not null,
  source text not null check (source in ('generated', 'manual_upload')),
  ubl_root text not null check (ubl_root in ('Invoice', 'CreditNote')),
  customization_id text,
  profile_id text,
  header_id uuid,
  duplicate_of uuid,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 4194304),
  sender_scheme text,
  sender_id text,
  receiver_scheme text,
  receiver_id text,
  document_number text,
  issue_date date,
  currency_code text,
  total_amount numeric(18, 2),
  amount_due numeric(18, 2),
  seller_name text,
  seller_vat_number text,
  buyer_name text,
  buyer_vat_number text,
  semantic jsonb,
  validator_version text,
  rules_version text,
  validated_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint e_documents_organisation_id_id_key unique (organisation_id, id),
  constraint e_documents_header_fk foreign key (organisation_id, header_id)
    references public.transaction_headers (organisation_id, id) on delete restrict,
  constraint e_documents_duplicate_fk foreign key (organisation_id, duplicate_of)
    references public.e_documents (organisation_id, id) on delete restrict,
  constraint e_documents_sha_unique unique (organisation_id, direction, sha256),
  constraint e_documents_rejection_reason_check check (
    status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null
  ),
  constraint e_documents_validated_check check (
    validated_at is null or (validator_version is not null and rules_version is not null)
  )
);

create unique index e_documents_one_valid_outbound_idx
  on public.e_documents (header_id)
  where direction = 'outbound' and status = 'valid';

create unique index e_documents_one_imported_header_idx
  on public.e_documents (header_id)
  where direction = 'inbound' and status = 'imported';

create index e_documents_list_idx
  on public.e_documents (organisation_id, direction, status, created_at desc);

create index e_documents_sender_idx
  on public.e_documents (organisation_id, sender_scheme, lower(sender_id));

create index e_documents_tenant_id_idx on public.e_documents (tenant_id);
create index e_documents_header_id_idx on public.e_documents (header_id);
create index e_documents_created_by_idx on public.e_documents (created_by);
create index e_documents_updated_by_idx on public.e_documents (updated_by);

create table public.e_document_contents (
  e_document_id uuid primary key references public.e_documents (id) on delete restrict,
  organisation_id uuid not null,
  xml text not null,
  constraint e_document_contents_org_fk foreign key (organisation_id, e_document_id)
    references public.e_documents (organisation_id, id) on delete restrict
);

create index e_document_contents_organisation_id_idx on public.e_document_contents (organisation_id);

create table public.e_document_validation_results (
  id uuid primary key default gen_random_uuid(),
  e_document_id uuid not null references public.e_documents (id) on delete restrict,
  organisation_id uuid not null,
  layer text not null check (layer in ('xsd', 'en16931', 'peppol', 'national')),
  rule_id text not null,
  severity text not null check (severity in ('fatal', 'warning')),
  location text check (location is null or char_length(location) <= 1000),
  message text not null check (char_length(message) between 1 and 2000),
  constraint e_document_results_org_fk foreign key (organisation_id, e_document_id)
    references public.e_documents (organisation_id, id) on delete restrict
);

create index e_document_results_document_idx
  on public.e_document_validation_results (e_document_id, severity);
create index e_document_results_organisation_id_idx
  on public.e_document_validation_results (organisation_id);

create table public.e_document_events (
  id uuid primary key default gen_random_uuid(),
  e_document_id uuid not null references public.e_documents (id) on delete restrict,
  organisation_id uuid not null,
  at timestamptz not null default now(),
  from_status public.e_document_status,
  to_status public.e_document_status not null,
  actor uuid references public.profiles (id) on delete set null,
  detail jsonb,
  constraint e_document_events_org_fk foreign key (organisation_id, e_document_id)
    references public.e_documents (organisation_id, id) on delete restrict
);

create index e_document_events_document_idx on public.e_document_events (e_document_id, at);
create index e_document_events_organisation_id_idx on public.e_document_events (organisation_id);
create index e_document_events_actor_idx on public.e_document_events (actor);

alter table public.organisation_defaults
  add column inbound_invoice_type_id uuid,
  add column inbound_credit_note_type_id uuid,
  add constraint organisation_defaults_inbound_invoice_type_fk
    foreign key (organisation_id, inbound_invoice_type_id)
    references public.transaction_types (organisation_id, id) on delete restrict,
  add constraint organisation_defaults_inbound_credit_note_type_fk
    foreign key (organisation_id, inbound_credit_note_type_id)
    references public.transaction_types (organisation_id, id) on delete restrict;

create index organisation_defaults_inbound_invoice_type_idx
  on public.organisation_defaults (inbound_invoice_type_id);
create index organisation_defaults_inbound_credit_note_type_idx
  on public.organisation_defaults (inbound_credit_note_type_id);

create or replace function private.e_document_transition_allowed(
  p_direction public.e_document_direction,
  p_from public.e_document_status,
  p_to public.e_document_status
)
returns boolean
language sql
immutable
as $$
  select case
    when p_direction = 'outbound' and p_from = 'generated' and p_to in ('valid', 'invalid') then true
    when p_direction = 'inbound' and p_from = 'received' and p_to in ('valid', 'invalid', 'duplicate') then true
    when p_direction = 'inbound' and p_from = 'valid' and p_to in ('imported', 'rejected') then true
    when p_direction = 'inbound' and p_from = 'invalid' and p_to = 'rejected' then true
    else false
  end;
$$;

revoke all on function private.e_document_transition_allowed(public.e_document_direction, public.e_document_status, public.e_document_status)
  from public, anon, authenticated;

create or replace function private.record_e_document_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    null
  );
  return new;
end;
$$;

revoke all on function private.record_e_document_status() from public, anon, authenticated;

create trigger e_documents_status
  after insert or update of status on public.e_documents
  for each row execute function private.record_e_document_status();

create or replace function private.freeze_e_document_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'An e-document file cannot be changed';
end;
$$;

revoke all on function private.freeze_e_document_content() from public, anon, authenticated;

create trigger e_document_contents_freeze
  before update or delete on public.e_document_contents
  for each row execute function private.freeze_e_document_content();

create or replace function private.check_e_document_content_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sha text;
begin
  select sha256 into v_sha from public.e_documents where id = new.e_document_id;
  if v_sha is distinct from encode(extensions.digest(convert_to(new.xml, 'utf8'), 'sha256'), 'hex') then
    raise exception 'The e-document file does not match its recorded hash';
  end if;
  return new;
end;
$$;

revoke all on function private.check_e_document_content_hash() from public, anon, authenticated;

create trigger e_document_contents_hash
  before insert on public.e_document_contents
  for each row execute function private.check_e_document_content_hash();

create or replace function private.freeze_e_document_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'E-document history cannot be changed';
end;
$$;

revoke all on function private.freeze_e_document_events() from public, anon, authenticated;

create trigger e_document_events_freeze
  before update or delete on public.e_document_events
  for each row execute function private.freeze_e_document_events();

create or replace function private.guard_inbound_document_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.document_kind;
  v_type text;
begin
  if tg_op = 'UPDATE'
     and new.inbound_invoice_type_id is not distinct from old.inbound_invoice_type_id
     and new.inbound_credit_note_type_id is not distinct from old.inbound_credit_note_type_id then
    return new;
  end if;
  if private.org_role(new.organisation_id) not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can choose the inbound document types';
  end if;

  if new.inbound_invoice_type_id is not null then
    select document_kind, type into v_kind, v_type
    from public.transaction_types
    where id = new.inbound_invoice_type_id and organisation_id = new.organisation_id;
    if v_type is distinct from 'Purchases' or v_kind is distinct from 'invoice' then
      raise exception 'Choose a Purchases invoice type';
    end if;
  end if;
  if new.inbound_credit_note_type_id is not null then
    select document_kind, type into v_kind, v_type
    from public.transaction_types
    where id = new.inbound_credit_note_type_id and organisation_id = new.organisation_id;
    if v_type is distinct from 'Purchases' or v_kind is distinct from 'credit_note' then
      raise exception 'Choose a Purchases credit note type';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_inbound_document_types() from public, anon, authenticated;

create trigger organisation_defaults_inbound_types
  before insert or update of inbound_invoice_type_id, inbound_credit_note_type_id
  on public.organisation_defaults
  for each row execute function private.guard_inbound_document_types();

alter table public.e_documents enable row level security;
alter table public.e_document_contents enable row level security;
alter table public.e_document_validation_results enable row level security;
alter table public.e_document_events enable row level security;

create policy e_documents_select_member on public.e_documents
  for select to authenticated using (private.is_org_member(organisation_id));
create policy e_document_contents_select_member on public.e_document_contents
  for select to authenticated using (private.is_org_member(organisation_id));
create policy e_document_results_select_member on public.e_document_validation_results
  for select to authenticated using (private.is_org_member(organisation_id));
create policy e_document_events_select_member on public.e_document_events
  for select to authenticated using (private.is_org_member(organisation_id));

revoke insert, update, delete on public.e_documents from authenticated, anon, public;
revoke insert, update, delete on public.e_document_contents from authenticated, anon, public;
revoke insert, update, delete on public.e_document_validation_results from authenticated, anon, public;
revoke insert, update, delete on public.e_document_events from authenticated, anon, public;
grant select on public.e_documents to authenticated;
grant select on public.e_document_contents to authenticated;
grant select on public.e_document_validation_results to authenticated;
grant select on public.e_document_events to authenticated;
