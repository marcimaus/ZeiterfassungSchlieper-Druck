import { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import HomeScreen from './screens/HomeScreen';
import OverviewScreen from './screens/OverviewScreen';
import AdminScreen from './screens/AdminScreen';
import { useDarkMode } from './hooks/useDarkMode';
import { autoCloseOldActiveSessions } from './db';
import { hasWageConflict } from './utils';
import './App.css';

type Tab = 'home' | 'overview' | 'admin';

function AppShell() {
  const { state, logoutAdmin } = useApp();
  const wageWarning = state.users.some(u => u.isActive && hasWageConflict(u, state.minimumWage));
  const [activeTab, setActiveTab] = useState<Tab>('home');
  useDarkMode();

  // Auto-close sessions that were left open from previous days
  useEffect(() => {
    autoCloseOldActiveSessions().catch(console.error);
  }, []);
  const [overviewUserId, setOverviewUserId] = useState<string | null>(null);

  function openSessions(userId: string) {
    setOverviewUserId(userId);
    setActiveTab('overview');
  }

  return (
    <div className={`app${state.isAdminMode ? ' admin-mode' : ''}`}>
      {state.isAdminMode && (
        <button className="admin-logout-btn" onClick={logoutAdmin}>
          Abmelden
        </button>
      )}
      <main className="main-content">
        {activeTab === 'home' && <HomeScreen onOpenSessions={openSessions} />}
        {activeTab === 'overview' && (
          <OverviewScreen
            initialUserId={overviewUserId}
            onClose={() => setOverviewUserId(null)}
          />
        )}
        {activeTab === 'admin' && <AdminScreen />}
      </main>

      <nav className="bottom-nav">
        <button
          className={activeTab === 'home' ? 'active' : ''}
          onClick={() => setActiveTab('home')}
        >
          <span className="nav-icon">🏠</span>
          <span>Startseite</span>
        </button>
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => { setOverviewUserId(null); setActiveTab('overview'); }}
        >
          <span className="nav-icon">👤</span>
          <span>Übersicht</span>
        </button>
        <button
          className={activeTab === 'admin' ? 'active' : ''}
          onClick={() => setActiveTab('admin')}
          style={{ position: 'relative' }}
        >
          <span className="nav-icon">🔒</span>
          <span>Admin</span>
          {wageWarning && (
            <span style={{
              position: 'absolute', top: 8, right: 'calc(50% - 18px)',
              width: 9, height: 9, borderRadius: '50%',
              background: '#ef4444',
              border: '2px solid var(--bg-base, #fff)',
            }} />
          )}
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
