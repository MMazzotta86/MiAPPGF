-- Ejecuta este archivo en Supabase > SQL Editor para crear o actualizar el esquema.
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
  category text not null default 'Otros',
  paid_installments smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_card_purchases
  add column if not exists purchase_date date,
  add column if not exists first_payment_date date,
  add column if not exists paid_in_full boolean not null default false;
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
  add constraint fixed_expenses_bank_check check (bank in ('Santander', 'ING', 'Revolut', 'Sin asignar'));
alter table public.monthly_expenses
  add column if not exists bank text not null default 'Sin asignar',
  drop constraint if exists monthly_expenses_bank_check,
  add constraint monthly_expenses_bank_check check (bank in ('Santander', 'ING', 'Revolut', 'Sin asignar'));
alter table public.variable_expenses
  add column if not exists bank text not null default 'Sin asignar',
  drop constraint if exists variable_expenses_bank_check,
  add constraint variable_expenses_bank_check check (bank in ('Santander', 'ING', 'Revolut', 'Sin asignar'));

create index if not exists monthly_expenses_user_month_idx
  on public.monthly_expenses (user_id, month);
create index if not exists variable_expenses_user_date_idx
  on public.variable_expenses (user_id, expense_date);
create index if not exists credit_card_purchases_user_first_month_idx
  on public.credit_card_purchases (user_id, first_installment_month);

alter table public.fixed_expenses enable row level security;
alter table public.monthly_expenses enable row level security;
alter table public.variable_expenses enable row level security;
alter table public.credit_card_purchases enable row level security;

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

drop policy if exists "owner manages credit card purchases" on public.credit_card_purchases;
create policy "owner manages credit card purchases" on public.credit_card_purchases
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.fixed_expenses to authenticated;
grant select, insert, update, delete on public.monthly_expenses to authenticated;
grant select, insert, update, delete on public.variable_expenses to authenticated;
grant select, insert, update, delete on public.credit_card_purchases to authenticated;

notify pgrst, 'reload schema';
