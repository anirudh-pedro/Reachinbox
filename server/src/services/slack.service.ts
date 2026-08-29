import axios from 'axios';
import { prisma } from '../config/prisma.js';
import { rateLimitEvents } from './rate-limiter.service.js';

interface SlackAlertParams {
  senderEmail: string;
  senderId: string;
  userId?: string;
  hourlyLimit: number;
  currentCount: number;
  nextHourTimestamp: Date;
  emailJobId: string;
}

export async function sendSlackRateLimitAlert(params: SlackAlertParams): Promise<boolean> {
  const { senderEmail, hourlyLimit, currentCount, nextHourTimestamp, userId } = params;

  try {
    // 1. Find active Slack integration for this user or global tenant
    const integration = await prisma.slackIntegration.findFirst({
      where: {
        isActive: true,
        ...(userId ? { userId } : {}),
      },
    });

    if (!integration) {
      console.log(`ℹ️ [Slack] No active Slack integration found. Rate limit event skipped (graceful no-op).`);
      return false;
    }

    const resumeTimeStr = nextHourTimestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });

    const payload = {
      text: `🚨 *ReachInbox Rate Limit Alert:* Sender \`${senderEmail}\` has exceeded the hourly send limit!`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Sender Hourly Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender Account:*\n\`${senderEmail}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Hourly Quota:*\n${currentCount} / ${hourlyLimit} emails`,
            },
            {
              type: 'mrkdwn',
              text: `*Action Taken:*\nDelayed & Rescheduled`,
            },
            {
              type: 'mrkdwn',
              text: `*Next Send Window:*\n${resumeTimeStr}`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ *ReachInbox Zero-Drop Engine:* No emails were dropped. Remaining campaign leads will automatically resume.',
            },
          ],
        },
      ],
    };

    if (integration.incomingWebhookUrl) {
      // Send via Webhook
      await axios.post(integration.incomingWebhookUrl, payload, { timeout: 5000 });
      console.log(`🔔 [Slack] Rate limit alert dispatched successfully via Webhook to channel: ${integration.channelName || 'default'}`);
      return true;
    } else if (integration.accessToken && integration.channelId) {
      // Send via Web API
      await axios.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: integration.channelId,
          ...payload,
        },
        {
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );
      console.log(`🔔 [Slack] Rate limit alert dispatched via Web API to channel: ${integration.channelId}`);
      return true;
    }

    return false;
  } catch (err: any) {
    console.error('❌ [Slack] Failed to send notification:', err.response?.data || err.message);
    return false;
  }
}

// Hook into rate limit event emitter
rateLimitEvents.on('RATE_LIMIT_TRIPPED', (data: SlackAlertParams) => {
  console.log(`⚡ [Slack Listener] RATE_LIMIT_TRIPPED received for sender ${data.senderEmail}`);
  sendSlackRateLimitAlert(data).catch((err) => {
    console.error('❌ [Slack Listener] Unhandled error:', err.message);
  });
});
