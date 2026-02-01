import { Router } from 'express';
import { BlogController } from '../controllers/blogController.js';
import { BlogImportController } from '../controllers/blogImportController.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import multer from 'multer';

const router = Router();
const blogController = new BlogController();
const blogImportController = new BlogImportController();

// Configure multer for image uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Configure multer for markdown file uploads
const markdownUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for markdown files
  },
  fileFilter: (_req, file, cb) => {
    // Allow markdown and text files
    if (file.mimetype === 'text/markdown' ||
        file.mimetype === 'text/plain' ||
        file.originalname.endsWith('.md') ||
        file.originalname.endsWith('.markdown')) {
      cb(null, true);
    } else {
      cb(new Error('Only markdown files are allowed'));
    }
  },
});

// Public routes
router.get('/posts', (req, res) => blogController.getAllPosts(req, res));
router.get('/posts/:slug', (req, res) => blogController.getPostBySlug(req, res));
router.get('/images/:id', (req, res) => blogController.getPostImage(req, res)); // Serve images from PostgreSQL

// Newsletter routes
router.post('/newsletter/subscribe', (req, res) => blogController.subscribeNewsletter(req, res));
router.post('/newsletter/unsubscribe', (req, res) => blogController.unsubscribeNewsletter(req, res));

// Admin routes - Protected with requireAdmin middleware
router.get('/admin/posts', requireAdmin, (req, res) => blogController.getAllPostsAdmin(req, res));
router.get('/admin/posts/:id', requireAdmin, (req, res) => blogController.getPostById(req, res));
router.post('/admin/posts', requireAdmin, (req, res) => blogController.createPost(req, res));
router.put('/admin/posts/:id', requireAdmin, (req, res) => blogController.updatePost(req, res));
router.delete('/admin/posts/:id', requireAdmin, (req, res) => blogController.deletePost(req, res));
router.post('/admin/upload-image', requireAdmin, upload.single('image'), (req, res) => blogController.uploadImage(req, res));
router.get('/admin/newsletter/subscribers', requireAdmin, (req, res) => blogController.getNewsletterSubscribers(req, res));

// Markdown import routes
router.post('/admin/posts/import-md', requireAdmin, markdownUpload.single('file'), (req, res) => blogImportController.importMarkdownPost(req, res));
router.post('/admin/posts/import-md-bulk', requireAdmin, markdownUpload.array('files', 50), (req, res) => blogImportController.importMarkdownBulk(req, res));

export default router;
