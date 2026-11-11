create table if not exists public.schedule_change_subscriptions (
  telegram_user_id text primary key check (telegram_user_id ~ '^[0-9]{1,24}$'),
  group_id bigint not null references public.student_groups(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_change_subscriptions_group_enabled_idx
  on public.schedule_change_subscriptions (group_id, enabled);

alter table public.schedule_change_subscriptions enable row level security;
revoke all on public.schedule_change_subscriptions from anon, authenticated;
