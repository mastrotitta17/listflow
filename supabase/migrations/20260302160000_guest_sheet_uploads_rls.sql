-- Enable RLS on guest_sheet_uploads.
-- This table is only accessed via the service role (supabaseAdmin) from
-- server-side API routes, so no anon/user policies are needed.
-- RLS being enabled with no permissive policies means the anon/authenticated
-- roles get zero access — all operations go through the service role only.

alter table guest_sheet_uploads enable row level security;
