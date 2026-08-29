-- Idempotency and audit ledger for verified Stripe events.
-- Run after 002_memberships.sql.

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

-- No browser policies are intentional. Only the server's Supabase secret key
-- can read or write this ledger or update membership records.
grant select, insert, update, delete on public.memberships to service_role;
grant select, insert on public.stripe_webhook_events to service_role;
