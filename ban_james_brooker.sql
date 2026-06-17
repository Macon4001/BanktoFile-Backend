-- Ban James Brooker (info@asmltax.co.uk) from FREE tier for abuse
-- Date: 2026-05-21
-- Offense: 13 conversions in 3 minutes when limit is 3 per day
--
-- ⚠️ IMPORTANT: This ONLY blocks FREE tier access
-- If they upgrade to a PAID plan (Starter/Professional), they CAN use the service
--
-- How it works:
--   - plan = 'free' → uses daily_pages_limit (we set to 0 = blocked)
--   - plan = 'starter'/'professional' → uses monthly_files_limit (keeps normal limits)
--
-- So if they pay, they get access. If they abuse again, you can ban them completely.

BEGIN;

-- Ban from FREE tier only (paid plans will still work if they subscribe)
UPDATE users
SET
  daily_pages_limit = 0,        -- Block FREE daily conversions
  pages_used_today = 999        -- Mark as exceeded for free tier
  -- NOTE: We DON'T touch monthly_files_limit - paid plans will work fine
WHERE email = 'info@asmltax.co.uk';

-- Verify the ban
SELECT
  email,
  name,
  plan,
  daily_pages_limit AS free_limit_blocked,
  monthly_files_limit AS paid_limit_still_works,
  pages_used_today,
  files_used_monthly,
  last_conversion_at
FROM users
WHERE email = 'info@asmltax.co.uk';

COMMIT;

-- ============================================
-- What happens when they try to convert:
-- ============================================
-- If plan = 'free':
--   ❌ daily_pages_limit = 0 → BLOCKED
--   ❌ pages_used_today = 999 → BLOCKED (shows as exceeded)
--
-- If they upgrade to plan = 'starter' (£40/month):
--   ✅ Uses monthly_files_limit = 400 → ALLOWED
--   ✅ Gets 400 conversions per month
--   ✅ Session rate limit: 20/day for authenticated users
--
-- If they abuse the PAID plan too:
--   → Ban them completely by setting monthly_files_limit = 0
--   → Or run the full ban script below with is_banned = TRUE

-- ============================================
-- OPTIONAL: Complete permanent ban (if they abuse PAID tier too)
-- ============================================
-- Run add_banned_users_system.sql migration first, then:
--
-- BEGIN;
--
-- UPDATE users
-- SET
--   is_banned = TRUE,
--   banned_at = NOW(),
--   banned_reason = 'Continued abuse after free tier ban. Multiple violations.',
--   banned_by = 'admin@banktofile.com',
--   daily_pages_limit = 0,      -- Block free tier
--   monthly_files_limit = 0     -- Block paid tier too
-- WHERE email = 'info@asmltax.co.uk';
--
-- SELECT email, name, plan, is_banned, banned_reason FROM users WHERE email = 'info@asmltax.co.uk';
--
-- COMMIT;
