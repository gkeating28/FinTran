alter table public.gl_codes add column account_type text;

update public.gl_codes
set account_type = 'Expense'
where code = '6000' and description = 'Stationary';

update public.gl_codes
set account_type = 'Fixed Asset'
where code = '6001' and description = 'Furniture';

update public.gl_codes
set account_type = 'Expense'
where account_type is null;

alter table public.gl_codes alter column account_type set not null;

alter table public.gl_codes add constraint gl_codes_account_type_check check (
  account_type in (
    'Fixed Asset',
    'Current Liability',
    'Current Asset',
    'Income',
    'Expense'
  )
);
