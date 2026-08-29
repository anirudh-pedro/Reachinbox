import React from 'react';
import { Search, Filter, RefreshCw, Star, Loader2, Inbox, Clock, AlertTriangle, Menu } from 'lucide-react';
import type { EmailJob } from '../types';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface EmailListViewProps {
  mode: 'scheduled' | 'sent';
  emails: EmailJob[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  pagination: Pagination;
  onPageChange: (p: number) => void;
  onSelectEmail: (email: EmailJob) => void;
  onOpenMobileNav: () => void;
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function snippet(body: string, max = 60): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export const EmailListView: React.FC<EmailListViewProps> = ({
  mode,
  emails,
  loading,
  searchQuery,
  onSearchChange,
  onRefresh,
  pagination,
  onPageChange,
  onSelectEmail,
  onOpenMobileNav,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-screen bg-white min-w-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100">
        <button
          type="button"
          title="Open menu"
          onClick={onOpenMobileNav}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer md:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="relative flex-1 min-w-0 sm:max-w-2xl">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 transition-colors"
          />
        </div>
        <button
          type="button"
          title="Filter"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          type="button"
          title="Refresh"
          onClick={onRefresh}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="text-xs">Loading {mode} emails...</span>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2 px-4 text-center">
            <Inbox className="w-8 h-8 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">
              {mode === 'scheduled' ? 'No scheduled emails found' : 'No sent emails yet'}
            </p>
            <p className="text-xs text-gray-400">
              {mode === 'scheduled'
                ? 'Compose a new email to schedule a job.'
                : 'Delivered emails will show up here.'}
            </p>
          </div>
        ) : (
          emails.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onSelectEmail(job)}
              className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 sm:px-6 py-3 sm:py-3.5 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left cursor-pointer"
            >
              {/* Line 1 on mobile: recipient + status/time badge + star. On sm+, these become individual row items via display:contents. */}
              <div className="flex items-center justify-between gap-2 sm:contents">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-gray-900 font-medium whitespace-nowrap truncate max-w-[55vw] sm:max-w-none">
                    To: {job.recipient.split('@')[0]}
                  </span>

                  {mode === 'scheduled' ? (
                    job.status === 'RATE_LIMITED' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 text-[11px] font-medium whitespace-nowrap shrink-0">
                        <AlertTriangle className="w-3 h-3" />
                        {formatTime(job.scheduledAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-500 text-[11px] font-medium whitespace-nowrap shrink-0">
                        <Clock className="w-3 h-3" />
                        {formatTime(job.scheduledAt)}
                      </span>
                    )
                  ) : (
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 ${
                        job.status === 'SENT'
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-red-50 text-red-500'
                      }`}
                    >
                      {job.status === 'SENT' ? 'Sent' : 'Failed'}
                    </span>
                  )}
                </div>

                {/* Star: top-right on mobile (line 1), inline at the end of the row on sm+ */}
                <Star className="w-4 h-4 text-gray-300 shrink-0 sm:hidden" />
              </div>

              {/* Line 2 on mobile: subject + snippet. On sm+, becomes the flexible middle row item. */}
              <div className="min-w-0 sm:contents">
                <span className="block text-sm text-gray-800 truncate sm:flex-1 sm:min-w-0">
                  <span className="font-medium">{job.subject}</span>
                  <span className="text-gray-400"> - {snippet(job.body)}</span>
                </span>
              </div>

              <Star className="hidden sm:block w-4 h-4 text-gray-300 shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t border-gray-100 text-xs text-gray-500">
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 sm:py-1 rounded-md border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1.5 sm:py-1 rounded-md border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
