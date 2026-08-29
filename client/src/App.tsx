import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { EmailListView } from './components/EmailListView';
import { EmailDetailView } from './components/EmailDetailView';
import { ComposeView } from './components/ComposeView';
import { SlackModal } from './components/SlackModal';
import { LoginView } from './components/LoginView';
import type { EmailJob, SenderAccount, Stats, SlackStatus, User } from './types';
import { api } from './services/api';

type View = 'list' | 'detail' | 'compose';

export function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('reachinbox_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [view, setView] = useState<View>('list');
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);
  const [isSlackOpen, setIsSlackOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Data states
  const [scheduledEmails, setScheduledEmails] = useState<EmailJob[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailJob[]>([]);
  const [senders, setSenders] = useState<SenderAccount[]>([]);
  const [stats, setStats] = useState<Stats>({ scheduled: 0, sent: 0, failed: 0, rateLimited: 0, total: 0 });
  const [slackStatus, setSlackStatus] = useState<SlackStatus>({ connected: false });

  // Query & Loading states
  const [loading, setLoading] = useState(false);
  const [scheduledSearch, setScheduledSearch] = useState('');
  const [sentSearch, setSentSearch] = useState('');
  const [scheduledPagination, setScheduledPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [sentPagination, setSentPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const [statsData, sendersData, slackData] = await Promise.all([
        api.getStats().catch(() => ({ scheduled: 0, sent: 0, failed: 0, rateLimited: 0, total: 0 })),
        api.getSenders().catch(() => []),
        api.getSlackStatus().catch(() => ({ connected: false })),
      ]);

      setStats(statsData);
      setSenders(sendersData);
      setSlackStatus(slackData);
    } catch (err) {
      console.error('Error fetching dashboard metadata:', err);
    }
  }, []);

  const fetchScheduled = useCallback(async (page = 1, search = scheduledSearch) => {
    setLoading(true);
    try {
      const res = await api.getScheduledEmails({ page, limit: 20, search });
      setScheduledEmails(res.data);
      setScheduledPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch scheduled emails:', err);
    } finally {
      setLoading(false);
    }
  }, [scheduledSearch]);

  const fetchSent = useCallback(async (page = 1, search = sentSearch) => {
    setLoading(true);
    try {
      const res = await api.getSentEmails({ page, limit: 20, search });
      setSentEmails(res.data);
      setSentPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch sent emails:', err);
    } finally {
      setLoading(false);
    }
  }, [sentSearch]);

  useEffect(() => {
    if (!user) return;
    fetchData();
    fetchScheduled(1);
    fetchSent(1);

    // Auto-refresh stats every 4 seconds
    const interval = setInterval(() => {
      fetchData();
      if (activeTab === 'scheduled') {
        fetchScheduled(scheduledPagination.page);
      } else {
        fetchSent(sentPagination.page);
      }
    }, 4000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab]);

  const handleLogin = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem('reachinbox_user', JSON.stringify(newUser));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('reachinbox_user');
  };

  const handleTabChange = (tab: 'scheduled' | 'sent') => {
    setActiveTab(tab);
    setView('list');
    setSelectedEmail(null);
    setMobileNavOpen(false);
  };

  const handleSelectEmail = (email: EmailJob) => {
    setSelectedEmail(email);
    setView('detail');
  };

  const handleCloseCompose = () => {
    setView('list');
  };

  const handleScheduledSuccess = () => {
    fetchData();
    fetchScheduled();
    setActiveTab('scheduled');
    setView('list');
  };

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  const currentEmails = activeTab === 'scheduled' ? scheduledEmails : sentEmails;
  const currentSearch = activeTab === 'scheduled' ? scheduledSearch : sentSearch;
  const currentPagination = activeTab === 'scheduled' ? scheduledPagination : sentPagination;

  return (
    <div className="min-h-screen bg-white text-gray-900 flex">
      <Sidebar
        user={user}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onCompose={() => {
          setView('compose');
          setMobileNavOpen(false);
        }}
        scheduledCount={stats.scheduled + stats.rateLimited}
        sentCount={stats.sent}
        slackStatus={slackStatus}
        onOpenSlackModal={() => setIsSlackOpen(true)}
        onLogout={handleLogout}
        isOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      {view === 'compose' ? (
        <ComposeView
          senders={senders}
          onClose={handleCloseCompose}
          onScheduledSuccess={handleScheduledSuccess}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
      ) : view === 'detail' && selectedEmail ? (
        <EmailDetailView
          email={selectedEmail}
          onBack={() => setView('list')}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
      ) : (
        <EmailListView
          mode={activeTab}
          emails={currentEmails}
          loading={loading}
          searchQuery={currentSearch}
          onSearchChange={(q) => {
            if (activeTab === 'scheduled') {
              setScheduledSearch(q);
              fetchScheduled(1, q);
            } else {
              setSentSearch(q);
              fetchSent(1, q);
            }
          }}
          onRefresh={() => {
            fetchData();
            if (activeTab === 'scheduled') fetchScheduled();
            else fetchSent();
          }}
          pagination={currentPagination}
          onPageChange={(p) => (activeTab === 'scheduled' ? fetchScheduled(p) : fetchSent(p))}
          onSelectEmail={handleSelectEmail}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
      )}

      {/* Slack Integration Modal */}
      <SlackModal
        isOpen={isSlackOpen}
        onClose={() => setIsSlackOpen(false)}
        status={slackStatus}
        onStatusUpdated={fetchData}
      />
    </div>
  );
}

export default App;
