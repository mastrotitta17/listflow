create table if not exists guest_sheet_uploads (
  id              bigserial primary key,
  client_id       text        not null,
  sheet_row_id    text        not null,
  status          text        not null default 'processing',
  claimed_at      timestamptz,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  etsy_listing_id text,
  etsy_listing_url text,
  error           text,

  constraint guest_sheet_uploads_client_row_uq unique (client_id, sheet_row_id)
);

create index if not exists guest_sheet_uploads_client_id_idx
  on guest_sheet_uploads (client_id);

create index if not exists guest_sheet_uploads_status_idx
  on guest_sheet_uploads (status);
