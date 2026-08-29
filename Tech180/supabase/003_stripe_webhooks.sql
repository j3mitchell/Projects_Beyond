-- Run after the J.I. Systems membership migration.
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

-- No browser policies: only the private backend key can use this ledger.
grant select, insert, update, delete on public.memberships to service_role;
grant select, insert on public.stripe_webhook_events to service_role;
