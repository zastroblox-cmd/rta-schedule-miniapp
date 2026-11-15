-- Covers the schedule_entry_id foreign key for efficient joins and cascading deletes.
-- Keep this index in version control as well as the live database.
create index if not exists reminder_deliveries_schedule_entry_id_idx
  on public.reminder_deliveries (schedule_entry_id);
