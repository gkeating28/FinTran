alter table public.transaction_types
  add column flex1_label text,
  add column flex2_label text,
  add column flex3_label text,
  add column flex4_label text,
  add column flex5_label text;

alter table public.transaction_types
  add constraint transaction_types_flex1_label_check check (flex1_label is null or char_length(flex1_label) between 1 and 80),
  add constraint transaction_types_flex2_label_check check (flex2_label is null or char_length(flex2_label) between 1 and 80),
  add constraint transaction_types_flex3_label_check check (flex3_label is null or char_length(flex3_label) between 1 and 80),
  add constraint transaction_types_flex4_label_check check (flex4_label is null or char_length(flex4_label) between 1 and 80),
  add constraint transaction_types_flex5_label_check check (flex5_label is null or char_length(flex5_label) between 1 and 80);

create or replace function private.enforce_transaction_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A transaction type cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);
  new.flex1_label := nullif(btrim(new.flex1_label), '');
  new.flex2_label := nullif(btrim(new.flex2_label), '');
  new.flex3_label := nullif(btrim(new.flex3_label), '');
  new.flex4_label := nullif(btrim(new.flex4_label), '');
  new.flex5_label := nullif(btrim(new.flex5_label), '');

  if tg_op = 'INSERT' then
    new.last_reference := 0;
  elsif new.last_reference is distinct from old.last_reference
    and new.last_reference is distinct from old.last_reference + 1 then
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;
