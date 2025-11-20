import { Router } from 'express';
import { BlogController } from '../controllers/blogController.js';

const router = Router();
const blogController = new BlogController();

// Public routes
router.get('/posts', (req, res) => blogController.getAllPosts(req, res));
router.get('/posts/:slug', (req, res) => blogController.getPostBySlug(req, res));

// Newsletter routes
router.post('/newsletter/subscribe', (req, res) => blogController.subscribeNewsletter(req, res));
router.post('/newsletter/unsubscribe', (req, res) => blogController.unsubscribeNewsletter(req, res));

// Admin routes (TODO: Add authentication middleware)
router.post('/posts', (req, res) => blogController.createPost(req, res));
router.put('/posts/:id', (req, res) => blogController.updatePost(req, res));
router.delete('/posts/:id', (req, res) => blogController.deletePost(req, res));
router.get('/newsletter/subscribers', (req, res) => blogController.getNewsletterSubscribers(req, res));

export default router;
