-- Add billing interval field to users table
-- Migration: add_billing_interval.sql
-- Purpose: Track whether users are on monthly or yearly billing cycles

-- Add billing_interval field
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(20) DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'yearly'));

-- Add index for queries filtering by billing interval
CREATE INDEX IF NOT EXISTS idx_users_billing_interval ON users(billing_interval);

-- Comment on column
COMMENT ON COLUMN users.billing_interval IS 'Billing cycle frequency: monthly or yearly subscriptions';
