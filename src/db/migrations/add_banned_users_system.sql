-- Add Banned Users System
-- Date: 2026-05-21
-- Purpose: Track banned users and enforce bans across the application

BEGIN;

-- Add banned flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by VARCHAR(255);

-- Add indexes for efficient banned user queries
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned) WHERE is_banned = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_banned_at ON users(banned_at DESC) WHERE is_banned = TRUE;

-- Add comments
COMMENT ON COLUMN users.is_banned IS 'TRUE if user is permanently banned from the platform';
COMMENT ON COLUMN users.banned_at IS 'Timestamp when the user was banned';
COMMENT ON COLUMN users.banned_reason IS 'Reason for the ban (abuse type, violation details)';
COMMENT ON COLUMN users.banned_by IS 'Admin email who issued the ban';

-- Update the existing plan constraint to allow 'banned' (optional)
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
-- ALTER TABLE users ADD CONSTRAINT users_plan_check
--   CHECK (plan IN ('free', 'basic', 'starter', 'professional', 'enterprise', 'banned'));

COMMIT;

-- Example: How to ban a user
-- UPDATE users
-- SET
--   is_banned = TRUE,
--   banned_at = NOW(),
--   banned_reason = 'Exploited SQL bug to bypass daily conversion limits (13 conversions when limit is 3)',
--   banned_by = 'admin@banktofile.com',
--   daily_pages_limit = 0,
--   monthly_files_limit = 0
-- WHERE email = 'info@asmltax.co.uk';
