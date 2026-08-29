-- Shared J.I. Systems membership foundation.
-- Review, then run after 001_tech180_entitlements.sql.

create table if not exists public.membership_plans (
  slug text primary key,
  name text not null unique,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents integer not null check (annual_price_cents >= 0),
  app_limit integer,
  sort_order integer not null,
  active boolean not null default true
);

insert into public.membership_plans
  (slug, name, monthly_price_cents, annual_price_cents, app_limit, sort_order)
values
  ('origin', 'Origin', 0, 0, 0, 1),
  ('spark', 'Spark', 3900, 39000, 2, 2),
  ('surge', 'Surge', 7900, 79000, null, 3),
  ('apex', 'Apex', 14900, 149000, null, 4)
on conflict (slug) do update set
  name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents,
  app_limit = excluded.app_limit,
  sort_order = excluded.sort_order;

create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_slug text not null default 'origin' references public.membership_plans(slug),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  billing_period text check (billing_period in ('monthly', 'annual')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_tool_selections (
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null check (tool_slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now(),
  primary key (user_id, tool_slug)
);

create table if not exists public.tool_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null check (tool_slug ~ '^[a-z0-9-]+$'),
  event_type text not null,
  units integer not null default 1 check (units > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tool_usage_user_tool_time_idx
  on public.tool_usage_events (user_id, tool_slug, created_at desc);

-- Existing accounts and every future account receive Origin automatically.
insert into public.memberships (user_id, plan_slug)
select id, 'origin' from auth.users
on conflict (user_id) do nothing;

create or replace function public.add_origin_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (user_id, plan_slug)
  values (new.id, 'origin') on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists add_origin_membership_after_signup on auth.users;
create trigger add_origin_membership_after_signup
after insert on auth.users for each row execute function public.add_origin_membership();

alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_tool_selections enable row level security;
alter table public.tool_usage_events enable row level security;

drop policy if exists "Anyone can read active membership plans" on public.membership_plans;
create policy "Anyone can read active membership plans" on public.membership_plans
for select using (active = true);

drop policy if exists "Users can read their membership" on public.memberships;
create policy "Users can read their membership" on public.memberships
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can read their selected tools" on public.membership_tool_selections;
create policy "Users can read their selected tools" on public.membership_tool_selections
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can read their usage" on public.tool_usage_events;
create policy "Users can read their usage" on public.tool_usage_events
for select to authenticated using (auth.uid() = user_id);

-- Browsers cannot change membership, Stripe IDs, access, or usage totals.
-- Verified backend webhooks and protected API functions perform those writes.
