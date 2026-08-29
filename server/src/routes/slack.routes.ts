import { Router } from 'express';
import {
  getSlackAuthUrl,
  handleSlackCallback,
  connectSlackWebhook,
  getSlackStatus,
  disconnectSlack,
  testSlackNotification,
} from '../controllers/slack.controller.js';

const router = Router();

router.get('/url', getSlackAuthUrl);
router.get('/callback', handleSlackCallback);
router.get('/status', getSlackStatus);
router.post('/connect-webhook', connectSlackWebhook);
router.post('/disconnect', disconnectSlack);
router.post('/test', testSlackNotification);

export default router;
