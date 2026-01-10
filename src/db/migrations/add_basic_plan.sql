-- Migration: Add 'basic' plan to users table
-- Date: 2026-01-10
-- Description: Adds the new £20 Basic tier to the available plans

-- Update the plan CHECK constraint to include 'basic'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

ALTER TABLE users ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free', 'basic', 'starter', 'professional', 'enterprise'));

-- Note: No need to update existing data as no users are on 'basic' plan yet
-- The new plan will be available for new subscriptions via Stripe
