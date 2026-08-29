import { Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../config/prisma.js';
import { sendSlackRateLimitAlert } from '../services/slack.service.js';

export function getSlackAuthUrl(req: Request, res: Response): void {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/auth/slack/callback';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!clientId) {
    res.status(400).json({
      error: 'Slack Client ID not configured',
      message: 'Please set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in your .env, or use direct webhook connection.',
    });
    return;
  }

  const scopes = ['incoming-webhook', 'chat:write', 'chat:write.public'].join(',');
  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}`;

  if (req.query.redirect === 'true') {
    res.redirect(authUrl);
  } else {
    res.json({ url: authUrl });
  }
}

export async function handleSlackCallback(req: Request, res: Response): Promise<void> {
  const code = req.query.code as string;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const redirectUri = process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/auth/slack/callback';

  if (!code) {
    res.redirect(`${frontendUrl}?slack_connected=error&error=No_code_provided`);
    return;
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.SLACK_CLIENT_ID || '');
    params.append('client_secret', process.env.SLACK_CLIENT_SECRET || '');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    const response = await axios.post('https://slack.com/api/oauth.v2.access', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = response.data;
    if (!data.ok) {
      console.error('Slack OAuth Error:', data.error);
      res.redirect(`${frontendUrl}?slack_connected=error&error=${data.error}`);
      return;
    }

    // Save or update integration
    await prisma.slackIntegration.upsert({
      where: { id: 'default_slack_integration' },
      update: {
        accessToken: data.access_token,
        teamId: data.team?.id,
        teamName: data.team?.name,
        botUserId: data.bot_user_id,
        channelId: data.incoming_webhook?.channel_id,
        channelName: data.incoming_webhook?.channel,
        incomingWebhookUrl: data.incoming_webhook?.url,
        isActive: true,
      },
      create: {
        id: 'default_slack_integration',
        accessToken: data.access_token,
        teamId: data.team?.id,
        teamName: data.team?.name,
        botUserId: data.bot_user_id,
        channelId: data.incoming_webhook?.channel_id,
        channelName: data.incoming_webhook?.channel,
        incomingWebhookUrl: data.incoming_webhook?.url,
        isActive: true,
      },
    });

    console.log(`✅ Slack Connected: Team ${data.team?.name}, Channel: ${data.incoming_webhook?.channel}`);
    res.redirect(`${frontendUrl}?slack_connected=success&channel=${encodeURIComponent(data.incoming_webhook?.channel || '')}`);
  } catch (error: any) {
    console.error('Failed to exchange Slack token:', error.message);
    res.redirect(`${frontendUrl}?slack_connected=error&error=server_error`);
  }
}

export async function connectSlackWebhook(req: Request, res: Response): Promise<void> {
  const { webhookUrl, channelName } = req.body;

  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://hooks.slack.com')) {
    res.status(400).json({ error: 'Invalid Slack Webhook URL. It must start with https://hooks.slack.com' });
    return;
  }

  try {
    await prisma.slackIntegration.upsert({
      where: { id: 'default_slack_integration' },
      update: {
        incomingWebhookUrl: webhookUrl,
        channelName: channelName || '#notifications',
        accessToken: 'webhook_auth',
        isActive: true,
      },
      create: {
        id: 'default_slack_integration',
        incomingWebhookUrl: webhookUrl,
        channelName: channelName || '#notifications',
        accessToken: 'webhook_auth',
        isActive: true,
      },
    });

    res.json({
      success: true,
      message: 'Slack Webhook connected successfully',
      channel: channelName || '#notifications',
    });
  } catch (error: any) {
    console.error('Error connecting webhook:', error);
    res.status(500).json({ error: 'Failed to connect webhook', message: error.message });
  }
}

export async function getSlackStatus(req: Request, res: Response): Promise<void> {
  try {
    const integration = await prisma.slackIntegration.findFirst({
      where: { isActive: true },
    });

    if (!integration) {
      res.json({
        connected: false,
      });
      return;
    }

    res.json({
      connected: true,
      teamName: integration.teamName || 'Workspace',
      channel: integration.channelName || '#general',
      connectedAt: integration.updatedAt,
    });
  } catch (error: any) {
    console.error('Error checking Slack status:', error);
    res.status(500).json({ error: 'Failed to check status', message: error.message });
  }
}

export async function disconnectSlack(req: Request, res: Response): Promise<void> {
  try {
    await prisma.slackIntegration.updateMany({
      data: { isActive: false },
    });

    console.log('🔌 Slack disconnected successfully');
    res.json({ success: true, message: 'Slack disconnected' });
  } catch (error: any) {
    console.error('Error disconnecting Slack:', error);
    res.status(500).json({ error: 'Failed to disconnect Slack', message: error.message });
  }
}

export async function testSlackNotification(req: Request, res: Response): Promise<void> {
  try {
    const sent = await sendSlackRateLimitAlert({
      senderEmail: 'test.sender@reachinbox.test',
      senderId: 'demo-sender',
      hourlyLimit: 200,
      currentCount: 201,
      nextHourTimestamp: new Date(Date.now() + 3600000),
      emailJobId: 'test-job-id',
    });

    if (sent) {
      res.json({ success: true, message: 'Test Slack alert dispatched successfully!' });
    } else {
      res.status(400).json({ success: false, message: 'No active Slack integration configured to receive alerts.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to dispatch test notification', message: error.message });
  }
}
