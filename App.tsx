
import React, { useState, useEffect } from 'react';
import { User } from './types';
import { BackendService } from './services/backendService';
import { ToastProvider } from './contexts/ToastContext';
import Login from './components/Login';
import StudioStandby from './components/StudioStandby';
import AdminApp from './AdminApp';
import ThemeToggle from './components/ThemeToggle';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => BackendService.loadUser());
  const backend = BackendService.getInstance();

  useEffect(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('va_token') : null;
    if (!token || !user) return;
    backend.getMe().then((u) => {
      setUser(u);
      BackendService.saveUser(u);
    }).catch(() => {
      backend.logout();
      setUser(null);
    });
  }, []);

  const handleLogin = (data: { user: User; token: string }) => {
    setUser(data.user);
  };

  const handleLogout = () => {
    backend.logout();
    setUser(null);
  };

  if (!user) {
    return (
      <div className="relative">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <Login onLoginSuccess={handleLogin} />
      </div>
    );
  }

  if (user.role === 'creator') {
    return (
      <ToastProvider>
        <div className="relative min-h-screen">
          <div className="absolute top-4 right-4 z-10">
            <ThemeToggle />
          </div>
          <StudioStandby user={user} onLogout={handleLogout} />
        </div>
      </ToastProvider>
    );
  }

  return <AdminApp user={user} onLogout={handleLogout} />;
};

export default App;
