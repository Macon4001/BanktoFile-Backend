-- Migration: Update blog_posts table to match new requirements
-- This migration adds new fields and updates existing structure

-- Add new columns to blog_posts
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS featured_image_alt VARCHAR(255),
ADD COLUMN IF NOT EXISTS tags TEXT[], -- Array of tags
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
ADD COLUMN IF NOT EXISTS author VARCHAR(255) NOT NULL DEFAULT 'Michael';

-- Update existing data: migrate 'published' boolean to 'status' enum
UPDATE blog_posts
SET status = CASE
    WHEN published = true THEN 'published'
    ELSE 'draft'
END
WHERE status = 'draft'; -- Only update if not already set

-- Drop the old published column (optional - you can keep it for backwards compatibility)
-- ALTER TABLE blog_posts DROP COLUMN IF EXISTS published;

-- Update meta_description to have 160 char recommendation (no hard limit to avoid data loss)
-- We'll enforce this in the application layer instead
COMMENT ON COLUMN blog_posts.meta_description IS 'SEO meta description (recommended max 160 characters)';

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);

-- Create index on tags for better search performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_tags ON blog_posts USING GIN(tags);

-- Update the trigger to still work with the new schema
-- The existing update_blog_posts_updated_at trigger will still work

-- Add comment to explain the new structure
COMMENT ON TABLE blog_posts IS 'Blog posts with SEO optimization, tags, and status management';
COMMENT ON COLUMN blog_posts.tags IS 'Array of tag strings for categorization and filtering';
COMMENT ON COLUMN blog_posts.status IS 'Publication status: draft or published';
COMMENT ON COLUMN blog_posts.author IS 'Post author name (default: Michael)';
COMMENT ON COLUMN blog_posts.featured_image_alt IS 'Alt text for featured image (accessibility and SEO)';
