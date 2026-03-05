alter table public.stores
  add column if not exists store_currency text,
  add column if not exists currency text;

update public.stores
set store_currency = case
  when upper(coalesce(store_currency, '')) in ('TRY', 'TL', '₺', 'TURKISHLIRA', 'TURKISH_LIRA') then 'TRY'
  when upper(coalesce(store_currency, '')) = 'USD' then 'USD'
  when upper(coalesce(currency, '')) in ('TRY', 'TL', '₺', 'TURKISHLIRA', 'TURKISH_LIRA') then 'TRY'
  when upper(coalesce(currency, '')) = 'USD' then 'USD'
  else 'USD'
end
where store_currency is null
   or btrim(store_currency) = ''
   or upper(store_currency) not in ('USD', 'TRY');

update public.stores
set currency = case
  when upper(coalesce(store_currency, '')) = 'TRY' then 'try'
  when upper(coalesce(store_currency, '')) = 'USD' then 'usd'
  when upper(coalesce(currency, '')) = 'TRY' then 'try'
  when upper(coalesce(currency, '')) = 'USD' then 'usd'
  else 'usd'
end
where currency is null
   or btrim(currency) = ''
   or lower(currency) not in ('usd', 'try');

alter table public.stores
  alter column store_currency set default 'USD',
  alter column currency set default 'usd';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stores_store_currency_check'
  ) then
    alter table public.stores
      add constraint stores_store_currency_check
      check (store_currency in ('USD', 'TRY'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stores_currency_check'
  ) then
    alter table public.stores
      add constraint stores_currency_check
      check (currency in ('usd', 'try'));
  end if;
end $$;

alter table public.stores
  alter column store_currency set not null,
  alter column currency set not null;
