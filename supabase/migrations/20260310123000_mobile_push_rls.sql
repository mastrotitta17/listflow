alter table public.mobile_push_tokens enable row level security;
alter table public.mobile_push_messages enable row level security;

drop policy if exists "service_role_all_mobile_push_tokens" on public.mobile_push_tokens;
create policy "service_role_all_mobile_push_tokens"
  on public.mobile_push_tokens
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_all_mobile_push_messages" on public.mobile_push_messages;
create policy "service_role_all_mobile_push_messages"
  on public.mobile_push_messages
  for all
  to service_role
  using (true)
  with check (true);
