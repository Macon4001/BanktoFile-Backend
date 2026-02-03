-- Migration: Add grandfathering support for existing Basic tier subscribers
-- Date: 2026-02-03
-- Purpose: Allow existing £20 Basic subscribers to keep 150 files/month while new subscribers get 30 files/month

-- Add column to track grandfathered Basic users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_grandfathered_basic BOOLEAN DEFAULT FALSE;

-- Mark all existing Basic plan users as grandfathered
-- This ensures they keep their 150 files/month limit
UPDATE users
SET is_grandfathered_basic = TRUE
WHERE plan = 'basic' AND is_grandfathered_basic = FALSE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_grandfathered_basic
ON users(plan, is_grandfathered_basic)
WHERE plan = 'basic';

-- Add comment to document the purpose
COMMENT ON COLUMN users.is_grandfathered_basic IS
'TRUE for existing Basic subscribers with 150 files/month (legacy), FALSE for new Basic subscribers with 30 files/month';
