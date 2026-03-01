create table if not exists public.learn_guides (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_tr text not null,
  category_en text not null,
  title_tr text not null,
  title_en text not null,
  summary_tr text not null default '',
  summary_en text not null default '',
  tags_tr text[] not null default '{}',
  tags_en text[] not null default '{}',
  youtube_id text not null default '',
  duration_minutes integer not null default 1 check (duration_minutes >= 0),
  sections_tr jsonb not null default '[]'::jsonb,
  sections_en jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists learn_guides_published_sort_idx
  on public.learn_guides (is_published, sort_order, updated_at desc);

create or replace function public.touch_learn_guides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_learn_guides_updated_at on public.learn_guides;

create trigger trg_touch_learn_guides_updated_at
before update on public.learn_guides
for each row
execute function public.touch_learn_guides_updated_at();
