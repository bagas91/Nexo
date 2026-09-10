
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ConnectionStatus, User, View, ChatEntity, ScheduledMessage, SendProgressState } from './types';
import { BackendService } from './services/backendService';
import { ToastProvider } from './contexts/ToastContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatList from './components/ChatList';
import Scheduler from './components/Scheduler';
import HistoryView from './components/HistoryView';
import CategoriesView from './components/CategoriesView';
import SendProgressPanel from './components/SendProgressPanel';
import ContentLibrary from './components/ContentLibrary';
import SettingsView, { SettingsTab } from './components/SettingsView';
import ThemeToggle from './components/ThemeToggle';
import TemplatesView from './components/TemplatesView';
import ScheduleCalendarView from './components/ScheduleCalendarView';
import FollowUpsView from './components/FollowUpsView';
import AiAgentsView from './components/AiAgentsView';
import FlowsView from './components/FlowsView';
import ContactsView from './components/ContactsView';
import CrmView, { type CrmTab } from './components/CrmView';
import CampaignsView from './components/CampaignsView';
import GroupDispatchView from './components/GroupDispatchView';
import CatalogQualityView from './components/CatalogQualityView';
import AdminControlView from './components/AdminControlView';
import { canAccessView, SETTINGS_TAB_TO_MODULE, userHasModule } from './config/modules';

interface AdminAppProps {
  user: User;
  onLogout: () => void;
}

function firstAllowedView(user: User): View {
  if (user.role === 'superadmin') return 'dashboard';
  const order: View[] = [
    'dashboard', 'crm', 'contacts', 'campaigns',
    'catalog', 'templates', 'scheduler', 'groupdispatch',
    'followups', 'aiagents', 'flows', 'calendar', 'groups', 'history',
  ];
  for (const v of order) {
    if (canAccessView(user, v)) return v;
  }
  return 'settings';
}

function firstAllowedSettingsTab(user: User): SettingsTab {
  if (user.role === 'superadmin') return 'connections';
  const order: SettingsTab[] = ['profile', 'atendimento'];
  for (const t of order) {
    const mod = SETTINGS_TAB_TO_MODULE[t];
    if (mod && userHasModule(user, mod)) return t;
  }
  return 'profile';
}

const AdminApp: React.FC<AdminAppProps> = ({ user, onLogout }) => {
  const [view, setView] = useState<View>(() => firstAllowedView(user));
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingPhone, setPairingPhone] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatEntity[]>([]);
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatsSyncing, setChatsSyncing] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgressState | null>(null);
  const [sendProgressDismissed, setSendProgressDismissed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => firstAllowedSettingsTab(user));
  const [crmTab, setCrmTab] = useState<CrmTab>('atendimento');
  const isSuperadmin = user.role === 'superadmin';

  const backend = BackendService.getInstance();

  const navigateTo = useCallback((v: View) => {
    if (v === 'conversations') {
      setCrmTab('atendimento');
      setView('crm');
    } else {
      setView(v);
    }
    setIsMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    const pollMs =
      status === ConnectionStatus.QR_READY || status === ConnectionStatus.PAIRING_CODE_READY ? 4000 : 1500;
    const interval = setInterval(async () => {
      try {
        const statusData = await backend.getStatus();
        const currentStatus = statusData.status;

        if (statusData.qr && currentStatus === ConnectionStatus.QR_READY) {
          setQrCode(statusData.qr);
        }

        if (statusData.pairingCode && currentStatus === ConnectionStatus.PAIRING_CODE_READY) {
          setPairingCode(statusData.pairingCode);
          if (statusData.pairingPhone) setPairingPhone(statusData.pairingPhone);
        }

        if (currentStatus === ConnectionStatus.DISCONNECTED && status !== ConnectionStatus.DISCONNECTED) {
          setStatus(ConnectionStatus.DISCONNECTED);
          setQrCode(null);
          setPairingCode(null);
          setPairingPhone(null);
          return;
        }

        if (currentStatus === ConnectionStatus.CONNECTED && status !== ConnectionStatus.CONNECTED) {
          setStatus(ConnectionStatus.CONNECTED);
          setQrCode(null);
          setPairingCode(null);
          setPairingPhone(null);
          return;
        }

        if (currentStatus === ConnectionStatus.CONNECTING && status === ConnectionStatus.QR_READY) {
          setStatus(ConnectionStatus.CONNECTING);
          return;
        }

        if (currentStatus !== status && currentStatus !== ConnectionStatus.CONNECTED) {
          setStatus(currentStatus);
        }
      } catch (err) {
        console.error('Erro ao verificar status:', err);
      }
    }, pollMs);

    return () => clearInterval(interval);
  }, [status, backend]);

  useEffect(() => {
    if (user && status === ConnectionStatus.CONNECTED) {
      setTimeout(() => loadChatsProgressively(), 800);
    }
  }, [user, status]);

  useEffect(() => {
    if (status !== ConnectionStatus.CONNECTED) return;
    let cancelled = false;

    const pollProgress = async () => {
      try {
        const progress = await backend.getSendProgress();
        if (cancelled) return;
        setSendProgress(progress);
        if (progress.active || progress.status === 'running') {
          setSendProgressDismissed(false);
        } else if (
          (progress.status === 'completed' || progress.status === 'failed') &&
          progress.finishedAt &&
          Date.now() - progress.finishedAt > 15000
        ) {
          setSendProgressDismissed(true);
        }
      } catch {
        /* ignore */
      }
    };

    pollProgress();
    const id = window.setInterval(pollProgress, 800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status, backend]);

  const showSendProgressPanel = useMemo(() => {
    if (!sendProgress || sendProgressDismissed) return false;
    if (sendProgress.active || sendProgress.status === 'running') return true;
    return sendProgress.status === 'completed' || sendProgress.status === 'failed';
  }, [sendProgress, sendProgressDismissed]);

  const loadChatsProgressively = async () => {
    setIsLoading(true);
    setChatsSyncing(true);
    const BATCH_SIZE = 10;

    try {
      const fetchedSchedules = await backend.getSchedules();
      const seen = new Set<string>();
      const deduped = fetchedSchedules.filter((s) => {
        const key = `${(s.content || '').slice(0, 300)}|${s.scheduledAt || ''}|${(s.targets || []).slice().sort().join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setSchedules(deduped);
      setIsLoading(false);

      const syncPromise = backend.getChats().catch(() => [] as ChatEntity[]);

      let allChats: ChatEntity[] = [];
      const { chats: firstBatch } = await backend.getChatsPaginated(0, BATCH_SIZE);
      if (firstBatch.length > 0) {
        allChats = firstBatch;
        setChats(allChats);
      }

      await syncPromise;

      const { chats: refreshedFirst, total: totalAfter } = await backend.getChatsPaginated(0, BATCH_SIZE);
      allChats = refreshedFirst;
      setChats(allChats);

      let offset = 0;
      while (allChats.length < totalAfter) {
        offset += BATCH_SIZE;
        const { chats: nextBatch } = await backend.getChatsPaginated(offset, BATCH_SIZE);
        if (!nextBatch.length) break;
        allChats = [...allChats, ...nextBatch];
        setChats(allChats);
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    } catch (err) {
      console.error('Erro ao carregar chats:', err);
    }
    setChatsSyncing(false);
    setIsLoading(false);
  };

  const handleConnect = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      let qr = await backend.connect();
      if (qr) {
        setQrCode(qr);
        setStatus(ConnectionStatus.QR_READY);
        return;
      }
      setQrCode(null);
      await backend.reconnect();
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        qr = await backend.connect();
        if (qr) {
          setQrCode(qr);
          setStatus(ConnectionStatus.QR_READY);
          return;
        }
      }
      setStatus(ConnectionStatus.DISCONNECTED);
      alert('Não foi possível gerar o QR Code. Verifique se o servidor está rodando.');
    } catch (err) {
      console.error('Erro ao conectar:', err);
      setStatus(ConnectionStatus.DISCONNECTED);
    }
  };

  const scheduleKey = (s: ScheduledMessage) => {
    const at = s.scheduledAt ? new Date(s.scheduledAt).getTime() : '';
    return `${(s.content || '').slice(0, 300)}|${at}|${(s.targets || []).slice().sort().join(',')}`;
  };

  const refreshSchedules = useCallback(async () => {
    const list = await backend.getSchedules();
    const seen = new Set<string>();
    const deduped = list.filter((s) => {
      const key = scheduleKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setSchedules(deduped);
  }, [backend]);

  useEffect(() => {
    refreshSchedules();
    backend.getStatus().then((s) => setStatus(s.status)).catch(() => {});
  }, [backend, refreshSchedules]);

  useEffect(() => {
    if (view !== 'dashboard' || !refreshSchedules) return;
    const interval = setInterval(() => refreshSchedules(), 25000);
    return () => clearInterval(interval);
  }, [view, refreshSchedules]);

  const schedulesForDashboard = useMemo(() => {
    const seen = new Set<string>();
    return schedules.filter((s) => {
      const key = scheduleKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [schedules]);

  const handleSchedule = async (msg: Omit<ScheduledMessage, 'id' | 'status'>) => {
    await backend.scheduleMessage(msg);
    const list = await backend.getSchedules();
    const seen = new Set<string>();
    const deduped = list.filter((s) => {
      const key = scheduleKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setSchedules(deduped);
  };

  const handleDisconnect = async () => {
    if (!confirm('Desconectar WhatsApp?\n\nIsso limpa grupos, agendamentos e histórico para a próxima conexão.')) return;
    await backend.disconnect();
    setStatus(ConnectionStatus.DISCONNECTED);
    setChats([]);
    setSchedules([]);
    setQrCode(null);
  };

  const noChatViews: View[] = ['library', 'settings', 'whatsapp', 'templates', 'calendar', 'followups', 'aiagents', 'flows', 'contacts', 'conversations', 'crm', 'campaigns', 'catalog', 'admin'];
  const skipChatLoad = noChatViews.includes(view);
  const isConnected = status === ConnectionStatus.CONNECTED;

  const goToConnections = () => {
    if (!isSuperadmin) return;
    setSettingsTab('connections');
    setView('settings');
  };

  useEffect(() => {
    if (view === 'whatsapp') {
      if (!isSuperadmin) {
        setView(firstAllowedView(user));
        return;
      }
      setSettingsTab('connections');
      setView('settings');
    }
  }, [view, isSuperadmin, user]);

  useEffect(() => {
    if (view === 'settings') {
      if (!canAccessView(user, 'settings', settingsTab)) {
        setSettingsTab(firstAllowedSettingsTab(user));
      }
      return;
    }
    if (!canAccessView(user, view)) {
      setView(firstAllowedView(user));
    }
  }, [view, settingsTab, user]);

  return (
    <ToastProvider>
    <div className="flex h-screen bg-bs-canvas overflow-hidden relative">
      <Sidebar
        currentView={view}
        setView={navigateTo}
        onLogout={onLogout}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        settingsTab={settingsTab}
        onSettingsTab={setSettingsTab}
        user={user}
      />

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden backdrop-blur-sm transition-opacity" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <main className="flex-1 flex flex-col h-full overflow-hidden w-full">
        <header className="h-16 bg-bs-shell border-b border-bs-border px-4 md:px-6 flex items-center justify-between relative z-10 shrink-0 shadow-card">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => setIsMobileMenuOpen(true)} className="md:hidden w-10 h-10 flex items-center justify-center text-bs-muted hover:text-bs-text hover:bg-bs-hover rounded-lg shrink-0">
              <i className="fa-solid fa-bars text-xl"></i>
            </button>
            <span className="bs-badge-accent shrink-0">Virginia Arruda</span>
            {isSuperadmin && (
              <button
                type="button"
                onClick={goToConnections}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border shrink-0 text-xs font-semibold ${isConnected ? 'bs-badge-success normal-case' : 'bs-badge-warning normal-case'}`}
                title="Ir para Conexão WhatsApp"
              >
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-bs-accent' : 'bg-amber-500'}`} />
                {isConnected ? 'WhatsApp conectado' : 'WhatsApp offline'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <div className="w-8 h-8 rounded-full bg-bs-accent text-white flex items-center justify-center text-xs font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-bs-text leading-none">{user.name}</p>
              <p className="text-[11px] text-bs-muted mt-0.5">
                {isSuperadmin ? 'Superadmin' : 'Usuário'}
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 md:p-5 custom-scrollbar">
          {!isConnected && isSuperadmin && !noChatViews.includes(view) && view !== 'scheduler' && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bs-badge-warning normal-case px-4 py-3 text-sm">
              <span>WhatsApp desconectado — conecte para sincronizar grupos e disparar.</span>
              <button type="button" onClick={goToConnections} className="bs-btn px-3 py-1.5 text-xs whitespace-nowrap">
                Ir para Conexão
              </button>
            </div>
          )}

          {view === 'library' && <ContentLibrary />}
          {view === 'templates' && (
            <TemplatesView role="superadmin" onNavigate={(v) => setView(v)} />
          )}
          {view === 'calendar' && (
            <ScheduleCalendarView schedules={schedulesForDashboard} onNavigate={(v) => setView(v)} />
          )}
          {view === 'followups' && <FollowUpsView />}
          {view === 'aiagents' && <AiAgentsView />}
          {view === 'flows' && <FlowsView />}
          {view === 'contacts' && <ContactsView />}
          {view === 'crm' && <CrmView tab={crmTab} onTabChange={setCrmTab} />}
          {view === 'conversations' && <CrmView tab="atendimento" onTabChange={setCrmTab} />}
          {view === 'campaigns' && <CampaignsView />}
          {view === 'catalog' && <CatalogQualityView />}
          {view === 'admin' && isSuperadmin && <AdminControlView />}
          {(view === 'settings') && (
            <SettingsView
              tab={settingsTab}
              onTabChange={setSettingsTab}
              user={user}
              status={status}
              qrCode={qrCode}
              pairingCode={pairingCode}
              pairingPhone={pairingPhone}
              onPairingCodeChange={(code) => {
                setPairingCode(code);
                if (code) setStatus(ConnectionStatus.PAIRING_CODE_READY);
                else if (status === ConnectionStatus.PAIRING_CODE_READY) {
                  setStatus(ConnectionStatus.DISCONNECTED);
                  setPairingPhone(null);
                }
              }}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onSync={async () => {
                setIsLoading(true);
                await backend.refreshChats();
                setChats([]);
                await loadChatsProgressively();
                setIsLoading(false);
              }}
              syncing={chatsSyncing || isLoading}
            />
          )}

          {!skipChatLoad && chatsSyncing && !isLoading && isConnected && (
            <div className="mb-4 flex items-center gap-3 rounded-lg bs-badge-success normal-case px-4 py-2.5 text-sm">
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--bs-success-border)] border-t-bs-accent" />
              <span>Sincronizando grupos… {chats.length > 0 ? `${chats.length} carregados` : ''}</span>
            </div>
          )}
          {!skipChatLoad && isLoading && isConnected ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-bs-muted">
              <div className="w-12 h-12 border-4 border-bs-border border-t-bs-accent rounded-full animate-spin"></div>
              <p>Carregando...</p>
            </div>
          ) : !skipChatLoad && (
            <>
              {view === 'dashboard' && <Dashboard chats={chats} schedules={schedulesForDashboard} backend={backend} onRefreshSchedules={refreshSchedules} />}
              {view === 'groups' && (
                <ChatList chats={chats} backend={backend} onRefresh={async () => {
                  setChatsSyncing(true);
                  await backend.refreshChats();
                  setChats([]);
                  await loadChatsProgressively();
                }} />
              )}
              {view === 'groupdispatch' && <GroupDispatchView chats={chats} />}
              {view === 'scheduler' && <Scheduler chats={chats} onSchedule={handleSchedule} setView={setView} />}
              {view === 'categories' && <CategoriesView chats={chats} />}
              {view === 'history' && <HistoryView />}
            </>
          )}
        </div>
      </main>

      {showSendProgressPanel && sendProgress && (
        <SendProgressPanel
          progress={sendProgress}
          onDismiss={() => setSendProgressDismissed(true)}
          onCancel={async () => {
            try {
              await backend.stopAllDispatches();
            } catch (e) {
              console.error(e);
            }
          }}
        />
      )}
    </div>
    </ToastProvider>
  );
};

export default AdminApp;
