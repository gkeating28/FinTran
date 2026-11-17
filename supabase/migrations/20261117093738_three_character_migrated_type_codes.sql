-- The hidden types made by remove_typed_paid_amount get three-character codes too, so that no transaction type code is
-- longer or shorter than the rest.
--
-- They are not part of the standard set (direction plus RQ, OR, IN, CN, RC, PY or RF), because an organisation may have
-- a customer receipt of its own, SRC, beside the migrated one. They read as the direction, then M for migrated, then the
-- first letter of what they are:
--
--   MIGREC  SMR  migrated customer receipt (Sales, receipt)
--   MIGPAY  PMP  migrated supplier payment (Purchases, payment)
--   MIGCREF SMF  migrated customer refund (Sales, payment)
--   MIGSREF PMF  migrated supplier refund (Purchases, receipt)
--
-- These are system types, which people cannot change, so the migration says it is the one making the change. Only the
-- code guard is switched off, for this statement. The prefix MIG- stays: the numbers already issued carry it, and these
-- types issue no new ones. Running it again finds nothing to rename.

do $migration$
declare
  v_row record;
  v_renamed integer := 0;
begin
  perform set_config('fintran.migration', 'on', true);
  alter table public.transaction_types disable trigger aa_code_unchanged;

  for v_row in
    select type.id, type.code, type.organisation_id, map.new_code, organisation.name as organisation
    from public.transaction_types as type
    join (values
      ('MIGREC',  'Sales',     'receipt', 'SMR'),
      ('MIGPAY',  'Purchases', 'payment', 'PMP'),
      ('MIGCREF', 'Sales',     'payment', 'SMF'),
      ('MIGSREF', 'Purchases', 'receipt', 'PMF')
    ) as map(old_code, direction, kind, new_code)
      on type.code = map.old_code and type.type = map.direction and type.document_kind::text = map.kind
    join public.organisations as organisation on organisation.id = type.organisation_id
    where type.is_system
    order by organisation.name, type.code
  loop
    if exists (
      select 1 from public.transaction_types as other
      where other.organisation_id = v_row.organisation_id and other.code = v_row.new_code
    ) then
      raise notice 'Left % in %: the code % is already used.', v_row.code, v_row.organisation, v_row.new_code;
      continue;
    end if;

    update public.transaction_types set code = v_row.new_code where id = v_row.id;
    v_renamed := v_renamed + 1;
    raise notice 'Renamed % to % in %.', v_row.code, v_row.new_code, v_row.organisation;
  end loop;

  alter table public.transaction_types enable trigger aa_code_unchanged;
  perform set_config('fintran.migration', 'off', true);
  raise notice 'Renamed % migrated transaction types.', v_renamed;
end;
$migration$;
