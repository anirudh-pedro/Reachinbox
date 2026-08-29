import React, { useState } from 'react';
import { ChevronDown, Clock, Send, LogOut, MessageSquare, X } from 'lucide-react';
import type { User, SlackStatus } from '../types';

interface SidebarProps {
  user: User;
  activeTab: 'scheduled' | 'sent';
  onTabChange: (tab: 'scheduled' | 'sent') => void;
  onCompose: () => void;
  scheduledCount: number;
  sentCount: number;
  slackStatus: SlackStatus;
  onOpenSlackModal: () => void;
  onLogout: () => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeTab,
  onTabChange,
  onCompose,
  scheduledCount,
  sentCount,
  slackStatus,
  onOpenSlackModal,
  onLogout,
  isOpen,
  onCloseMobile,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Backdrop: only relevant for the off-canvas drawer below md (768px) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`flex flex-col h-screen overflow-y-auto border-r border-gray-200 bg-white
          fixed top-0 left-0 z-50 w-64 px-4 py-5
          transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:sticky md:translate-x-0 md:top-0 md:z-0 md:w-16 md:px-2
          lg:w-64 lg:px-4`}
      >
        {/* Logo + mobile close button */}
        <div className="mb-6 px-1 flex items-center justify-between md:justify-center lg:justify-between">
          <span className="text-xl font-extrabold tracking-tight text-gray-900 md:hidden lg:inline">ONE</span>
          <span className="hidden md:inline lg:hidden text-xl font-extrabold tracking-tight text-gray-900">O</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile */}
        <div className="relative mb-4">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer md:justify-center md:px-0 lg:justify-start lg:px-2"
          >
            <img
              src={user.avatar}
              alt={user.name}
              className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0"
            />
            <div className="flex-1 text-left min-w-0 md:hidden lg:block">
              <div className="text-xs font-semibold text-gray-900 truncate">{user.name}</div>
              <div className="text-[11px] text-gray-400 truncate">{user.email}</div>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 md:hidden lg:block ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div className="absolute left-0 right-0 md:right-auto md:w-56 lg:right-0 lg:w-auto mt-1 bg-white border border-gray-200 rounded-lg shadow-md z-20 animate-fade-in-scale overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSlackModal();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span className="truncate">{slackStatus.connected ? `Slack: ${slackStatus.channel || 'Connected'}` : 'Connect Slack'}</span>
                {slackStatus.connected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-auto shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>

        {/* Compose Button */}
        <button
          type="button"
          onClick={onCompose}
          title="Compose"
          className="w-full mb-6 py-2 rounded-lg border border-emerald-500 text-emerald-600 text-sm font-semibold hover:bg-emerald-50 transition-colors cursor-pointer md:px-0"
        >
          <span className="md:hidden lg:inline">Compose</span>
          <span className="hidden md:inline lg:hidden text-lg leading-none">+</span>
        </button>

        {/* Nav */}
        <div className="px-1 md:px-0">
          <p className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 md:hidden lg:block">Core</p>
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => onTabChange('scheduled')}
              title="Scheduled"
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer md:justify-center md:px-0 lg:justify-start lg:px-2.5 ${
                activeTab === 'scheduled'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left md:hidden lg:inline">Scheduled</span>
              <span
                className={`text-[11px] font-mono px-1.5 rounded md:hidden lg:inline ${
                  activeTab === 'scheduled' ? 'text-emerald-700' : 'text-gray-400'
                }`}
              >
                {scheduledCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onTabChange('sent')}
              title="Sent"
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer md:justify-center md:px-0 lg:justify-start lg:px-2.5 ${
                activeTab === 'sent'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left md:hidden lg:inline">Sent</span>
              <span
                className={`text-[11px] font-mono px-1.5 rounded md:hidden lg:inline ${
                  activeTab === 'sent' ? 'text-emerald-700' : 'text-gray-400'
                }`}
              >
                {sentCount}
              </span>
            </button>
          </nav>
        </div>
      </aside>
    </>
  );
};
