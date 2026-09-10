import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { APP_MODULES, modulesSummary } from '../config/modules';
import type { User } from '../types';

type AdminTab = 'health' | 'access' | 'accounts' | 'audit';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'health', label: 'Saúde', icon: 'fa-heart-pulse' },
  { id: 'access', label: 'Acessos', icon: 'fa-table' },
  { id: 'accounts', label: 'Contas', icon: 'fa-user-shield' },
  { id: 'audit', label: 'Registros', icon: 'fa-clipboard-list' },
];

type HealthPayload = {
  whatsapp?: { status?: string; ready?: boolean };
  bling?: { status?: string; detail?: string; company?: string | null };
  catalog?: {
    blingCount?: number;
    productsWithErrors?: number;
    issueTotal?: number;
    latestScan?: { status?: string; finishedAt?: number; issueCount?: number; message?: string } | null;
  } | null;
  users?: { total?: number; active?: number; operators?: number };
  audit?: { total?: number };
  recentErrors?: { line: string; level: string }[];
  serverTime?: number;
};

type AccessPayload = {
  modules: { id: string; label: string; groupLabel: string }[];
  users: User[];
};

type AuditRow = {
  id: string;
  ts: number;
  actorEmail?: string;
  actorName?: string;
  action: string;
  summary: string;
  targetId?: string;
  ip?: string;
};

function statusPill(status?: string) {
  if (status === 'connected') return 'bs-badge-success normal-case';
  if (status === 'connecting') return 'bs-badge-warning normal-case';
  if (status === 'error') return 'bs-badge-danger normal-case';
  return 'bs-badge normal-case bg-bs-elevated text-bs-muted border border-bs-border';
}

function statusLabel(status?: string) {
  if (status === 'connected') return 'Conectado';
  if (status === 'connecting') return 'Conectando';
  if (status === 'error') return 'Erro';
  return 'Desconectado';
}

function formatTs(ts?: number | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR');
}

const AdminControlView: React.FC = () => {
  const backend = BackendService.getInstance();
  const { showToast } = useToast();
  const [tab, setTab] = useState<AdminTab>('health');
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [audit, setAudit] = useState<{ rows: AuditRow[]; total: number }>({ rows: [], total: 0 });
  const [auditAction, setAuditAction] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetPwd, setResetPwd] = useState<{ id: string; email: string; password: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [h, a, logs] = await Promise.all([
        backend.getAdminHealth(),
        backend.getAdminAccess(),
        backend.getAdminAudit({ limit: 100, action: auditAction || undefined }),
      ]);
      setHealth(h);
      setAccess(a);
      setAudit({ rows: logs.rows || [], total: logs.total || 0 });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar painel admin', 'error');
    } finally {
      setLoading(false);
    }
  }, [backend, showToast, auditAction]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const moduleCols = useMemo(() => access?.modules || APP_MODULES, [access]);

  const handleForceLogout = async (u: User) => {
    if (!confirm(`Encerrar todas as sessões de ${u.email}?`)) return;
    setBusyId(u.id);
    try {
      await backend.adminForceLogout(u.id);
      showToast(`Sessões encerradas: ${u.email}`, 'success');
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (u: User) => {
    if (u.role === 'superadmin') return;
    setBusyId(u.id);
    try {
      await backend.updateUser(u.id, { active: !u.active });
      showToast(u.active ? 'Usuário desativado' : 'Usuário ativado', 'success');
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwd) return;
    setBusyId(resetPwd.id);
    try {
      await backend.adminResetPassword(resetPwd.id, resetPwd.password);
      showToast(`Senha redefinida · sessões encerradas (${resetPwd.email})`, 'success');
      setResetPwd(null);
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !health) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando controle admin…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-bs-subtle mb-1">Sistema · Admin</p>
          <h2 className="bs-page-title">Controle Admin</h2>
          <p className="bs-page-desc mt-1">
            Saúde do sistema, matriz de acessos, contas e registros de auditoria.
          </p>
        </div>
        <button type="button" className="bs-btn-secondary text-sm px-3 py-2 flex items-center gap-2" onClick={refresh}>
          <i className={`fa-solid fa-rotate ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-bs-border pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
              tab === t.id ? 'bg-bs-accent/15 text-bs-accent font-semibold' : 'text-bs-muted hover:text-bs-text hover:bg-bs-hover'
            }`}
          >
            <i className={`fa-solid ${t.icon} text-xs`} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'health' && health && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bs-card p-4">
              <p className="text-[11px] uppercase text-bs-subtle font-semibold">WhatsApp</p>
              <p className="mt-2">
                <span className={statusPill(health.whatsapp?.status)}>{statusLabel(health.whatsapp?.status)}</span>
              </p>
            </div>
            <div className="bs-card p-4">
              <p className="text-[11px] uppercase text-bs-subtle font-semibold">Bling</p>
              <p className="mt-2">
                <span className={statusPill(health.bling?.status)}>{statusLabel(health.bling?.status)}</span>
              </p>
              <p className="text-xs text-bs-muted mt-2">{health.bling?.detail || '—'}</p>
            </div>
            <div className="bs-card p-4">
              <p className="text-[11px] uppercase text-bs-subtle font-semibold">Catálogo</p>
              <p className="text-2xl font-bold text-bs-text mt-1 tabular-nums">{health.catalog?.blingCount ?? '—'}</p>
              <p className="text-xs text-bs-muted">
                {health.catalog?.productsWithErrors ?? 0} críticos · {health.catalog?.issueTotal ?? 0} issues
              </p>
              {health.catalog?.latestScan && (
                <p className="text-[11px] text-bs-subtle mt-1">
                  Último scan: {health.catalog.latestScan.status} · {formatTs(health.catalog.latestScan.finishedAt)}
                </p>
              )}
            </div>
            <div className="bs-card p-4">
              <p className="text-[11px] uppercase text-bs-subtle font-semibold">Usuários</p>
              <p className="text-2xl font-bold text-bs-text mt-1 tabular-nums">{health.users?.active ?? 0}/{health.users?.total ?? 0}</p>
              <p className="text-xs text-bs-muted">{health.users?.operators ?? 0} operadores · {health.audit?.total ?? 0} logs</p>
            </div>
          </div>

          <div className="bs-card p-4">
            <p className="text-sm font-semibold text-bs-text mb-2">Alertas recentes (log)</p>
            {!health.recentErrors?.length ? (
              <p className="text-sm text-bs-muted">Nenhum WARN/ERROR recente no log do dia.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar text-[11px] font-mono">
                {health.recentErrors.map((e, i) => (
                  <li key={i} className={e.level === 'error' ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}>
                    {e.line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'access' && access && (
        <div className="bs-table-wrap overflow-x-auto">
          <table className="bs-table min-w-[900px]">
            <thead className="bs-table-head">
              <tr>
                <th className="sticky left-0 bg-bs-surface z-10">Usuário</th>
                {moduleCols.map((m) => (
                  <th key={m.id} className="text-center text-[10px] max-w-[72px]" title={m.label}>
                    <span className="line-clamp-2">{m.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {access.users.map((u) => {
                const all = u.role === 'superadmin' || (u.modules || []).includes('*');
                return (
                  <tr key={u.id} className="bs-table-row">
                    <td className="sticky left-0 bg-bs-surface z-10">
                      <p className="font-medium text-bs-text text-sm">{u.name}</p>
                      <p className="text-[11px] text-bs-muted">{u.email}</p>
                    </td>
                    {moduleCols.map((m) => {
                      const on = all || (u.modules || []).includes(m.id);
                      return (
                        <td key={m.id} className="text-center">
                          <i className={`fa-solid ${on ? 'fa-check text-emerald-500' : 'fa-minus text-bs-subtle/40'} text-xs`} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-4">
          {resetPwd && (
            <form onSubmit={handleResetPassword} className="bs-card p-4 space-y-3">
              <p className="text-sm font-semibold text-bs-text">Redefinir senha · {resetPwd.email}</p>
              <input
                type="password"
                className="bs-input text-sm max-w-sm"
                placeholder="Nova senha"
                value={resetPwd.password}
                onChange={(e) => setResetPwd({ ...resetPwd, password: e.target.value })}
                autoComplete="new-password"
              />
              <div className="flex gap-2">
                <button type="submit" className="bs-btn text-sm px-3 py-1.5" disabled={busyId === resetPwd.id}>
                  Salvar senha
                </button>
                <button type="button" className="bs-btn-secondary text-sm px-3 py-1.5" onClick={() => setResetPwd(null)}>
                  Cancelar
                </button>
              </div>
              <p className="text-[11px] text-bs-subtle">Ao salvar, todas as sessões desse usuário são encerradas.</p>
            </form>
          )}

          <div className="bs-table-wrap overflow-x-auto">
            <table className="bs-table min-w-[720px]">
              <thead className="bs-table-head">
                <tr>
                  <th>Nome</th>
                  <th>Login</th>
                  <th>Perfil</th>
                  <th>Módulos</th>
                  <th>Último login</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(access?.users || []).map((u) => (
                  <tr key={u.id} className="bs-table-row">
                    <td className="font-medium text-bs-text">{u.name}</td>
                    <td className="text-bs-muted text-sm">{u.email}</td>
                    <td>
                      <span className={u.role === 'superadmin' ? 'bs-badge-accent normal-case' : 'bs-badge normal-case'}>
                        {u.role === 'superadmin' ? 'Superadmin' : 'Usuário'}
                      </span>
                    </td>
                    <td className="text-xs text-bs-muted">
                      {u.role === 'superadmin' ? 'Todos' : modulesSummary(u.modules)}
                    </td>
                    <td className="text-xs text-bs-muted whitespace-nowrap">{formatTs(u.lastLoginAt)}</td>
                    <td>
                      {u.role === 'superadmin' ? (
                        <span className="bs-badge-success normal-case">Ativo</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => handleToggleActive(u)}
                          className={u.active !== false ? 'bs-badge-success normal-case cursor-pointer' : 'bs-badge-danger normal-case cursor-pointer'}
                        >
                          {u.active !== false ? 'Ativo' : 'Inativo'}
                        </button>
                      )}
                    </td>
                    <td className="text-right">
                      {u.role !== 'superadmin' && (
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            className="bs-btn-secondary text-[11px] px-2 py-1"
                            disabled={busyId === u.id}
                            onClick={() => setResetPwd({ id: u.id, email: u.email, password: '' })}
                          >
                            Senha
                          </button>
                          <button
                            type="button"
                            className="bs-btn-danger text-[11px] px-2 py-1"
                            disabled={busyId === u.id}
                            onClick={() => handleForceLogout(u)}
                          >
                            Encerrar sessão
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-bs-subtle">
            Para editar módulos, use Configurações → Usuários. Aqui você controla status, senha e sessões.
          </p>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="bs-input text-sm max-w-xs"
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
            >
              <option value="">Todas as ações</option>
              <option value="login">Login</option>
              <option value="login_failed">Login falhou</option>
              <option value="user_created">Usuário criado</option>
              <option value="user_updated">Usuário atualizado</option>
              <option value="password_reset">Senha redefinida</option>
              <option value="force_logout">Sessão encerrada</option>
              <option value="catalog_fix">Catálogo corrigido</option>
              <option value="catalog_delete">Catálogo excluído</option>
            </select>
            <span className="text-xs text-bs-muted">{audit.total} registro(s)</span>
          </div>
          <div className="bs-table-wrap overflow-x-auto">
            <table className="bs-table min-w-[720px]">
              <thead className="bs-table-head">
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Ação</th>
                  <th>Detalhe</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {!audit.rows.length ? (
                  <tr>
                    <td colSpan={5} className="bs-table-empty">Nenhum registro ainda.</td>
                  </tr>
                ) : (
                  audit.rows.map((r) => (
                    <tr key={r.id} className="bs-table-row">
                      <td className="text-xs text-bs-muted whitespace-nowrap">{formatTs(r.ts)}</td>
                      <td className="text-sm">{r.actorName || r.actorEmail || '—'}</td>
                      <td className="font-mono text-[11px]">{r.action}</td>
                      <td className="text-sm text-bs-muted max-w-[360px]">
                        <span className="line-clamp-2">{r.summary}</span>
                      </td>
                      <td className="text-[11px] text-bs-subtle">{r.ip || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminControlView;
