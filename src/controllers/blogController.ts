import { Request, Response } from 'express';
import { db } from '../db/postgres.js';

export class BlogController {
  // Get all published blog posts (public)
  async getAllPosts(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

      const posts = await db.getPublishedBlogPosts(limit, offset);

      res.status(200).json({
        success: true,
        posts,
        count: posts.length,
      });
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch blog posts',
      });
    }
  }

  // Get all blog posts including drafts (admin only)
  async getAllPostsAdmin(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
      const status = req.query.status as string | undefined;

      const posts = await db.getAllBlogPosts(limit, offset, status);

      res.status(200).json({
        success: true,
        posts,
        count: posts.length,
      });
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch blog posts',
      });
    }
  }

  // Get a single blog post by slug (public)
  async getPostBySlug(req: Request, res: Response): Promise<void> {
    try {
      const { slug } = req.params;

      if (!slug) {
        res.status(400).json({
          success: false,
          error: 'Slug is required',
        });
        return;
      }

      const post = await db.getBlogPostBySlug(slug);

      if (!post) {
        res.status(404).json({
          success: false,
          error: 'Blog post not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        post,
      });
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch blog post',
      });
    }
  }

  // Get a single blog post by ID (admin only)
  async getPostById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Post ID is required',
        });
        return;
      }

      const post = await db.getBlogPostById(id);

      if (!post) {
        res.status(404).json({
          success: false,
          error: 'Blog post not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        post,
      });
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch blog post',
      });
    }
  }

  // Create a new blog post (admin only)
  async createPost(req: Request, res: Response): Promise<void> {
    try {
      const {
        title,
        slug,
        excerpt,
        content,
        category,
        tags,
        readTime,
        author,
        featuredImageUrl,
        featuredImageAlt,
        status,
        metaDescription,
      } = req.body;

      // Validate required fields
      if (!title || !content) {
        res.status(400).json({
          success: false,
          error: 'Title and content are required',
        });
        return;
      }

      // Validate title length (max 60 chars recommended)
      if (title.length > 60) {
        res.status(400).json({
          success: false,
          error: 'Title should be 60 characters or less',
        });
        return;
      }

      // Validate meta description length (max 160 chars)
      if (metaDescription && metaDescription.length > 160) {
        res.status(400).json({
          success: false,
          error: 'Meta description should be 160 characters or less',
        });
        return;
      }

      // Auto-generate slug from title if not provided
      const finalSlug = slug || this.generateSlug(title);

      // Validate featured image alt text if image is provided (but not for base64 data URLs)
      if (featuredImageUrl && !featuredImageUrl.startsWith('data:') && !featuredImageAlt) {
        res.status(400).json({
          success: false,
          error: 'Alt text is required when featured image is provided',
        });
        return;
      }

      const finalStatus = status || 'draft';
      const isPublished = finalStatus === 'published';

      const newPost = await db.createBlogPost({
        title,
        slug: finalSlug,
        excerpt,
        content,
        category,
        tags: tags || [],
        read_time: readTime,
        author: author || 'Michael',
        featured_image_url: featuredImageUrl, // Now just stores the /api/blog/images/:id URL
        featured_image_alt: featuredImageAlt,
        status: finalStatus,
        published: isPublished,
        published_at: isPublished ? new Date() : undefined,
        meta_description: metaDescription,
      });

      res.status(201).json({
        success: true,
        post: newPost,
        message: 'Blog post created successfully',
      });
    } catch (error) {
      console.error('Error creating blog post:', error);

      // Handle unique constraint violation (duplicate slug)
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'A blog post with this slug already exists',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to create blog post',
      });
    }
  }

  // Helper function to generate URL-friendly slug from title
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .substring(0, 100); // Limit length
  }

  // Update a blog post (admin only)
  async updatePost(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updates = req.body;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Post ID is required',
        });
        return;
      }

      // Validate title length if being updated
      if (updates.title && updates.title.length > 60) {
        res.status(400).json({
          success: false,
          error: 'Title should be 60 characters or less',
        });
        return;
      }

      // Validate meta description length if being updated
      if (updates.metaDescription && updates.metaDescription.length > 160) {
        res.status(400).json({
          success: false,
          error: 'Meta description should be 160 characters or less',
        });
        return;
      }

      // Validate featured image alt text if image is being added (but not for base64 data URLs)
      if (updates.featuredImageUrl && !updates.featuredImageUrl.startsWith('data:') && !updates.featuredImageAlt) {
        res.status(400).json({
          success: false,
          error: 'Alt text is required when featured image is provided',
        });
        return;
      }

      // Convert camelCase to snake_case for database
      const dbUpdates: Record<string, unknown> = {};
      if (updates.title) dbUpdates.title = updates.title;
      if (updates.slug) dbUpdates.slug = updates.slug;
      if (updates.excerpt !== undefined) dbUpdates.excerpt = updates.excerpt;
      if (updates.content) dbUpdates.content = updates.content;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
      if (updates.readTime !== undefined) dbUpdates.read_time = updates.readTime;
      if (updates.author !== undefined) dbUpdates.author = updates.author;
      if (updates.featuredImageUrl !== undefined) dbUpdates.featured_image_url = updates.featuredImageUrl;
      if (updates.featuredImageAlt !== undefined) dbUpdates.featured_image_alt = updates.featuredImageAlt;
      if (updates.status !== undefined) {
        dbUpdates.status = updates.status;
        dbUpdates.published = updates.status === 'published';
        if (updates.status === 'published' && !updates.published_at) {
          dbUpdates.published_at = new Date();
        }
      }
      if (updates.metaDescription !== undefined) dbUpdates.meta_description = updates.metaDescription;

      const updatedPost = await db.updateBlogPost(id, dbUpdates);

      if (!updatedPost) {
        res.status(404).json({
          success: false,
          error: 'Blog post not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        post: updatedPost,
        message: 'Blog post updated successfully',
      });
    } catch (error) {
      console.error('Error updating blog post:', error);

      // Handle unique constraint violation
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'A blog post with this slug already exists',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update blog post',
      });
    }
  }

  // Delete a blog post (admin only - will add auth later)
  async deletePost(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Post ID is required',
        });
        return;
      }

      const deleted = await db.deleteBlogPost(id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Blog post not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Blog post deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting blog post:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete blog post',
      });
    }
  }

  // Subscribe to newsletter
  async subscribeNewsletter(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          error: 'Email is required',
        });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          error: 'Invalid email format',
        });
        return;
      }

      const subscriber = await db.subscribeToNewsletter(email);

      res.status(200).json({
        success: true,
        subscriber,
        message: 'Successfully subscribed to newsletter',
      });
    } catch (error) {
      console.error('Error subscribing to newsletter:', error);

      // Handle unique constraint violation
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        res.status(200).json({
          success: true,
          message: 'Email is already subscribed',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to subscribe to newsletter',
      });
    }
  }

  // Unsubscribe from newsletter
  async unsubscribeNewsletter(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          error: 'Email is required',
        });
        return;
      }

      const unsubscribed = await db.unsubscribeFromNewsletter(email);

      if (!unsubscribed) {
        res.status(404).json({
          success: false,
          error: 'Email not found in subscribers',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Successfully unsubscribed from newsletter',
      });
    } catch (error) {
      console.error('Error unsubscribing from newsletter:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unsubscribe from newsletter',
      });
    }
  }

  // Get all newsletter subscribers (admin only)
  async getNewsletterSubscribers(req: Request, res: Response): Promise<void> {
    try {
      const subscribers = await db.getNewsletterSubscribers();

      res.status(200).json({
        success: true,
        subscribers,
        count: subscribers.length,
      });
    } catch (error) {
      console.error('Error fetching newsletter subscribers:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch newsletter subscribers',
      });
    }
  }

  // Upload image for blog post (admin only)
  // Stores image in separate blog_images table for better performance
  async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No image file provided',
        });
        return;
      }

      // Save image to blog_images table immediately
      const imageId = await db.saveBlogImage({
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        data: req.file.buffer,
      });

      // Return the image URL that can be used in the blog post
      const imageUrl = `/api/blog/images/${imageId}`;

      res.status(200).json({
        success: true,
        imageId,
        url: imageUrl,
        // Also return preview for immediate display
        preview: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
        message: 'Image uploaded successfully',
      });

    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload image',
      });
    }
  }

  // Get blog image by image ID
  async getPostImage(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Image ID is required',
        });
        return;
      }

      const image = await db.getBlogImage(id);

      if (!image) {
        res.status(404).send('Image not found');
        return;
      }

      // Set proper headers for image delivery
      res.setHeader('Content-Type', image.mimetype);
      res.setHeader('Content-Length', image.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year

      // Send the binary image data
      res.send(image.data);

    } catch (error) {
      console.error('Error fetching image:', error);
      res.status(500).send('Failed to fetch image');
    }
  }
}
