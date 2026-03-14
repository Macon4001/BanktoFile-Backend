-- Add Password Reset Functionality
-- Date: 2026-03-14
-- Purpose: Add fields to support password reset flow

BEGIN;

-- Add password reset token and expiry fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE;

-- Add index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
ON users(password_reset_token)
WHERE password_reset_token IS NOT NULL;

-- Add comments
COMMENT ON COLUMN users.password_reset_token IS 'SHA-256 hashed password reset token. Token is sent to user via email and expires after 1 hour.';
COMMENT ON COLUMN users.password_reset_expires IS 'Expiry timestamp for password reset token (1 hour from generation).';

COMMIT;

-- Verification query
-- SELECT COUNT(*) as users_with_pending_resets
-- FROM users
-- WHERE password_reset_token IS NOT NULL
--   AND password_reset_expires > NOW();
