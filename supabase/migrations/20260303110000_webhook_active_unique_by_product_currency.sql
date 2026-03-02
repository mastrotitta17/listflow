-- Eski kural product_id bazlı tek aktif automation webhook'tu.
-- Yeni kural aynı product_id için USD ve TRY ayrı ayrı aktif webhook'a izin verir.

drop index if exists public.uniq_webhook_configs_active_automation_product;

update public.webhook_configs
set currency = case
  when upper(coalesce(currency, '')) = 'TRY' then 'TRY'
  else 'USD'
end
where currency is null
   or upper(currency) not in ('USD', 'TRY');

create unique index if not exists uniq_webhook_configs_active_automation_product_currency
  on public.webhook_configs (product_id, currency)
  where product_id is not null
    and enabled = true
    and scope = 'automation';
