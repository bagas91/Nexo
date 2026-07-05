
import React, { useState } from 'react';
import { BackendService } from '../services/backendService';
import { BRANDING } from '../config/branding';
import StudioCredit from './StudioCredit';

interface LoginProps {
  onLoginSuccess: (data: { user: any; token: string }) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await BackendService.getInstance().login(email, password);
      onLoginSuccess(user);
    } catch {
      setError('Credenciais inválidas. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bs-canvas px-4">
      <div className="max-w-md w-full bs-card p-8">
        <div className="text-center mb-8">
          <div className="bs-logo-mark w-14 h-14 text-2xl mx-auto mb-4">{BRANDING.productInitial}</div>
          <p className="text-xl font-bold text-bs-text">{BRANDING.productName}</p>
          <p className="text-sm text-bs-muted mt-1">{BRANDING.productTagline}</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation"></i>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
          <div>
            <label className="block text-xs font-semibold text-bs-muted mb-1.5">Usuário</label>
            <input
              type="text"
              required
              autoComplete="off"
              name="bs-login-user"
              className="bs-input"
              placeholder="Digite seu usuário"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-bs-muted mb-1.5">Senha</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              name="bs-login-pass"
              className="bs-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" disabled={loading} className="w-full bs-btn py-2.5 flex items-center justify-center gap-2 mt-2">
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        <p className="mt-8 pt-6 border-t border-bs-border text-center text-xs text-bs-muted">
          Tenant {BRANDING.tenantName}
        </p>
        <StudioCredit variant="login" />
      </div>
    </div>
  );
};

export default Login;
