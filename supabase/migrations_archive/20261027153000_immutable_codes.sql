-- A saved business code is the identity of the row. It cannot be renamed.

create or replace function private.guard_code_unchanged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(btrim(new.code)) is distinct from upper(btrim(old.code)) then
    raise exception 'A code cannot be changed.';
  end if;

  new.code := upper(btrim(old.code));
  return new;
end;
$$;

revoke all on function private.guard_code_unchanged() from public, anon, authenticated;

do $$
declare
  coded_table text;
begin
  foreach coded_table in array array[
    'gl_codes',
    'departments',
    'cost_centres',
    'vat_rates',
    'customers',
    'suppliers',
    'products',
    'currencies',
    'transaction_types'
  ]
  loop
    execute format(
      'create trigger aa_code_unchanged before update on public.%I for each row execute function private.guard_code_unchanged()',
      coded_table
    );
  end loop;
end;
$$;
