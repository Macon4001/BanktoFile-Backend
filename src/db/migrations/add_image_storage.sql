-- Migration: Add image storage to blog_posts table
-- Store images directly in PostgreSQL using bytea

-- Add columns for storing image data
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS featured_image_data BYTEA,
ADD COLUMN IF NOT EXISTS featured_image_filename VARCHAR(255),
ADD COLUMN IF NOT EXISTS featured_image_mimetype VARCHAR(100),
ADD COLUMN IF NOT EXISTS featured_image_size INTEGER;

-- Add index for faster image retrieval
CREATE INDEX IF NOT EXISTS idx_blog_posts_image_data ON blog_posts(id) WHERE featured_image_data IS NOT NULL;

-- Add comments
COMMENT ON COLUMN blog_posts.featured_image_data IS 'Binary data of the featured image stored in PostgreSQL';
COMMENT ON COLUMN blog_posts.featured_image_filename IS 'Original filename of the uploaded image';
COMMENT ON COLUMN blog_posts.featured_image_mimetype IS 'MIME type of the image (e.g., image/jpeg, image/png)';
COMMENT ON COLUMN blog_posts.featured_image_size IS 'Size of the image in bytes';

-- Note: featured_image_url can still be used for external URLs if needed
-- The system will prioritize featured_image_data if it exists, otherwise fall back to URL
