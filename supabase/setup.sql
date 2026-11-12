-- Ejecuta este archivo una vez en Supabase > SQL Editor.
create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount > 0),
  due_day smallint not null check (due_day between 1 and 31),
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
  category text not null,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, fixed_expense_id, month)
);

create index if not exists monthly_expenses_user_month_idx
  on public.monthly_expenses (user_id, month);

alter table public.fixed_expenses enable row level security;
alter table public.monthly_expenses enable row level security;

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

grant select, insert, update, delete on public.fixed_expenses to authenticated;
grant select, insert, update, delete on public.monthly_expenses to authenticated;
