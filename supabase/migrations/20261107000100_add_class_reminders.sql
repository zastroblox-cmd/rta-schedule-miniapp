create table if not exists public.reminder_subscriptions (
  id bigint generated always as identity primary key,
  telegram_user_id text not null unique check (telegram_user_id ~ '^[0-9]{1,24}$'),
  group_id bigint not null references public.student_groups(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminder_subscriptions_enabled_group_idx
  on public.reminder_subscriptions (group_id)
  where enabled = true;

create table if not exists public.reminder_deliveries (
  id bigint generated always as identity primary key,
  subscription_id bigint not null references public.reminder_subscriptions(id) on delete cascade,
  schedule_entry_id bigint not null references public.schedule_entries(id) on delete cascade,
  schedule_date date not null,
  starts_at time not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, schedule_entry_id, schedule_date)
);

create index if not exists reminder_deliveries_status_date_idx
  on public.reminder_deliveries (status, schedule_date, starts_at);

alter table public.reminder_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;

revoke all on public.reminder_subscriptions from anon, authenticated;
revoke all on public.reminder_deliveries from anon, authenticated;
grant all on public.reminder_subscriptions to service_role;
grant all on public.reminder_deliveries to service_role;
