create table if not exists public.schedule_report_alerts (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.student_groups(id) on delete cascade,
  schedule_date date not null,
  starts_at time without time zone not null,
  cancelled_count integer not null default 0 check (cancelled_count >= 3),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint schedule_report_alerts_one_per_lesson unique (group_id, schedule_date, starts_at)
);

create index if not exists schedule_report_alerts_date_idx
  on public.schedule_report_alerts (schedule_date, group_id);

alter table public.schedule_report_alerts enable row level security;
