-- Defense in depth: internal reports, alert claims and support inbox data are accessed only
-- through the authenticated backend using the service role. RLS remains enabled.
revoke all privileges on table
  public.schedule_change_reports,
  public.schedule_report_alerts,
  public.support_messages,
  public.support_sessions
from anon, authenticated;
