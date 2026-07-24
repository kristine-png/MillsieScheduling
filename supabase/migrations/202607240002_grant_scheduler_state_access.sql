grant usage on schema public to authenticated;
grant select, insert, update on table public.scheduler_state to authenticated;

revoke all on table public.scheduler_state from anon;
