-- One coding system for transaction types: three characters, always.
--
-- The first letter is the direction (S for Sales, P for Purchases). The other two say what the record is:
-- RQ requisition, OR order, IN invoice, CN credit note, RC receipt, PY payment, RF refund.
--
--   Sales:      SOR order, SIN invoice, SCN credit note, SRC customer receipt, SRF customer refund
--   Purchases:  PRQ requisition, POR order, PIN invoice, PCN credit note, PPY supplier payment, PRF supplier refund
--
-- A saved code is read-only, so this is the one place the rule is set aside, and only for the types below. A type is
-- renamed only when its code, direction and kind are the standard ones, so a custom type that happens to use one of
-- the old codes is left alone. Its prefix changes only when it is still exactly the old default, so a prefix somebody
-- chose is kept. A type without a prefix stays without one. Documents and payments point at the type by id, and
-- numbers already issued are never rewritten. The change is audited like any other. Only the code guard is switched
-- off, so every other rule on transaction types still runs. Running it again finds nothing to rename.

do $migration$
declare
  v_row record;
  v_renamed integer := 0;
begin
  alter table public.transaction_types disable trigger aa_code_unchanged;

  for v_row in
    select type.id, type.code, type.organisation_id, type.reference_prefix,
           map.new_code, map.old_prefix, map.new_prefix, organisation.name as organisation
    from public.transaction_types as type
    join (values
      ('PR',   'Purchases', 'requisition', 'PRQ', 'PR-',   'PRQ-'),
      ('PO',   'Purchases', 'order',       'POR', 'PO-',   'POR-'),
      ('PI',   'Purchases', 'invoice',     'PIN', 'PI-',   'PIN-'),
      ('PC',   'Purchases', 'credit_note', 'PCN', 'PC-',   'PCN-'),
      ('SO',   'Sales',     'order',       'SOR', 'SO-',   'SOR-'),
      ('SI',   'Sales',     'invoice',     'SIN', 'INV-',  'SIN-'),
      ('SC',   'Sales',     'credit_note', 'SCN', 'CR-',   'SCN-'),
      ('REC',  'Sales',     'receipt',     'SRC', 'REC-',  'SRC-'),
      ('PAY',  'Purchases', 'payment',     'PPY', 'PAY-',  'PPY-'),
      ('CREF', 'Sales',     'payment',     'SRF', 'CREF-', 'SRF-'),
      ('SREF', 'Purchases', 'receipt',     'PRF', 'SREF-', 'PRF-'),
      ('SR',   'Sales',     'receipt',     'SRC', 'REC-',  'SRC-'),
      ('PP',   'Purchases', 'payment',     'PPY', 'PAY-',  'PPY-'),
      ('SF',   'Sales',     'payment',     'SRF', 'CREF-', 'SRF-'),
      ('PF',   'Purchases', 'receipt',     'PRF', 'SREF-', 'PRF-')
    ) as map(old_code, direction, kind, new_code, old_prefix, new_prefix)
      on type.code = map.old_code and type.type = map.direction and type.document_kind::text = map.kind
    join public.organisations as organisation on organisation.id = type.organisation_id
    where not type.is_system
    order by organisation.name, type.code
  loop
    if exists (
      select 1 from public.transaction_types as other
      where other.organisation_id = v_row.organisation_id and other.code = v_row.new_code
    ) then
      raise notice 'Left % in %: the code % is already used.', v_row.code, v_row.organisation, v_row.new_code;
      continue;
    end if;

    update public.transaction_types
    set code = v_row.new_code,
        reference_prefix = case when reference_prefix = v_row.old_prefix then v_row.new_prefix else reference_prefix end
    where id = v_row.id;
    v_renamed := v_renamed + 1;
    raise notice 'Renamed % to % in %.', v_row.code, v_row.new_code, v_row.organisation;
  end loop;

  alter table public.transaction_types enable trigger aa_code_unchanged;
  raise notice 'Renamed % transaction types.', v_renamed;
end;
$migration$;
