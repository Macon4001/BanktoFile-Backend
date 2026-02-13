-- Fix missing current_period_end for dsa.retailers@gmail.com
-- Based on Stripe data: Started Jan 29, 12:32 - Ends Feb 28, 12:32

UPDATE users 
SET 
  current_period_start = '2026-01-29 12:32:14+00'::timestamp with time zone,
  current_period_end = '2026-02-28 12:32:14+00'::timestamp with time zone,
  updated_at = NOW()
WHERE email = 'dsa.retailers@gmail.com';

-- Verify the update
SELECT 
  email, 
  plan, 
  subscription_status,
  current_period_start,
  current_period_end,
  billing_interval
FROM users 
WHERE email = 'dsa.retailers@gmail.com';
