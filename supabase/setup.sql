-- Ejecuta este archivo una vez en Supabase > SQL Editor.
create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  due_day smallint not null check (due_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annual')),
  annual_month smallint not null default 1 check (annual_month between 1 and 12),
  category text not null default 'Otros',
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
  created_at timestamptz not null default now()
);

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

create index if not exists monthly_expenses_user_month_idx
  on public.monthly_expenses (user_id, month);
create index if not exists variable_expenses_user_date_idx
  on public.variable_expenses (user_id, expense_date);

alter table public.fixed_expenses enable row level security;
alter table public.monthly_expenses enable row level security;
alter table public.variable_expenses enable row level security;

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

grant select, insert, update, delete on public.fixed_expenses to authenticated;
grant select, insert, update, delete on public.monthly_expenses to authenticated;
grant select, insert, update, delete on public.variable_expenses to authenticated;
