import { Request, Response } from 'express';
import { db } from '../db/postgres.js';

export class BlogController {
  // Get all published blog posts
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

  // Get a single blog post by slug
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

  // Create a new blog post (admin only - will add auth later)
  async createPost(req: Request, res: Response): Promise<void> {
    try {
      const {
        title,
        slug,
        excerpt,
        content,
        category,
        readTime,
        featuredImageUrl,
        published,
        metaDescription,
        metaKeywords,
      } = req.body;

      // Validate required fields
      if (!title || !slug || !content) {
        res.status(400).json({
          success: false,
          error: 'Title, slug, and content are required',
        });
        return;
      }

      const newPost = await db.createBlogPost({
        title,
        slug,
        excerpt,
        content,
        category,
        read_time: readTime,
        featured_image_url: featuredImageUrl,
        published: published ?? false,
        published_at: published ? new Date() : undefined,
        meta_description: metaDescription,
        meta_keywords: metaKeywords,
      });

      res.status(201).json({
        success: true,
        post: newPost,
        message: 'Blog post created successfully',
      });
    } catch (error: any) {
      console.error('Error creating blog post:', error);

      // Handle unique constraint violation (duplicate slug)
      if (error.code === '23505') {
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

  // Update a blog post (admin only - will add auth later)
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

      // Convert camelCase to snake_case for database
      const dbUpdates: any = {};
      if (updates.title) dbUpdates.title = updates.title;
      if (updates.slug) dbUpdates.slug = updates.slug;
      if (updates.excerpt !== undefined) dbUpdates.excerpt = updates.excerpt;
      if (updates.content) dbUpdates.content = updates.content;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.readTime !== undefined) dbUpdates.read_time = updates.readTime;
      if (updates.featuredImageUrl !== undefined) dbUpdates.featured_image_url = updates.featuredImageUrl;
      if (updates.published !== undefined) {
        dbUpdates.published = updates.published;
        if (updates.published && !updates.published_at) {
          dbUpdates.published_at = new Date();
        }
      }
      if (updates.metaDescription !== undefined) dbUpdates.meta_description = updates.metaDescription;
      if (updates.metaKeywords !== undefined) dbUpdates.meta_keywords = updates.metaKeywords;

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
    } catch (error: any) {
      console.error('Error updating blog post:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
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
    } catch (error: any) {
      console.error('Error subscribing to newsletter:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
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
}
