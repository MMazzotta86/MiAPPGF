-- Ejecuta este archivo en Supabase > SQL Editor para crear o actualizar el esquema.
create table if not exists public.user_banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name) and lower(name) <> 'sin asignar'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create unique index if not exists user_banks_user_name_lower_idx
  on public.user_banks (user_id, lower(name));

create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  due_day smallint not null check (due_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annual')),
  annual_month smallint not null default 1 check (annual_month between 1 and 12),
  category text not null default 'Otros',
  bank text not null default 'Sin asignar',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fixed_expense_id uuid references public.fixed_expenses(id) on delete set null,
  month date not null check (extract(day from month) = 1),
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_day smallint not null check (due_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annual')),
  annual_month smallint not null default 1 check (annual_month between 1 and 12),
  category text not null,
  bank text not null default 'Sin asignar',
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, fixed_expense_id, month)
);

create table if not exists public.variable_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null,
  category text not null default 'Otros',
  bank text not null default 'Sin asignar',
  created_at timestamptz not null default now()
);

create table if not exists public.income_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  income_date date not null,
  bank text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  transfer_date date not null,
  from_bank text not null,
  to_bank text not null,
  created_at timestamptz not null default now(),
  check (from_bank <> to_bank)
);

create table if not exists public.credit_card_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  installment_count smallint not null check (installment_count between 1 and 120 and installment_count <= amount * 100),
  purchase_date date not null,
  first_payment_date date not null,
  first_installment_month date not null check (extract(day from first_installment_month) = 1),
  paid_in_full boolean not null default false,
  card_name text not null check (char_length(card_name) between 1 and 80),
  bank text not null default 'Sin asignar',
  category text not null default 'Otros',
  paid_installments smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_card_purchases
  add column if not exists purchase_date date,
  add column if not exists first_payment_date date,
  add column if not exists bank text not null default 'Sin asignar',
  add column if not exists paid_in_full boolean not null default false;
alter table public.credit_card_purchases
  drop constraint if exists credit_card_purchases_bank_check,
  add constraint credit_card_purchases_bank_check check (char_length(bank) between 1 and 60 or bank = 'Sin asignar');
update public.credit_card_purchases
  set purchase_date = first_installment_month
  where purchase_date is null;
update public.credit_card_purchases
  set first_payment_date = case
    when paid_in_full then purchase_date
    else first_installment_month
  end
  where first_payment_date is null;
alter table public.credit_card_purchases
  alter column purchase_date set not null,
  alter column first_payment_date set not null;

-- Compatibilidad con las tablas creadas antes de añadir gastos anuales.
alter table public.fixed_expenses
  add column if not exists frequency text not null default 'monthly',
  add column if not exists annual_month smallint not null default 1;
alter table public.fixed_expenses
  drop constraint if exists fixed_expenses_frequency_check,
  add constraint fixed_expenses_frequency_check check (frequency in ('monthly', 'quarterly', 'annual')),
  drop constraint if exists fixed_expenses_annual_month_check,
  add constraint fixed_expenses_annual_month_check check (annual_month between 1 and 12);
alter table public.monthly_expenses
  add column if not exists frequency text not null default 'monthly',
  add column if not exists annual_month smallint not null default 1;
alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_frequency_check,
  add constraint monthly_expenses_frequency_check check (frequency in ('monthly', 'quarterly', 'annual')),
  drop constraint if exists monthly_expenses_annual_month_check,
  add constraint monthly_expenses_annual_month_check check (annual_month between 1 and 12);
alter table public.fixed_expenses
  add column if not exists bank text not null default 'Sin asignar',
  drop constraint if exists fixed_expenses_bank_check,
  add constraint fixed_expenses_bank_check check (char_length(bank) between 1 and 60 or bank = 'Sin asignar');
alter table public.monthly_expenses
  add column if not exists bank text not null default 'Sin asignar',
  drop constraint if exists monthly_expenses_bank_check,
  add constraint monthly_expenses_bank_check check (char_length(bank) between 1 and 60 or bank = 'Sin asignar');
alter table public.variable_expenses
  add column if not exists bank text not null default 'Sin asignar',
  drop constraint if exists variable_expenses_bank_check,
  add constraint variable_expenses_bank_check check (char_length(bank) between 1 and 60 or bank = 'Sin asignar');

alter table public.income_transactions
  drop constraint if exists income_transactions_bank_check;
alter table public.bank_transfers
  drop constraint if exists bank_transfers_from_bank_check,
  drop constraint if exists bank_transfers_to_bank_check;

insert into public.user_banks (user_id, name)
select users.id, defaults.name
from auth.users as users
cross join (values ('Santander'), ('ING'), ('Revolut')) as defaults(name)
on conflict do nothing;

insert into public.user_banks (user_id, name)
select distinct known.user_id, known.name
from (
  select user_id, bank as name from public.fixed_expenses where bank <> 'Sin asignar'
  union all select user_id, bank from public.monthly_expenses where bank <> 'Sin asignar'
  union all select user_id, bank from public.variable_expenses where bank <> 'Sin asignar'
  union all select user_id, bank from public.income_transactions where bank <> 'Sin asignar'
  union all select user_id, from_bank from public.bank_transfers
  union all select user_id, to_bank from public.bank_transfers
  union all select user_id, bank from public.credit_card_purchases where bank <> 'Sin asignar'
) as known
where char_length(known.name) between 1 and 60
  and known.name = btrim(known.name)
  and lower(known.name) <> 'sin asignar'
on conflict do nothing;

create or replace function public.validate_user_bank_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bank_name text;
begin
  if tg_table_name = 'bank_transfers' then
    foreach bank_name in array array[new.from_bank, new.to_bank]
    loop
      if not exists (
        select 1 from public.user_banks
        where user_id = new.user_id and name = bank_name
      ) then
        raise exception 'El banco no pertenece al usuario autenticado.';
      end if;
    end loop;
  elsif new.bank <> 'Sin asignar' and not exists (
    select 1 from public.user_banks
    where user_id = new.user_id and name = new.bank
  ) then
    raise exception 'El banco no pertenece al usuario autenticado.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_fixed_expense_bank on public.fixed_expenses;
create trigger validate_fixed_expense_bank before insert or update of user_id, bank on public.fixed_expenses
  for each row execute function public.validate_user_bank_name();
drop trigger if exists validate_monthly_expense_bank on public.monthly_expenses;
create trigger validate_monthly_expense_bank before insert or update of user_id, bank on public.monthly_expenses
  for each row execute function public.validate_user_bank_name();
drop trigger if exists validate_variable_expense_bank on public.variable_expenses;
create trigger validate_variable_expense_bank before insert or update of user_id, bank on public.variable_expenses
  for each row execute function public.validate_user_bank_name();
drop trigger if exists validate_income_transaction_bank on public.income_transactions;
create trigger validate_income_transaction_bank before insert or update of user_id, bank on public.income_transactions
  for each row execute function public.validate_user_bank_name();
drop trigger if exists validate_bank_transfer_bank on public.bank_transfers;
create trigger validate_bank_transfer_bank before insert or update of user_id, from_bank, to_bank on public.bank_transfers
  for each row execute function public.validate_user_bank_name();
drop trigger if exists validate_credit_card_purchase_bank on public.credit_card_purchases;
create trigger validate_credit_card_purchase_bank before insert or update of user_id, bank on public.credit_card_purchases
  for each row execute function public.validate_user_bank_name();

create index if not exists monthly_expenses_user_month_idx
  on public.monthly_expenses (user_id, month);
create index if not exists variable_expenses_user_date_idx
  on public.variable_expenses (user_id, expense_date);
create index if not exists income_transactions_user_date_idx
  on public.income_transactions (user_id, income_date);
create index if not exists bank_transfers_user_date_idx
  on public.bank_transfers (user_id, transfer_date);
create index if not exists credit_card_purchases_user_first_month_idx
  on public.credit_card_purchases (user_id, first_installment_month);

alter table public.fixed_expenses enable row level security;
alter table public.monthly_expenses enable row level security;
alter table public.variable_expenses enable row level security;
alter table public.income_transactions enable row level security;
alter table public.bank_transfers enable row level security;
alter table public.credit_card_purchases enable row level security;
alter table public.user_banks enable row level security;

drop policy if exists "owner manages user banks" on public.user_banks;
create policy "owner manages user banks" on public.user_banks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages fixed expenses" on public.fixed_expenses;
create policy "owner manages fixed expenses" on public.fixed_expenses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages monthly expenses" on public.monthly_expenses;
create policy "owner manages monthly expenses" on public.monthly_expenses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages variable expenses" on public.variable_expenses;
create policy "owner manages variable expenses" on public.variable_expenses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages income transactions" on public.income_transactions;
create policy "owner manages income transactions" on public.income_transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages bank transfers" on public.bank_transfers;
create policy "owner manages bank transfers" on public.bank_transfers
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "owner manages credit card purchases" on public.credit_card_purchases;
create policy "owner manages credit card purchases" on public.credit_card_purchases
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.fixed_expenses to authenticated;
grant select, insert, update, delete on public.monthly_expenses to authenticated;
grant select, insert, update, delete on public.variable_expenses to authenticated;
grant select, insert, update, delete on public.income_transactions to authenticated;
grant select, insert, update, delete on public.bank_transfers to authenticated;
grant select, insert, update, delete on public.credit_card_purchases to authenticated;
grant select, insert, update, delete on public.user_banks to authenticated;

notify pgrst, 'reload schema';
