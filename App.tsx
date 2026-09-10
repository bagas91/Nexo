import React, { useState, useEffect } from 'react';
import { User } from './types';
import { BackendService } from './services/backendService';
import { ToastProvider } from './contexts/ToastContext';
import Login from './components/Login';
import AdminApp from './AdminApp';
import ThemeToggle from './components/ThemeToggle';
import { userHasAnyAppModule } from './config/modules';

const NoAccess: React.FC<{ user: User; onLogout: () => void }> = ({ user, onLogout }) => (
  <div className="min-h-screen flex items-center justify-center bg-bs-canvas p-6">
    <div className="max-w-md w-full bs-card p-8 text-center space-y-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-bs-elevated flex items-center justify-center">
        <i className="fa-solid fa-lock text-bs-muted" />
      </div>
      <h1 className="text-lg font-semibold text-bs-text">Sem permissões</h1>
      <p className="text-sm text-bs-muted">
        Olá, {user.name}. Sua conta ainda não tem módulos liberados.
        Peça ao administrador para marcar as permissões em Configurações → Usuários.
      </p>
      <button type="button" className="bs-btn-secondary text-sm px-4 py-2" onClick={onLogout}>
        Sair
      </button>
    </div>
  </div>
);

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

  if (user.role === 'superadmin' || userHasAnyAppModule(user)) {
    return <AdminApp user={user} onLogout={handleLogout} />;
  }

  return (
    <ToastProvider>
      <div className="relative min-h-screen">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <NoAccess user={user} onLogout={handleLogout} />
      </div>
    </ToastProvider>
  );
};

export default App;
