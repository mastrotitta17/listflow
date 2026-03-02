alter table if exists public.webhook_configs
  add column if not exists currency text;

update public.webhook_configs
set currency = case
  when upper(coalesce(currency, '')) = 'TRY' then 'TRY'
  else 'USD'
end
where currency is null
   or upper(currency) not in ('USD', 'TRY');

alter table if exists public.webhook_configs
  alter column currency set default 'USD';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_configs_currency_check'
  ) then
    alter table public.webhook_configs
      add constraint webhook_configs_currency_check
      check (currency in ('USD', 'TRY'));
  end if;
end $$;

alter table if exists public.webhook_configs
  alter column currency set not null;
