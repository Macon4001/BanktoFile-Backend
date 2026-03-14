-- Fix Page Tracking Data Migration
-- Date: 2026-03-14
-- Purpose: Reset incorrect page tracking data and add documentation

-- IMPORTANT: This migration should be run AFTER deploying the code fixes
-- See: PAGE_TRACKING_FIX.md for full details

BEGIN;

-- Step 1: Reset pages_used_today for free users
-- This field was incorrectly tracking page count instead of file count
-- Since the old data is wrong, we reset it to 0 for all free users
UPDATE users
SET pages_used_today = 0,
    updated_at = NOW()
WHERE plan = 'free'
  AND pages_used_today > 0;

-- Step 2: Add comments to clarify confusing field names
COMMENT ON COLUMN users.pages_used_today IS 'Number of FILES converted today (for free users only). Despite the name "pages", this tracks file count. Free tier limit: 3 files/day. Resets daily at midnight UTC.';

COMMENT ON COLUMN users.daily_pages_limit IS 'Daily FILE limit for free users (default: 3). Despite the name "pages_limit", this is actually a files-per-day limit.';

COMMENT ON COLUMN users.files_used_monthly IS 'Number of files converted in the current billing period. Used for all users (free and paid). Free users: tracked for analytics. Paid users: tracked against monthly file limits.';

COMMENT ON COLUMN conversion_logs.pages_converted IS 'Actual PDF page count at time of conversion. NOTE: Historical data before 2026-03-14 may contain transaction counts instead of page counts due to a bug.';

-- Step 3: Add index to improve daily reset performance
-- Note: Removed CURRENT_DATE from WHERE clause as it's not immutable
CREATE INDEX IF NOT EXISTS idx_users_free_daily_reset
ON users(last_reset_date, plan)
WHERE plan = 'free';

COMMENT ON INDEX idx_users_free_daily_reset IS 'Speeds up daily reset queries for free users by indexing last_reset_date';

COMMIT;

-- Verification queries to run after migration:
--
-- 1. Check free users daily usage (should all be 0 or low numbers):
-- SELECT email, plan, pages_used_today, daily_pages_limit, last_reset_date
-- FROM users
-- WHERE plan = 'free'
-- ORDER BY pages_used_today DESC
-- LIMIT 20;
--
-- 2. Check recent conversion logs:
-- SELECT u.email, u.plan, cl.file_name, cl.pages_converted, cl.timestamp
-- FROM conversion_logs cl
-- JOIN users u ON u.id = cl.user_id
-- ORDER BY cl.timestamp DESC
-- LIMIT 20;
--
-- 3. Check files_used_monthly is tracking correctly:
-- SELECT plan,
--        COUNT(*) as user_count,
--        AVG(files_used_monthly) as avg_files,
--        MAX(files_used_monthly) as max_files
-- FROM users
-- GROUP BY plan;
