-- Add email tracking fields to users table
-- Migration: add_email_tracking.sql

-- Add email tracking fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nudge_email_sent BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS limit_hit_email_sent BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS upgrade_reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS limit_hit_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_conversion_at TIMESTAMP;

-- Add indexes for email job queries
CREATE INDEX IF NOT EXISTS idx_users_welcome_email ON users(welcome_email_sent, created_at) WHERE welcome_email_sent = false;
CREATE INDEX IF NOT EXISTS idx_users_nudge_email ON users(nudge_email_sent, created_at, files_used_monthly) WHERE nudge_email_sent = false;
CREATE INDEX IF NOT EXISTS idx_users_limit_hit ON users(limit_hit_email_sent, limit_hit_at) WHERE limit_hit_email_sent = false;
CREATE INDEX IF NOT EXISTS idx_users_upgrade_reminder ON users(upgrade_reminder_sent, limit_hit_at, plan) WHERE upgrade_reminder_sent = false AND plan = 'free';

-- Comment on columns
COMMENT ON COLUMN users.welcome_email_sent IS 'Whether welcome email has been sent';
COMMENT ON COLUMN users.nudge_email_sent IS 'Whether day 3 nudge email has been sent';
COMMENT ON COLUMN users.limit_hit_email_sent IS 'Whether limit hit email has been sent';
COMMENT ON COLUMN users.upgrade_reminder_sent IS 'Whether day 7 upgrade reminder has been sent';
COMMENT ON COLUMN users.limit_hit_at IS 'Timestamp when user first hit their conversion limit';
COMMENT ON COLUMN users.last_conversion_at IS 'Timestamp of user last conversion';
