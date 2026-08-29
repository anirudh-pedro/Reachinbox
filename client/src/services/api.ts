import axios from 'axios';
import type { EmailJob, SenderAccount, Stats, SlackStatus } from '../types';

const API_BASE = '/api';

export const api = {
  // Emails
  async scheduleEmails(data: {
    recipients: string[];
    subject: string;
    body: string;
    startTime?: string;
    delayBetweenEmails?: number;
    hourlyLimit?: number;
    senderId?: string;
  }) {
    const res = await axios.post(`${API_BASE}/emails/schedule`, data);
    return res.data;
  },

  async getScheduledEmails(params?: { page?: number; limit?: number; search?: string }) {
    const res = await axios.get<{ success: boolean; data: EmailJob[]; pagination: any }>(
      `${API_BASE}/emails/scheduled`,
      { params }
    );
    return res.data;
  },

  async getSentEmails(params?: { page?: number; limit?: number; search?: string }) {
    const res = await axios.get<{ success: boolean; data: EmailJob[]; pagination: any }>(
      `${API_BASE}/emails/sent`,
      { params }
    );
    return res.data;
  },

  async searchEmails(params: { q: string; status?: string; page?: number; limit?: number }) {
    const res = await axios.get<{ success: boolean; source: string; data: EmailJob[]; pagination: any }>(
      `${API_BASE}/emails/search`,
      { params }
    );
    return res.data;
  },

  async getStats() {
    const res = await axios.get<{ success: boolean; stats: Stats }>(`${API_BASE}/emails/stats`);
    return res.data.stats;
  },

  async getSenders() {
    const res = await axios.get<{ success: boolean; senders: SenderAccount[] }>(`${API_BASE}/emails/senders`);
    return res.data.senders;
  },

  // Slack
  async getSlackStatus() {
    const res = await axios.get<SlackStatus>(`${API_BASE}/auth/slack/status`);
    return res.data;
  },

  async connectSlackWebhook(webhookUrl: string, channelName?: string) {
    const res = await axios.post(`${API_BASE}/auth/slack/connect-webhook`, { webhookUrl, channelName });
    return res.data;
  },

  async disconnectSlack() {
    const res = await axios.post(`${API_BASE}/auth/slack/disconnect`);
    return res.data;
  },

  async testSlackAlert() {
    const res = await axios.post(`${API_BASE}/auth/slack/test`);
    return res.data;
  },
};
