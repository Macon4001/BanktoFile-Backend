import { Request, Response } from 'express';
import { db } from '../db/postgres.js';
import matter from 'gray-matter';
import { generateFeaturedImage } from '../services/imageGenerator.js';

interface MarkdownFrontmatter {
  title?: string;
  excerpt?: string;
  category?: string;
  tags?: string[];
  read_time?: string;
  author?: string;
  meta_description?: string;
  status?: 'draft' | 'published' | 'scheduled';
  scheduled_at?: string;
  featured_image_url?: string;
  featured_image_alt?: string;
}

export class BlogImportController {
  /**
   * Import a single markdown file
   * POST /api/blog/admin/posts/import-md
   */
  async importMarkdownPost(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No markdown file provided',
        });
        return;
      }

      // Parse the markdown file
      const fileContent = req.file.buffer.toString('utf-8');
      const result = await this.parseMarkdownFile(fileContent, req.file.originalname);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      // Auto-generate featured image if none provided
      const postData = result.post! as Record<string, unknown>;
      if (!postData.featured_image_url) {
        try {
          const imageBuffer = await generateFeaturedImage({
            title: postData.title as string,
            category: (postData.category as string) || 'general',
          });

          const imageId = await db.saveBlogImage({
            filename: `${postData.slug}-featured.png`,
            mimetype: 'image/png',
            size: imageBuffer.length,
            data: imageBuffer,
          });

          postData.featured_image_url = `/api/blog/images/${imageId}`;
          postData.featured_image_alt = `Featured image for: ${postData.title}`;
        } catch (imageError) {
          console.error('Error generating featured image:', imageError);
          // Continue without image if generation fails
        }
      }

      // Create the blog post
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newPost = await db.createBlogPost(postData as any);

      res.status(201).json({
        success: true,
        post: newPost,
        message: 'Markdown file imported successfully',
      });
    } catch (error) {
      console.error('Error importing markdown file:', error);

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
        error: 'Failed to import markdown file',
      });
    }
  }

  /**
   * Import multiple markdown files
   * POST /api/blog/admin/posts/import-md-bulk
   */
  async importMarkdownBulk(req: Request, res: Response): Promise<void> {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No markdown files provided',
        });
        return;
      }

      const created: Array<{ id: string; title: string; slug: string }> = [];
      const errors: Array<{ filename: string; error: string }> = [];

      // Process each file
      for (const file of req.files) {
        try {
          const fileContent = file.buffer.toString('utf-8');
          const result = await this.parseMarkdownFile(fileContent, file.originalname);

          if (!result.success) {
            errors.push({
              filename: file.originalname,
              error: result.error || 'Unknown error',
            });
            continue;
          }

          // Auto-generate featured image if none provided
          const postData = result.post! as Record<string, unknown>;
          if (!postData.featured_image_url) {
            try {
              const imageBuffer = await generateFeaturedImage({
                title: postData.title as string,
                category: (postData.category as string) || 'general',
              });

              const imageId = await db.saveBlogImage({
                filename: `${postData.slug}-featured.png`,
                mimetype: 'image/png',
                size: imageBuffer.length,
                data: imageBuffer,
              });

              postData.featured_image_url = `/api/blog/images/${imageId}`;
              postData.featured_image_alt = `Featured image for: ${postData.title}`;
            } catch (imageError) {
              console.error('Error generating featured image:', imageError);
              // Continue without image if generation fails
            }
          }

          // Create the blog post
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newPost = await db.createBlogPost(postData as any);
          created.push({
            id: newPost.id,
            title: newPost.title,
            slug: newPost.slug,
          });
        } catch (error) {
          console.error(`Error importing ${file.originalname}:`, error);
          errors.push({
            filename: file.originalname,
            error: error instanceof Error ? error.message : 'Failed to import file',
          });
        }
      }

      res.status(200).json({
        success: true,
        created,
        errors,
        summary: {
          total: req.files.length,
          created: created.length,
          failed: errors.length,
        },
      });
    } catch (error) {
      console.error('Error in bulk import:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to import markdown files',
      });
    }
  }

  /**
   * Parse a markdown file with frontmatter
   */
  private async parseMarkdownFile(
    fileContent: string,
    _filename: string
  ): Promise<{
    success: boolean;
    post?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      // Parse frontmatter and content
      const { data: frontmatter, content } = matter(fileContent) as {
        data: MarkdownFrontmatter;
        content: string;
      };

      // Validate required fields
      if (!frontmatter.title || !frontmatter.title.trim()) {
        return {
          success: false,
          error: 'Missing required field: title',
        };
      }

      // Validate title length
      if (frontmatter.title.length > 60) {
        return {
          success: false,
          error: 'Title must be 60 characters or less',
        };
      }

      // Validate meta description length
      if (frontmatter.meta_description && frontmatter.meta_description.length > 160) {
        return {
          success: false,
          error: 'Meta description must be 160 characters or less',
        };
      }

      // Generate slug from title
      const baseSlug = this.generateSlug(frontmatter.title);
      const slug = await this.generateUniqueSlug(baseSlug);

      // Auto-calculate read time if not provided
      const readTime = frontmatter.read_time || this.calculateReadTime(content);

      // Use first 160 chars of content as excerpt if not provided
      const excerpt =
        frontmatter.excerpt ||
        content.trim().substring(0, 160).replace(/\s+$/, '') + '...';

      // Determine status and publishing details
      let status = frontmatter.status || 'draft';
      let published = false;
      let publishedAt: Date | undefined;
      let scheduledAt: Date | undefined;
      let autoPublish = false;

      if (frontmatter.scheduled_at) {
        // Scheduled publishing
        const scheduledDate = new Date(frontmatter.scheduled_at);
        if (isNaN(scheduledDate.getTime())) {
          return {
            success: false,
            error: 'Invalid scheduled_at date format',
          };
        }
        scheduledAt = scheduledDate;
        autoPublish = true;
        status = 'scheduled';
        published = false;
      } else if (status === 'published') {
        // Publish immediately
        published = true;
        publishedAt = new Date();
      }

      // Build the post object
      const post = {
        title: frontmatter.title,
        slug,
        excerpt,
        content: content.trim(),
        category: frontmatter.category || 'general',
        tags: frontmatter.tags || [],
        read_time: readTime,
        author: frontmatter.author || 'Michael',
        featured_image_url: frontmatter.featured_image_url,
        featured_image_alt: frontmatter.featured_image_alt,
        status,
        published,
        published_at: publishedAt,
        scheduled_at: scheduledAt,
        auto_publish: autoPublish,
        meta_description: frontmatter.meta_description || excerpt,
      };

      return {
        success: true,
        post,
      };
    } catch (error) {
      console.error('Error parsing markdown file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse markdown file',
      };
    }
  }

  /**
   * Generate URL-friendly slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .substring(0, 100); // Limit length
  }

  /**
   * Generate a unique slug by appending numbers if conflicts exist
   */
  private async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 2;
    const MAX_ATTEMPTS = 1000;

    // Check if slug already exists
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const existing = await db.getBlogPostBySlug(slug);
      if (!existing) {
        break;
      }
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Calculate read time based on word count
   * Assumes average reading speed of 200 words per minute
   */
  private calculateReadTime(content: string): string {
    const wordCount = content.trim().split(/\s+/).length;
    const minutes = Math.ceil(wordCount / 200);
    return `${minutes} min read`;
  }
}
