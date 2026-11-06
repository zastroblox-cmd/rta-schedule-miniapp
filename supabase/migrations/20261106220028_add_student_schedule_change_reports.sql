create table if not exists public.schedule_change_reports (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.student_groups(id) on delete cascade,
  schedule_date date not null,
  starts_at time without time zone not null,
  ends_at time without time zone,
  subject text not null default '',
  report_type text not null check (report_type in ('cancelled','moved','room','teacher','other')),
  details text not null default '' check (char_length(details) <= 300),
  reporter_hash text not null check (char_length(reporter_hash) = 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_change_reports_one_per_user_slot unique (group_id, schedule_date, starts_at, reporter_hash)
);
create index if not exists schedule_change_reports_group_date_idx
  on public.schedule_change_reports (group_id, schedule_date, starts_at);
alter table public.schedule_change_reports enable row level security;
