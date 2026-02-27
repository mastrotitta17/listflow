create table if not exists public.extension_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  store_id text,
  store_name text,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  event text not null,
  message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists extension_logs_user_id_idx on public.extension_logs(user_id);
create index if not exists extension_logs_created_at_idx on public.extension_logs(created_at desc);
create index if not exists extension_logs_level_idx on public.extension_logs(level);
create index if not exists extension_logs_store_id_idx on public.extension_logs(store_id);

alter table public.extension_logs enable row level security;

-- Only service role (admin backend) can insert/read logs
create policy "service_role_all_extension_logs"
  on public.extension_logs
  for all
  to service_role
  using (true)
  with check (true);
