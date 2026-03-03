-- Enable RLS on learn_guides to remove "UNRESTRICTED" warning.
-- learn_guides is accessed through server-side routes with service role,
-- so no anon/authenticated policy is required.

alter table public.learn_guides enable row level security;

