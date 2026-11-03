-- Database hardening: privilege boundaries and query support.
-- Public schedule reads remain available; all writes go through the backend API.

CREATE INDEX IF NOT EXISTS schedule_change_log_entry_id_idx
  ON public.schedule_change_log (schedule_entry_id)
  WHERE schedule_entry_id IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

REVOKE ALL PRIVILEGES
  ON TABLE public.app_roles,
            public.representative_group_access,
            public.representative_password_vault,
            public.schedule_change_log
  FROM anon, authenticated;
