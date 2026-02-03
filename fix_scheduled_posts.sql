-- Fix all scheduled posts that have NULL scheduled_at dates
-- This sets them to publish one month apart starting March 2026

-- How to Convert HSBC Statements to CSV (2026) - March 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-03-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert HSBC Statements to CSV (2026)'
  AND status = 'scheduled';

-- How to Convert Nationwide Statements to CSV (2026) - April 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-04-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert Nationwide Statements to CSV (2026)'
  AND status = 'scheduled';

-- How to Convert Santander Statements to CSV (2026) - May 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-05-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert Santander Statements to CSV (2026)'
  AND status = 'scheduled';

-- How to Convert NatWest Statements to CSV (2026) - June 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-06-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert NatWest Statements to CSV (2026)'
  AND status = 'scheduled';

-- How to Convert Revolut Statements to CSV (2026) - July 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-07-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert Revolut Statements to CSV (2026)'
  AND status = 'scheduled';

-- How to Convert Metro Bank Statements to CSV (2026) - August 1, 2026 10:00 AM
UPDATE blog_posts
SET scheduled_at = '2026-08-01 10:00:00+00',
    auto_publish = true
WHERE title = 'How to Convert Metro Bank Statements to CSV (2026)'
  AND status = 'scheduled';

-- Verify the updates
SELECT title, status, scheduled_at, auto_publish
FROM blog_posts
WHERE status = 'scheduled'
ORDER BY scheduled_at;
