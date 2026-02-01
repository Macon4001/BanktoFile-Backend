-- Migration: Add Scheduled Publishing Support
-- Date: 2025-02-01
-- Description: Adds scheduled_at and auto_publish columns to blog_posts table

-- Add new columns for scheduled publishing
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN DEFAULT false;

-- Create index for efficient querying of scheduled posts
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled
ON blog_posts(auto_publish, scheduled_at)
WHERE auto_publish = true AND published = false;

-- Add comment for documentation
COMMENT ON COLUMN blog_posts.scheduled_at IS 'Future timestamp when post should be automatically published';
COMMENT ON COLUMN blog_posts.auto_publish IS 'Whether to automatically publish this post at scheduled_at time';

-- Rollback script (commented out, run manually if needed):
-- ALTER TABLE blog_posts DROP COLUMN IF EXISTS scheduled_at;
-- ALTER TABLE blog_posts DROP COLUMN IF EXISTS auto_publish;
-- DROP INDEX IF EXISTS idx_blog_posts_scheduled;
