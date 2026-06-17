-- Ban abuser: info@asmltax.co.uk (James Brooker)
-- User ID: af6c243a-0851-4176-b2c7-03981abf660f
-- Offense: Exploited bug to bypass daily file limits (13 conversions when limit is 3)
-- Date: 2026-05-21

BEGIN;

-- Update user to set plan as 'canceled' and add a note
UPDATE users
SET
  plan = 'banned',
  stripe_status = 'banned',
  daily_pages_limit = 0,
  monthly_files_limit = 0,
  pages_used_today = 999,
  files_used_monthly = 999
WHERE id = 'af6c243a-0851-4176-b2c7-03981abf660f';

-- Add a note to their metadata or create an admin log
-- (If you have an admin_logs table, log the ban there)

SELECT
  id,
  email,
  name,
  plan,
  stripe_status,
  pages_used_today,
  daily_pages_limit
FROM users
WHERE id = 'af6c243a-0851-4176-b2c7-03981abf660f';

COMMIT;

-- Verification: Check their conversion history
SELECT
  COUNT(*) FILTER (WHERE event_name = 'conversion_completed') as total_conversions,
  COUNT(*) FILTER (WHERE event_name = 'conversion_completed' AND created_at >= '2026-05-21') as conversions_today,
  MIN(created_at) as first_event,
  MAX(created_at) as last_event
FROM events
WHERE session_id = 'session_1779346625244_g8bdwzfv92a';
