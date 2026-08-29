import React, { useState } from 'react';
import { X, MessageSquare, CheckCircle2, Send, AlertCircle, Link2, Unlink } from 'lucide-react';
import type { SlackStatus } from '../types';
import { api } from '../services/api';

interface SlackModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: SlackStatus;
  onStatusUpdated: () => void;
}

export const SlackModal: React.FC<SlackModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusUpdated,
}) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channelName, setChannelName] = useState('#rate-limits');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  if (!isOpen) return null;

  const handleOAuthConnect = () => {
    window.location.href = 'http://localhost:5000/api/auth/slack/url?redirect=true';
  };

  const handleWebhookConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!webhookUrl.startsWith('https://hooks.slack.com')) {
      setFeedback({
        type: 'error',
        msg: 'Please provide a valid Slack incoming webhook URL (starting with https://hooks.slack.com).',
      });
      return;
    }

    setIsConnecting(true);
    try {
      await api.connectSlackWebhook(webhookUrl, channelName);
      setFeedback({ type: 'success', msg: 'Slack Webhook connected successfully!' });
      onStatusUpdated();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.response?.data?.error || err.message });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTestAlert = async () => {
    setIsTesting(true);
    setFeedback(null);
    try {
      await api.testSlackAlert();
      setFeedback({ type: 'success', msg: 'Live test rate-limit alert sent to Slack channel!' });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.response?.data?.message || err.message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnectSlack();
      setFeedback({ type: 'success', msg: 'Slack integration disconnected.' });
      onStatusUpdated();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Slack Notifications</h2>
              <p className="text-xs text-gray-400">Real-time alerts when hourly rate limits trip</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {feedback && (
            <div
              className={`p-3 rounded-xl flex items-center space-x-2 text-xs border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                  : 'bg-red-50 border-red-100 text-red-600'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.msg}</span>
            </div>
          )}

          {/* Current Status */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</p>
              <div className="flex items-center space-x-2 mt-1">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    status.connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'
                  }`}
                ></span>
                <span className="text-sm font-medium text-gray-900 truncate">
                  {status.connected ? `Connected (${status.channel || 'Channel'})` : 'Not Connected'}
                </span>
              </div>
            </div>

            {status.connected && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleTestAlert}
                  disabled={isTesting}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <Send className="w-3 h-3" />
                  <span>{isTesting ? 'Sending...' : 'Test Alert'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Unlink className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              </div>
            )}
          </div>

          {/* Connection Methods */}
          {!status.connected && (
            <div className="space-y-4">
              {/* Method 1: Webhook Connect */}
              <form onSubmit={handleWebhookConnect} className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Connect via Incoming Webhook URL
                </p>
                <div>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/T00/B00/XXXX"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-400 font-mono"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="#channel-name"
                    className="w-full sm:w-1/2 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full sm:w-1/2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1 py-2 sm:py-0 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>{isConnecting ? 'Connecting...' : 'Save Webhook'}</span>
                  </button>
                </div>
              </form>

              <div className="flex items-center my-3">
                <div className="flex-1 border-t border-gray-100"></div>
                <span className="px-3 text-[11px] text-gray-400 uppercase font-semibold">Or</span>
                <div className="flex-1 border-t border-gray-100"></div>
              </div>

              {/* Method 2: OAuth Flow */}
              <button
                type="button"
                onClick={handleOAuthConnect}
                className="w-full py-2.5 px-4 rounded-xl bg-[#4A154B] hover:bg-[#3d113e] text-white text-xs font-semibold flex items-center justify-center space-x-2 transition-all shadow-md cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 fill-[#E01E5A]" />
                <span>Authorize with Slack OAuth</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
