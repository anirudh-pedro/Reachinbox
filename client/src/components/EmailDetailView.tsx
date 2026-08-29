import React from 'react';
import { ArrowLeft, Star, Archive, Trash2, MoreHorizontal, ExternalLink, Menu } from 'lucide-react';
import type { EmailJob } from '../types';

interface EmailDetailViewProps {
  email: EmailJob;
  onBack: () => void;
  onOpenMobileNav: () => void;
}

function formatFullDate(value?: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const EmailDetailView: React.FC<EmailDetailViewProps> = ({ email, onBack, onOpenMobileNav }) => {
  const senderEmail = email.sender?.email || 'sender@example.com';
  const senderName = email.sender?.name || senderEmail.split('@')[0];
  const initial = senderName.charAt(0).toUpperCase();
  const shortRef = email.id.slice(0, 8).toUpperCase();

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-white min-w-0">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            title="Open menu"
            onClick={onOpenMobileNav}
            className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer md:hidden shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm text-gray-800 min-w-0 truncate">
            <span className="font-medium">{email.subject}</span>
            <span className="text-gray-400"> | REF#{shortRef}</span>
          </h2>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-4 text-gray-400 shrink-0">
          <Star className="w-4 h-4 cursor-pointer hover:text-gray-600 shrink-0" />
          <Archive className="w-4 h-4 cursor-pointer hover:text-gray-600 shrink-0" />
          <Trash2 className="w-4 h-4 cursor-pointer hover:text-gray-600 shrink-0" />
          <MoreHorizontal className="w-4 h-4 cursor-pointer hover:text-gray-600 shrink-0" />
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=64&h=64&fit=crop&crop=faces"
            alt=""
            className="w-7 h-7 rounded-full object-cover ml-1 shrink-0"
          />
        </div>
      </div>

      {/* Email content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-3xl w-full">
        <div className="flex items-start gap-3 pb-5 border-b border-gray-100">
          <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3">
              <div className="text-sm min-w-0 truncate">
                <span className="font-semibold text-gray-900">{senderName}</span>
                <span className="text-gray-400"> &lt;{senderEmail}&gt;</span>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {formatFullDate(email.sentAt || email.scheduledAt)}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">to {email.recipient}</p>
          </div>
        </div>

        <div className="pt-5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
          {email.body}
        </div>

        {email.etherealPreviewUrl && (
          <a
            href={email.etherealPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-6 text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            <span>View delivered message in Ethereal</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        {email.error && (
          <div className="mt-6 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {email.error}
          </div>
        )}
      </div>
    </div>
  );
};
