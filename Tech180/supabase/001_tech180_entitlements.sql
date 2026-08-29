-- Tech180 private-beta access list.
-- Run this file once in Supabase: SQL Editor -> New query -> Run.

create table if not exists public.tool_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null check (tool_slug ~ '^[a-z0-9-]+$'),
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, tool_slug)
);

alter table public.tool_entitlements enable row level security;

drop policy if exists "Users can read their own tool access" on public.tool_entitlements;
create policy "Users can read their own tool access"
on public.tool_entitlements
for select
to authenticated
using (auth.uid() = user_id);

-- There are deliberately no browser INSERT, UPDATE, or DELETE policies.
