import { Router } from 'express';
import { BlogController } from '../controllers/blogController.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import multer from 'multer';

const router = Router();
const blogController = new BlogController();

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

export default router;
