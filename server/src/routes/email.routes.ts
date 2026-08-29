import { Router } from 'express';
import {
  scheduleEmails,
  getScheduledEmails,
  getSentEmails,
  searchEmailsHandler,
  getStats,
  getSenders,
  getEmailById,
} from '../controllers/email.controller.js';

const router = Router();

router.post('/schedule', scheduleEmails);
router.get('/scheduled', getScheduledEmails);
router.get('/sent', getSentEmails);
router.get('/search', searchEmailsHandler);
router.get('/stats', getStats);
router.get('/senders', getSenders);
router.get('/:id', getEmailById);

export default router;
