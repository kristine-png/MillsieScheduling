create table if not exists public.scheduler_state (
  workspace_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.scheduler_state enable row level security;

create policy "Authenticated team members can read scheduler state"
on public.scheduler_state
for select
to authenticated
using (true);

create policy "Authenticated team members can create scheduler state"
on public.scheduler_state
for insert
to authenticated
with check (auth.uid() = updated_by);

create policy "Authenticated team members can update scheduler state"
on public.scheduler_state
for update
to authenticated
using (true)
with check (auth.uid() = updated_by);

insert into public.scheduler_state (workspace_id, state)
values ('millsie-production', '{}'::jsonb)
on conflict (workspace_id) do nothing;
