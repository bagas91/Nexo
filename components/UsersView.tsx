import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

interface UsersViewProps {
  embedded?: boolean;
}

const UsersView: React.FC<UsersViewProps> = ({ embedded = false }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();

  const load = async () => {
    try {
      setUsers(await backend.getUsers());
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !name.trim()) {
      showToast('Preencha todos os campos.', 'error');
      return;
    }
    setLoading(true);
    try {
      await backend.createUser({ email: email.trim(), password, name: name.trim(), role: 'creator' });
      showToast('Funcionário criado!', 'success');
      setEmail('');
      setPassword('');
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (u: User) => {
    if (u.role === 'superadmin') return;
    try {
      await backend.updateUser(u.id, { active: !u.active });
      load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  return (
    <div className={`space-y-6 ${embedded ? '' : 'animate-fadeIn max-w-3xl'}`}>
      {!embedded && (
        <div>
          <h2 className="bs-page-title">Usuários</h2>
          <p className="bs-page-desc">Funcionários com acesso ao estúdio de conteúdo.</p>
        </div>
      )}

      {embedded && (
        <div>
          <h2 className="bs-page-title">Usuários</h2>
          <p className="bs-page-desc">Gerencie funcionários e permissões de acesso.</p>
        </div>
      )}

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm text-bs-muted">{users.length} usuário(s)</span>
          <button type="button" onClick={() => setShowForm((s) => !s)} className="bs-btn px-3 py-1.5 text-xs">
            <i className="fa-solid fa-plus mr-1.5" />
            Convidar
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} autoComplete="off" className="px-4 py-4 border-b border-bs-border space-y-3 bg-bs-elevated">
            <p className="text-sm font-semibold text-bs-text">Novo funcionário</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input className="bs-input" placeholder="Nome completo" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              <input className="bs-input" placeholder="Login" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              <input type="password" className="bs-input" placeholder="Senha inicial" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <RowActions loading={loading} onCancel={() => setShowForm(false)} />
          </form>
        )}

        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Nome</th>
              <th>Login</th>
              <th>Perfil</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="bs-table-empty">Nenhum usuário cadastrado.</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="bs-table-row">
                  <td className="font-medium text-bs-text">{u.name}</td>
                  <td className="text-bs-muted">{u.email}</td>
                  <td>
                    <span className={u.role === 'superadmin' ? 'bs-badge-accent normal-case' : 'bs-badge normal-case bg-bs-elevated text-bs-muted border border-bs-border'}>
                      {u.role === 'superadmin' ? 'Superadmin' : 'Estúdio'}
                    </span>
                  </td>
                  <td>
                    {u.role === 'superadmin' ? (
                      <span className="bs-badge-success normal-case">Ativo</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleActive(u)}
                        className={u.active !== false ? 'bs-badge-success normal-case cursor-pointer' : 'bs-badge-danger normal-case cursor-pointer'}
                      >
                        {u.active !== false ? 'Ativo' : 'Inativo'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function RowActions({ loading, onCancel }: { loading: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="submit" disabled={loading} className="bs-btn px-4 py-1.5 text-xs disabled:opacity-50">
        {loading ? 'Criando...' : 'Criar usuário'}
      </button>
      <button type="button" onClick={onCancel} className="bs-btn-secondary px-4 py-1.5 text-xs">
        Cancelar
      </button>
    </div>
  );
}

export default UsersView;
