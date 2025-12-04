-- Create a separate table for blog images
-- This is much more efficient than storing base64 in blog_posts
CREATE TABLE IF NOT EXISTS blog_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  mimetype VARCHAR(100) NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_blog_images_created_at ON blog_images(created_at DESC);

-- Update blog_posts to reference images by ID instead of storing them inline
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS featured_image_id UUID REFERENCES blog_images(id) ON DELETE SET NULL;

-- Create index for the foreign key
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured_image_id ON blog_posts(featured_image_id);
