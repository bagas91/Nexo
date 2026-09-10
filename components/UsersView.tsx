import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { APP_MODULES, groupedModules, modulesSummary } from '../config/modules';

interface UsersViewProps {
  embedded?: boolean;
}

const UsersView: React.FC<UsersViewProps> = ({ embedded = false }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editModules, setEditModules] = useState<string[]>([]);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();
  const groups = groupedModules();

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

  const toggleModule = (list: string[], id: string, setList: (v: string[]) => void) => {
    if (list.includes(id)) setList(list.filter((m) => m !== id));
    else setList([...list, id]);
  };

  const selectAll = (setList: (v: string[]) => void) => {
    setList(APP_MODULES.map((m) => m.id));
  };

  const clearAll = (setList: (v: string[]) => void) => {
    setList([]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !name.trim()) {
      showToast('Preencha todos os campos.', 'error');
      return;
    }
    setLoading(true);
    try {
      await backend.createUser({
        email: email.trim(),
        password,
        name: name.trim(),
        role: 'operator',
        modules,
        phone: phone.trim() || null,
      });
      showToast('Usuário criado!', 'success');
      setEmail('');
      setPassword('');
      setName('');
      setPhone('');
      setModules([]);
      setShowForm(false);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (u: User) => {
    if (u.role === 'superadmin') return;
    setEditing(u);
    setEditName(u.name || '');
    setEditPassword('');
    setEditPhone(u.phone || '');
    setEditModules([...(u.modules || []).filter((m) => m !== '*')]);
    setShowForm(false);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setLoading(true);
    try {
      const patch: { name?: string; password?: string; modules: string[]; phone: string | null } = {
        modules: editModules,
        phone: editPhone.trim() || null,
      };
      if (editName.trim()) patch.name = editName.trim();
      if (editPassword.trim()) patch.password = editPassword.trim();
      await backend.updateUser(editing.id, patch);
      showToast('Permissões atualizadas.', 'success');
      setEditing(null);
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

  const handleDelete = async (u: User) => {
    if (u.role === 'superadmin') return;
    if (!confirm(`Excluir o usuário "${u.name || u.email}"?\n\nEle perde o acesso imediatamente. Essa ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await backend.deleteUser(u.id);
      showToast('Usuário excluído.', 'success');
      if (editing?.id === u.id) setEditing(null);
      load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const ModuleCheckboxes = ({
    selected,
    onToggle,
    onSelectAll,
    onClear,
  }: {
    selected: string[];
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onClear: () => void;
  }) => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-bs-text">Módulos liberados</p>
        <button type="button" className="text-[11px] bs-link-accent" onClick={onSelectAll}>
          Marcar todos
        </button>
        <button type="button" className="text-[11px] text-bs-muted hover:text-bs-text" onClick={onClear}>
          Limpar
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.group}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-bs-subtle mb-1.5">{g.groupLabel}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {g.items.map((m) => {
              const checked = selected.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'border-bs-accent/40 bg-bs-accent/10 text-bs-text'
                      : 'border-bs-border bg-bs-surface text-bs-muted hover:border-bs-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="rounded border-bs-border"
                    checked={checked}
                    onChange={() => onToggle(m.id)}
                  />
                  {m.label}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-bs-subtle">
        Integrações, WhatsApp, Usuários e exclusão no Bling ficam só com o superadmin.
      </p>
    </div>
  );

  return (
    <div className={`space-y-6 ${embedded ? '' : 'animate-fadeIn max-w-3xl'}`}>
      <div>
        <h2 className="bs-page-title">Usuários</h2>
        <p className="bs-page-desc">
          Como no Bling: você (superadmin) cria contas e marca quais módulos cada pessoa pode usar.
        </p>
      </div>

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm text-bs-muted">{users.length} usuário(s)</span>
          <button
            type="button"
            onClick={() => {
              setShowForm((s) => !s);
              setEditing(null);
            }}
            className="bs-btn px-3 py-1.5 text-xs"
          >
            <i className="fa-solid fa-plus mr-1.5" />
            Novo usuário
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} autoComplete="off" className="px-4 py-4 border-b border-bs-border space-y-4 bg-bs-elevated">
            <p className="text-sm font-semibold text-bs-text">Novo usuário</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="bs-input" placeholder="Nome completo" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              <input className="bs-input" placeholder="Login" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              <input type="password" className="bs-input" placeholder="Senha inicial" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <input
                className="bs-input"
                placeholder="WhatsApp (5562… — Fila Goiânia)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="text-[11px] text-bs-subtle -mt-2">
              <strong className="text-bs-text">Fila Goiânia</strong>: responde conferência física (e recebe WhatsApp se tiver telefone).{' '}
              <strong className="text-bs-text">Qualidade do Catálogo</strong>: vê produtos, relatórios e pode inativar no Bling.
            </p>
            <ModuleCheckboxes
              selected={modules}
              onToggle={(id) => toggleModule(modules, id, setModules)}
              onSelectAll={() => selectAll(setModules)}
              onClear={() => clearAll(setModules)}
            />
            <RowActions loading={loading} onCancel={() => setShowForm(false)} submitLabel="Criar usuário" />
          </form>
        )}

        {editing && (
          <form onSubmit={handleSaveEdit} autoComplete="off" className="px-4 py-4 border-b border-bs-border space-y-4 bg-bs-elevated">
            <p className="text-sm font-semibold text-bs-text">
              Editar · {editing.email}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="bs-input" placeholder="Nome" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <input
                type="password"
                className="bs-input"
                placeholder="Nova senha (opcional)"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                autoComplete="new-password"
              />
              <input
                className="bs-input sm:col-span-2"
                placeholder="WhatsApp (5562… — notificação Fila Goiânia)"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>
            <ModuleCheckboxes
              selected={editModules}
              onToggle={(id) => toggleModule(editModules, id, setEditModules)}
              onSelectAll={() => selectAll(setEditModules)}
              onClear={() => clearAll(setEditModules)}
            />
            <RowActions loading={loading} onCancel={() => setEditing(null)} submitLabel="Salvar" />
          </form>
        )}

        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Nome</th>
              <th>Login</th>
              <th>WhatsApp</th>
              <th>Perfil</th>
              <th>Módulos</th>
              <th>Status</th>
              <th className="text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="bs-table-empty">Nenhum usuário cadastrado.</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="bs-table-row">
                  <td className="font-medium text-bs-text">{u.name}</td>
                  <td className="text-bs-muted">{u.email}</td>
                  <td className="text-xs text-bs-muted font-mono">{u.phone || '—'}</td>
                  <td>
                    <span className={u.role === 'superadmin' ? 'bs-badge-accent normal-case' : 'bs-badge normal-case bg-bs-elevated text-bs-muted border border-bs-border'}>
                      {u.role === 'superadmin' ? 'Superadmin' : 'Usuário'}
                    </span>
                  </td>
                  <td className="text-xs text-bs-muted">
                    {u.role === 'superadmin' ? 'Todos' : modulesSummary(u.modules)}
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
                  <td className="text-right">
                    {u.role !== 'superadmin' && (
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="bs-btn-secondary text-[11px] px-2.5 py-1"
                          onClick={() => openEdit(u)}
                        >
                          <i className="fa-solid fa-pen mr-1" />
                          Editar
                        </button>
                        <button
                          type="button"
                          className="bs-btn-danger text-[11px] px-2.5 py-1"
                          onClick={() => void handleDelete(u)}
                        >
                          <i className="fa-solid fa-trash mr-1" />
                          Excluir
                        </button>
                      </div>
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

function RowActions({
  loading,
  onCancel,
  submitLabel,
}: {
  loading: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex gap-2">
      <button type="submit" disabled={loading} className="bs-btn px-4 py-1.5 text-xs disabled:opacity-50">
        {loading ? 'Salvando…' : submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="bs-btn-secondary px-4 py-1.5 text-xs">
        Cancelar
      </button>
    </div>
  );
}

export default UsersView;
