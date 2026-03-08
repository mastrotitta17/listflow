update public.orders
set shipment_provider = 'navlungo'
where navlungo_status is not null
  and coalesce(shipment_provider, '') <> 'navlungo';

update public.orders
set shipment_label_url = null
where shipment_label_url is not null
  and shipment_label_url = navlungo_tracking_url
  and (
    navlungo_response is null
    or coalesce(navlungo_response ->> 'labelUrl', '') = ''
  );

update public.orders
set shipment_label_url = navlungo_response ->> 'labelUrl'
where coalesce(navlungo_response ->> 'labelUrl', '') <> ''
  and coalesce(shipment_label_url, '') <> navlungo_response ->> 'labelUrl';

update public.orders
set shipment_tracking_number = navlungo_response ->> 'trackingNumber'
where coalesce(navlungo_response ->> 'trackingNumber', '') <> ''
  and coalesce(shipment_tracking_number, '') = '';
