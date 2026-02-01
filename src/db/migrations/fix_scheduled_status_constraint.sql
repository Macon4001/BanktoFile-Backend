-- Migration: Fix Status Check Constraint for Scheduled Status
-- Date: 2026-02-01
-- Description: Updates the blog_posts status check constraint to allow 'scheduled' status

-- Drop the existing check constraint if it exists
ALTER TABLE blog_posts
DROP CONSTRAINT IF EXISTS blog_posts_status_check;

-- Add new check constraint that includes 'scheduled'
ALTER TABLE blog_posts
ADD CONSTRAINT blog_posts_status_check
CHECK (status IN ('draft', 'published', 'scheduled'));

-- Verify the constraint
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'blog_posts_status_check';

-- Rollback (if needed):
-- ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
-- ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published'));
