import React, { useCallback, useEffect, useMemo, useState } from 'react';
import platformService, {
  type CatalogDashboard,
  type CatalogIssue,
  type CatalogScan,
  type CatalogPhysicalCheck,
  type CatalogPhysicalCheckComment,
  type CatalogAiDraft,
  type CatalogAiSuggestJob,
} from '../services/platformService';
import { useToast } from '../contexts/ToastContext';
import Modal from './Modal';
import { BackendService } from '../services/backendService';
import { userHasModule } from '../config/modules';
import { BRANDING } from '../config/branding';

const DEFAULT_CATALOG_BRAND = BRANDING.catalogBrand || 'Virginia Arruda';

function isPlaceholderCategoryName(name?: string | null) {
  return /^categoria padr[aã]o$/i.test(String(name || '').trim());
}

function categoryIdFromProduct(p: { category?: string; rawJson?: string | Record<string, unknown> } | null | undefined) {
  if (!p) return '';
  try {
    const raw = typeof p.rawJson === 'string' ? JSON.parse(p.rawJson) : (p.rawJson || {});
    const id = Number(
      (raw as { categoryId?: number; detail?: { categoria?: { id?: number } } })?.categoryId
      || (raw as { detail?: { categoria?: { id?: number } } })?.detail?.categoria?.id
      || 0,
    );
    return id > 0 ? String(id) : '';
  } catch {
    return '';
  }
}
type CatalogTab = 'dashboard' | 'problems' | 'reviewed' | 'comparator' | 'goiania' | 'reports' | 'rules' | 'ai-drafts';

const TABS: { id: CatalogTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
  { id: 'problems', label: 'Problemas', icon: 'fa-triangle-exclamation' },
  { id: 'ai-drafts', label: 'Rascunhos IA', icon: 'fa-wand-magic-sparkles' },
  { id: 'reviewed', label: 'Revisados', icon: 'fa-circle-check' },
  { id: 'goiania', label: 'Goiânia', icon: 'fa-location-dot' },
  { id: 'comparator', label: 'Comparador', icon: 'fa-code-compare' },
  { id: 'reports', label: 'Relatórios', icon: 'fa-file-lines' },
  { id: 'rules', label: 'Regras', icon: 'fa-sliders' },
];

const NEED_OPTIONS: { id: string; label: string }[] = [
  { id: 'weight', label: 'Peso' },
  { id: 'dimensions', label: 'Dimensões' },
  { id: 'photo', label: 'Foto' },
  { id: 'identity', label: 'Conferir peça / etiqueta' },
  { id: 'other', label: 'Outro' },
];

function needLabel(id: string) {
  return NEED_OPTIONS.find((n) => n.id === id)?.label || id;
}

function checkStatusLabel(status: string) {
  if (status === 'pending') return 'Pendente';
  if (status === 'answered') return 'Respondido';
  if (status === 'applied') return 'Aplicado';
  if (status === 'cancelled') return 'Cancelado';
  if (status === 'returned') return 'Devolvido';
  return status;
}

function formatDueAt(dueAt?: number | null) {
  if (!dueAt) return null;
  try {
    return new Date(dueAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return null;
  }
}

function checkIsOverdue(c: CatalogPhysicalCheck) {
  if (c.overdue) return true;
  if (!c.dueAt) return false;
  if (c.status !== 'pending' && c.status !== 'answered') return false;
  return c.dueAt < Date.now();
}

function toneClass(tone?: string) {
  if (tone === 'danger') return 'border-red-500/30 bg-red-500/5';
  if (tone === 'warn') return 'border-amber-500/30 bg-amber-500/5';
  if (tone === 'ok') return 'border-emerald-500/30 bg-emerald-500/5';
  return 'border-bs-border bg-bs-elevated';
}

function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function priorityBadge(priority: string) {
  if (priority === 'critical') {
    return 'bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (priority === 'medium') {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  }
  return 'bg-bs-elevated text-bs-muted border border-bs-border';
}

function priorityLabel(priority: string) {
  if (priority === 'critical') return 'Crítico';
  if (priority === 'medium') return 'Médio';
  return 'Baixo';
}

const IssuesTable: React.FC<{
  issues: CatalogIssue[];
  loading?: boolean;
  emptyText?: string;
  onEdit?: (issue: CatalogIssue) => void;
  onRequestGoiania?: (issue: CatalogIssue) => void;
  onOpenGoianiaQueue?: (issue: CatalogIssue) => void;
  onDelete?: (issue: CatalogIssue) => void;
  onInactivate?: (issue: CatalogIssue) => void;
  deletingId?: string | null;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  currentUserId?: string;
  showCategory?: boolean;
}> = ({
  issues,
  loading,
  emptyText,
  onEdit,
  onRequestGoiania,
  onOpenGoianiaQueue,
  onDelete,
  onInactivate,
  deletingId,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  currentUserId,
  showCategory,
}) => {
  if (loading) {
    return <p className="text-sm text-bs-muted animate-pulse py-6">Carregando produtos…</p>;
  }
  if (!issues.length) {
    return (
      <div className="rounded-lg border border-dashed border-bs-border p-8 text-center text-sm text-bs-muted">
        {emptyText || 'Nenhum produto nesta lista.'}
      </div>
    );
  }
  const showActions = !!(onEdit || onRequestGoiania || onOpenGoianiaQueue || onDelete || onInactivate);
  const selectableIds = issues
    .filter((i) => {
      const lockedByOther = i.lock && !i.lock.isMine && String(i.lock.userId) !== String(currentUserId || '');
      return i.channel === 'bling' && i.externalId && !lockedByOther;
    })
    .map((i) => String(i.externalId));
  const allSelected = selectable && selectableIds.length > 0 && selectableIds.every((id) => selectedIds?.has(id));
  const someSelected = selectable && selectableIds.some((id) => selectedIds?.has(id));

  return (
    <div className="bs-table-wrap overflow-x-auto">
      <table className="bs-table min-w-[640px] text-[13px] [&_th]:!px-2.5 [&_th]:!py-2 [&_td]:!px-2.5 [&_td]:!py-1.5">
        <thead className="bs-table-head">
          <tr>
            {selectable && (
              <th className="w-8">
                <input
                  type="checkbox"
                  className="rounded border-bs-border"
                  checked={!!allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !!someSelected && !allSelected;
                  }}
                  onChange={() => onToggleSelectAll?.()}
                  title="Selecionar todos desta página"
                />
              </th>
            )}
            <th>SKU</th>
            <th>Nome</th>
            {showCategory && <th className="hidden lg:table-cell">Categoria</th>}
            <th className="hidden md:table-cell text-right">Estoque</th>
            <th className="hidden xl:table-cell">ID</th>
            <th>Problema</th>
            <th className="w-16">Pri.</th>
            {showActions && <th className="text-right w-[1%] whitespace-nowrap">Ação</th>}
          </tr>
        </thead>
        <tbody>
          {issues.map((iss) => {
            const canAct = iss.channel === 'bling' && !!iss.externalId;
            const id = String(iss.externalId || '');
            const busy = deletingId === iss.externalId;
            const checked = !!selectedIds?.has(id);
            const lockedByOther = !!(
              iss.lock
              && !iss.lock.isMine
              && String(iss.lock.userId) !== String(currentUserId || '')
            );
            const inGoiania = !!iss.physicalCheck;
            const goianiaPending = iss.physicalCheck?.status === 'pending';
            const goianiaAnswered = iss.physicalCheck?.status === 'answered';
            const lockTitle = lockedByOther
              ? `Em edição por ${iss.lock?.userName || 'outro usuário'}`
              : iss.lock?.isMine
                ? 'Você está editando este produto'
                : undefined;
            const goianiaTitle = goianiaAnswered
              ? `Goiânia já respondeu${iss.physicalCheck?.answeredByName ? ` (${iss.physicalCheck.answeredByName})` : ''} — abra a fila para aplicar`
              : goianiaPending
                ? `Em análise em Goiânia${iss.physicalCheck?.requestedByName ? ` · pedido por ${iss.physicalCheck.requestedByName}` : ''}`
                : undefined;
            return (
              <tr
                key={iss.id}
                className={`bs-table-row ${checked ? 'bg-bs-accent/5' : ''} ${
                  lockedByOther ? 'opacity-45' : ''
                } ${inGoiania && !lockedByOther ? 'bg-amber-500/5' : ''}`}
                title={lockTitle || goianiaTitle}
              >
                {selectable && (
                  <td>
                    <input
                      type="checkbox"
                      className="rounded border-bs-border"
                      disabled={!canAct || lockedByOther}
                      checked={checked}
                      onChange={() => canAct && !lockedByOther && onToggleSelect?.(id)}
                    />
                  </td>
                )}
                <td className="font-mono text-xs whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    {lockedByOther && (
                      <i className="fa-solid fa-lock text-[10px] text-bs-subtle" title={lockTitle} />
                    )}
                    {inGoiania && (
                      <i className="fa-solid fa-location-dot text-[10px] text-amber-600 dark:text-amber-400" title={goianiaTitle} />
                    )}
                    {iss.sku || '—'}
                  </span>
                </td>
                <td className="text-bs-text max-w-[180px] lg:max-w-[240px]">
                  <span className="block truncate" title={iss.name || undefined}>{iss.name || '—'}</span>
                  {lockedByOther && (
                    <span className="block text-[10px] text-bs-subtle truncate leading-tight">
                      <i className="fa-solid fa-lock mr-1" />
                      {iss.lock?.userName}
                    </span>
                  )}
                  {inGoiania && !lockedByOther && (
                    <span className="block text-[10px] text-amber-700 dark:text-amber-400 font-semibold truncate leading-tight">
                      {goianiaAnswered ? 'Goiânia respondeu' : 'Em análise'}
                    </span>
                  )}
                </td>
                {showCategory && (
                  <td className="hidden lg:table-cell text-bs-muted max-w-[140px]">
                    <span
                      className="block truncate"
                      title={
                        String(iss.category || '').trim()
                        || (iss.meta?.categoryId ? `ID ${iss.meta.categoryId}` : '')
                        || undefined
                      }
                    >
                      {String(iss.category || '').trim()
                        || (iss.meta?.categoryId ? `ID ${iss.meta.categoryId}` : '—')}
                    </span>
                  </td>
                )}
                <td className="hidden md:table-cell text-right tabular-nums text-bs-muted whitespace-nowrap">
                  {iss.stockQty == null ? '—' : iss.stockQty}
                </td>
                <td className="hidden xl:table-cell font-mono text-[11px] text-bs-muted whitespace-nowrap">{iss.externalId || '—'}</td>
                <td className="text-bs-muted max-w-[160px] lg:max-w-[220px]">
                  <span className="block truncate" title={iss.message}>{iss.message}</span>
                </td>
                <td>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${priorityBadge(iss.priority)}`}>
                    {iss.priority === 'critical' ? 'Crít.' : iss.priority === 'medium' ? 'Méd.' : 'Baix.'}
                  </span>
                </td>
                {showActions && (
                  <td className="text-right sticky right-0 bg-bs-surface pl-2">
                    <div className="inline-flex items-center gap-1 justify-end flex-nowrap">
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(iss)}
                          className="bs-btn text-[11px] px-2 py-1 whitespace-nowrap"
                          disabled={!canAct || busy || lockedByOther}
                          title={lockedByOther ? lockTitle : 'Corrigir produto'}
                        >
                          {lockedByOther ? <i className="fa-solid fa-lock" /> : 'Corrigir'}
                        </button>
                      )}
                      {inGoiania && onOpenGoianiaQueue ? (
                        <button
                          type="button"
                          onClick={() => onOpenGoianiaQueue(iss)}
                          className="bs-btn-secondary text-[11px] px-2 py-1 whitespace-nowrap border-amber-500/40 text-amber-700 dark:text-amber-400"
                          disabled={!canAct || busy}
                          title={goianiaTitle}
                        >
                          <i className="fa-solid fa-location-dot" />
                          <span className="ml-1 hidden 2xl:inline">{goianiaAnswered ? 'Ver' : 'Fila'}</span>
                        </button>
                      ) : onRequestGoiania ? (
                        <button
                          type="button"
                          onClick={() => onRequestGoiania(iss)}
                          className="bs-btn-secondary text-[11px] px-2 py-1 whitespace-nowrap"
                          disabled={!canAct || busy || lockedByOther}
                          title="Pedir conferência física em Goiânia"
                        >
                          <i className="fa-solid fa-location-dot" />
                          <span className="ml-1 hidden 2xl:inline">Goiânia</span>
                        </button>
                      ) : null}
                      {onInactivate && (
                        <button
                          type="button"
                          onClick={() => onInactivate(iss)}
                          className="bs-btn-secondary text-[11px] px-2 py-1"
                          disabled={!canAct || busy || lockedByOther}
                          title={lockedByOther ? lockTitle : 'Inativar no Bling'}
                        >
                          <i className="fa-solid fa-pause" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(iss)}
                          className="bs-btn-danger text-[11px] px-2 py-1"
                          disabled={!canAct || busy || lockedByOther}
                          title={lockedByOther ? lockTitle : 'Excluir no Bling'}
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const CatalogQualityView: React.FC = () => {
  const { showToast } = useToast();
  const currentUser = BackendService.loadUser();
  const isCatalogAdmin = currentUser?.role === 'superadmin';
  const isCatalogManager = isCatalogAdmin || userHasModule(currentUser, 'catalog_quality');
  const [tab, setTab] = useState<CatalogTab>(isCatalogManager ? 'dashboard' : 'goiania');
  const [dash, setDash] = useState<CatalogDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<CatalogScan | null>(null);
  const [selectedRule, setSelectedRule] = useState<string>('sku_missing');
  const [issues, setIssues] = useState<CatalogIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [problemsStock, setProblemsStock] = useState<'' | 'in_stock' | 'out_of_stock' | 'unknown'>('');
  const [problemsCategory, setProblemsCategory] = useState('');
  const [issuesByCategory, setIssuesByCategory] = useState<Array<{ name: string; count: number }>>([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [editIssue, setEditIssue] = useState<CatalogIssue | null>(null);
  const [editForm, setEditForm] = useState({
    sku: '',
    name: '',
    price: '',
    weight: '',
    height: '',
    width: '',
    length: '',
    ncm: '',
    brand: '',
    categoryId: '',
    shortDescription: '',
    description: '',
    seoTitle: '',
    seoDescription: '',
    focusKeyword: '',
  });
  const [catalogCategories, setCatalogCategories] = useState<Array<{ id: number; name: string; parentId?: number | null }>>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [editLiveStatus, setEditLiveStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestingAi, setSuggestingAi] = useState(false);
  const [aiRationale, setAiRationale] = useState('');
  const [exporting, setExporting] = useState(false);
  const [syncWooInclude, setSyncWooInclude] = useState(true);
  const [compareData, setCompareData] = useState<{
    rows: Array<{
      sku: string;
      bling: {
        id: string;
        name?: string;
        stockQty?: number | null;
        imageCount?: number;
        price?: number | null;
        weight?: number | null;
        height?: number | null;
        width?: number | null;
        length?: number | null;
      } | null;
      woo: {
        id: string;
        name?: string;
        stockQty?: number | null;
        imageCount?: number;
        price?: number | null;
        salePrice?: number | null;
        weight?: number | null;
        height?: number | null;
        width?: number | null;
        length?: number | null;
      } | null;
      diffs: string[];
    }>;
    total: number;
    truncated: boolean;
    matched: number;
    blingOnly: number;
    wooOnly: number;
    withDiffs: number;
    wooCount: number;
    blingCount: number;
  } | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const [compareDiff, setCompareDiff] = useState('any');
  const [compareStock, setCompareStock] = useState<'' | 'in_stock' | 'out_of_stock' | 'unknown'>('');
  const [exportingCompare, setExportingCompare] = useState(false);
  const [photoCandidates, setPhotoCandidates] = useState(0);
  const [photoImportJob, setPhotoImportJob] = useState<{
    id: string;
    status: string;
    total: number;
    done: number;
    ok: number;
    failed: number;
    message?: string;
    currentSku?: string;
    dryRun?: boolean;
    errors?: Array<{ sku: string; error: string }>;
  } | null>(null);
  const [photoImportBusy, setPhotoImportBusy] = useState(false);
  const [imgOptCandidates, setImgOptCandidates] = useState<Array<{
    source: 'bling' | 'woo';
    sku: string;
    externalId: string;
    blingId?: string | null;
    name?: string;
    flaggedCount: number;
    imageCount: number;
    likelyDuplicates?: boolean;
    reasons?: string[];
    maxWidth: number;
    maxHeight: number;
    maxBytes: number;
    canOptimize?: boolean;
  }>>([]);
  const [imgOptTotal, setImgOptTotal] = useState(0);
  const [imgOptSourceFilter, setImgOptSourceFilter] = useState<'all' | 'bling' | 'woo'>('all');
  const [imgOptSelected, setImgOptSelected] = useState<Set<string>>(new Set());
  const [imgOptJob, setImgOptJob] = useState<{
    id: string;
    kind?: string;
    status: string;
    total: number;
    done: number;
    ok: number;
    failed: number;
    skipped?: number;
    flaggedProducts?: number;
    message?: string;
    currentSku?: string;
    dryRun?: boolean;
    errors?: Array<{ sku: string; error: string }>;
  } | null>(null);
  const [imgOptBusy, setImgOptBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [aiDrafts, setAiDrafts] = useState<CatalogAiDraft[]>([]);
  const [aiDraftsPending, setAiDraftsPending] = useState(0);
  const [aiDraftsLoading, setAiDraftsLoading] = useState(false);
  const [aiDraftSelected, setAiDraftSelected] = useState<Set<string>>(new Set());
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [aiBulkJob, setAiBulkJob] = useState<CatalogAiSuggestJob | null>(null);
  const [aiDraftEdits, setAiDraftEdits] = useState<Record<string, {
    ncm: string;
    weight: string;
    height: string;
    width: string;
    length: string;
    brand: string;
    shortDescription: string;
    description: string;
    seoTitle: string;
    seoDescription: string;
    focusKeyword: string;
  }>>({});
  const [checks, setChecks] = useState<CatalogPhysicalCheck[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checkFilter, setCheckFilter] = useState<
    'open' | 'pending' | 'answered' | 'returned' | 'overdue' | 'applied' | 'all'
  >('open');
  const [requestIssue, setRequestIssue] = useState<CatalogIssue | null>(null);
  const [requestNeed, setRequestNeed] = useState<string[]>(['weight', 'photo']);
  const [requestNote, setRequestNote] = useState('');
  const [requestPriority, setRequestPriority] = useState<'normal' | 'urgent'>('normal');
  const [requestDueHours, setRequestDueHours] = useState<number>(24);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [answerCheck, setAnswerCheck] = useState<CatalogPhysicalCheck | null>(null);
  const [answerForm, setAnswerForm] = useState({
    responseNote: '',
    weight: '',
    height: '',
    width: '',
    length: '',
    photoBase64: '',
  });
  const [answerBusy, setAnswerBusy] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{
    check: CatalogPhysicalCheck;
    mode: 'reopen' | 'close';
  } | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [detailCheck, setDetailCheck] = useState<CatalogPhysicalCheck | null>(null);
  const [comments, setComments] = useState<CatalogPhysicalCheckComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [historyRows, setHistoryRows] = useState<CatalogPhysicalCheck[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showCompletedReport, setShowCompletedReport] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<'today' | '7d' | '30d' | 'all'>('7d');
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<{
    summary: { completed: number; answered: number; applied: number; returned: number };
    byResponder: Array<{ name: string; count: number }>;
    items: CatalogPhysicalCheck[];
  } | null>(null);
  const [reviewedProducts, setReviewedProducts] = useState<Array<{
    externalId: string;
    sku?: string;
    name?: string;
    weight?: number | null;
    height?: number | null;
    width?: number | null;
    length?: number | null;
    ncm?: string;
    reviewStatus?: string;
  }>>([]);
  const [reviewedTotal, setReviewedTotal] = useState(0);
  const [reviewedLoading, setReviewedLoading] = useState(false);
  const [reviewedSearch, setReviewedSearch] = useState('');
  const [outOfScope, setOutOfScope] = useState<{
    products: Array<{
      externalId: string;
      sku?: string;
      name?: string;
      price?: number | null;
      category?: string;
      brand?: string;
      status?: string;
      stockQty?: number | null;
      weight?: number | null;
      ncm?: string;
      imageCount?: number;
      reviewStatus?: string;
    }>;
    total: number;
    truncated: boolean;
    counts: { jewelry: number; bible: number; other: number };
    byCategory: Array<{ name: string; count: number }>;
  } | null>(null);
  const [outOfScopeLoading, setOutOfScopeLoading] = useState(false);
  const [outOfScopeSearch, setOutOfScopeSearch] = useState('');
  const [outOfScopeCategory, setOutOfScopeCategory] = useState('');
  const [outOfScopeStock, setOutOfScopeStock] = useState<'' | 'in_stock' | 'out_of_stock' | 'unknown'>('');
  const [exportingOutOfScope, setExportingOutOfScope] = useState(false);
  const [exportingInventory, setExportingInventory] = useState(false);
  const [wooIdClones, setWooIdClones] = useState<{
    rows: Array<{
      name: string;
      confidence: string;
      action: string;
      woo: { id: string; sku?: string; status?: string; imageCount?: number };
      clone: { id: string; sku?: string; status?: string; imageCount?: number; price?: number | null };
      keep: { id: string; sku?: string; status?: string; imageCount?: number; price?: number | null } | null;
    }>;
    total: number;
    truncated: boolean;
    counts: {
      wooSkuEqId: number;
      withCloneInBling: number;
      withRealAlt: number;
      high: number;
      medium: number;
      low: number;
      listed: number;
    };
  } | null>(null);
  const [wooIdClonesLoading, setWooIdClonesLoading] = useState(false);
  const [wooIdClonesSearch, setWooIdClonesSearch] = useState('');
  const [wooIdClonesConfidence, setWooIdClonesConfidence] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [exportingWooIdClones, setExportingWooIdClones] = useState(false);
  const [cloneSelectedIds, setCloneSelectedIds] = useState<Set<string>>(new Set());
  const [cloneBulkBusy, setCloneBulkBusy] = useState(false);
  /** Funcionário (ex. Goiânia): só responde solicitações da fila. */
  const canAnswerChecks = isCatalogAdmin || userHasModule(currentUser, 'catalog');
  const canInactivate = isCatalogManager;
  const canDelete = isCatalogAdmin;
  const canFix = isCatalogAdmin;

  const visibleTabs = useMemo(() => {
    if (isCatalogAdmin) return TABS;
    const ids = new Set<CatalogTab>();
    if (isCatalogManager) {
      (['dashboard', 'problems', 'reviewed', 'comparator', 'reports'] as CatalogTab[]).forEach((id) => ids.add(id));
    }
    if (canAnswerChecks) ids.add('goiania');
    return TABS.filter((t) => ids.has(t.id));
  }, [isCatalogAdmin, isCatalogManager, canAnswerChecks]);

  const loadAiDrafts = useCallback(async () => {
    if (!isCatalogAdmin) return;
    setAiDraftsLoading(true);
    try {
      const res = await platformService.listCatalogAiDrafts({ status: 'pending', limit: 300 });
      setAiDrafts(res.drafts || []);
      setAiDraftsPending(res.pending || 0);
      const edits: Record<string, {
        ncm: string; weight: string; height: string; width: string; length: string;
        brand: string; shortDescription: string; description: string; seoTitle: string; seoDescription: string;
        focusKeyword: string;
      }> = {};
      for (const d of res.drafts || []) {
        const src = d.edited || d.suggested || {};
        edits[d.id] = {
          ncm: src.ncm != null ? String(src.ncm) : '',
          weight: src.weight != null ? String(src.weight) : '',
          height: src.height != null ? String(src.height) : '',
          width: src.width != null ? String(src.width) : '',
          length: src.length != null ? String(src.length) : '',
          brand: String(src.brand || '').trim() || DEFAULT_CATALOG_BRAND,
          shortDescription: src.shortDescription != null ? String(src.shortDescription) : '',
          description: src.description != null ? String(src.description) : '',
          seoTitle: src.seoTitle != null ? String(src.seoTitle) : '',
          seoDescription: src.seoDescription != null ? String(src.seoDescription) : '',
          focusKeyword: src.focusKeyword != null ? String(src.focusKeyword) : '',
        };
      }
      setAiDraftEdits(edits);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar rascunhos IA', 'error');
    } finally {
      setAiDraftsLoading(false);
    }
  }, [isCatalogAdmin, showToast]);

  useEffect(() => {
    if (tab === 'ai-drafts' && isCatalogAdmin) void loadAiDrafts();
  }, [tab, isCatalogAdmin, loadAiDrafts]);

  useEffect(() => {
    if (!isCatalogAdmin) return;
    void platformService.listCatalogAiDrafts({ status: 'pending', limit: 1 })
      .then((r) => setAiDraftsPending(r.pending || 0))
      .catch(() => {});
  }, [isCatalogAdmin]);

  const authToken = typeof localStorage !== 'undefined' ? localStorage.getItem('va_token') || '' : '';

  useEffect(() => {
    if (isCatalogManager) return;
    if (tab !== 'goiania') setTab('goiania');
  }, [isCatalogManager, tab]);

  const loadChecks = useCallback(async () => {
    setChecksLoading(true);
    try {
      if (checkFilter === 'overdue') {
        const res = await platformService.listPhysicalChecks({ overdue: true, limit: 500 });
        setChecks(res.checks || []);
      } else {
        const status = checkFilter === 'open' || checkFilter === 'all' ? undefined : checkFilter;
        const res = await platformService.listPhysicalChecks({ status, limit: 500 });
        let rows = res.checks || [];
        if (checkFilter === 'open') {
          rows = rows.filter((c) => c.status === 'pending' || c.status === 'answered');
        }
        setChecks(rows);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar fila Goiânia', 'error');
    } finally {
      setChecksLoading(false);
    }
  }, [checkFilter, showToast]);

  useEffect(() => {
    if (tab !== 'goiania') return;
    void loadChecks();
  }, [tab, loadChecks]);

  const loadCompletedReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await platformService.getPhysicalCheckCompletedReport(reportPeriod);
      setReport({
        summary: res.summary,
        byResponder: res.byResponder || [],
        items: res.items || [],
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar relatório', 'error');
    } finally {
      setReportLoading(false);
    }
  }, [reportPeriod, showToast]);

  useEffect(() => {
    if (tab !== 'goiania' || !showCompletedReport) return;
    void loadCompletedReport();
  }, [tab, showCompletedReport, loadCompletedReport]);

  const loadReviewed = useCallback(async () => {
    setReviewedLoading(true);
    try {
      const res = await platformService.listReviewedProducts({
        search: reviewedSearch.trim() || undefined,
        limit: 1000,
      });
      setReviewedProducts(res.products || []);
      setReviewedTotal(res.total || 0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar revisados', 'error');
    } finally {
      setReviewedLoading(false);
    }
  }, [reviewedSearch, showToast]);

  useEffect(() => {
    if (tab !== 'reviewed') return;
    void loadReviewed();
  }, [tab, loadReviewed]);

  const loadOutOfScope = useCallback(async () => {
    setOutOfScopeLoading(true);
    try {
      const res = await platformService.listOutOfScopeProducts({
        search: outOfScopeSearch.trim() || undefined,
        category: outOfScopeCategory.trim() || undefined,
        stock: outOfScopeStock || undefined,
        limit: 2000,
      });
      setOutOfScope(res);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar fora do escopo', 'error');
    } finally {
      setOutOfScopeLoading(false);
    }
  }, [outOfScopeSearch, outOfScopeCategory, outOfScopeStock, showToast]);

  const loadWooIdClones = useCallback(async () => {
    setWooIdClonesLoading(true);
    try {
      const res = await platformService.listWooIdClones({
        search: wooIdClonesSearch.trim() || undefined,
        confidence: wooIdClonesConfidence || undefined,
        cloneStatus: 'active',
        limit: 2000,
      });
      setWooIdClones(res);
      setCloneSelectedIds(new Set());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar clones Woo-ID', 'error');
    } finally {
      setWooIdClonesLoading(false);
    }
  }, [wooIdClonesSearch, wooIdClonesConfidence, showToast]);

  useEffect(() => {
    if (tab !== 'reports') return;
    void loadOutOfScope();
    void loadWooIdClones();
  }, [tab, loadOutOfScope, loadWooIdClones]);

  const openReviewedProduct = async (externalId: string, sku?: string, name?: string) => {
    await openEdit({
      id: `reviewed_${externalId}`,
      ruleId: '',
      priority: 'low',
      channel: 'bling',
      externalId,
      sku: sku || '',
      name: name || '',
      message: 'Produto já revisado',
      createdAt: Date.now(),
    });
  };

  const refreshDash = useCallback(async () => {
    const data = await platformService.getCatalogDashboard();
    setDash(data);
    if (data.latestScan) setScan(data.latestScan);
    // Prefer first rule that has problems
    const firstWithCount = (data.rules || []).find((r) => r.count > 0);
    if (firstWithCount) {
      setSelectedRule((prev) => {
        const stillValid = (data.rules || []).some((r) => r.id === prev && r.count > 0);
        return stillValid ? prev : firstWithCount.id;
      });
    }
    return data;
  }, []);

  useEffect(() => {
    if (!isCatalogManager) {
      setLoading(false);
      return;
    }
    refreshDash()
      .catch((e) => showToast(e instanceof Error ? e.message : 'Erro ao carregar dashboard', 'error'))
      .finally(() => setLoading(false));
  }, [isCatalogManager, refreshDash, showToast]);

  useEffect(() => {
    if (!scanning || !scan?.id) return undefined;
    const t = setInterval(async () => {
      try {
        const s = await platformService.getCatalogScan(scan.id);
        setScan(s);
        if (s.status === 'done' || s.status === 'failed') {
          setScanning(false);
          await refreshDash();
          if (s.status === 'done') {
            showToast(
              String(s.id || '').includes('_cats')
                ? `Categorias atualizadas — ${s.issueCount || 0} problemas restantes`
                : `Análise ok — ${s.issueCount || 0} problemas · ${s.blingCount || 0} Bling · ${s.wooCount || 0} Woo`,
              'success',
            );
            setTab('problems');
          } else {
            showToast(s.error || s.message || 'Scan falhou', 'error');
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [scanning, scan?.id, refreshDash, showToast]);

  const loadIssues = useCallback(async (ruleId: string) => {
    if (!ruleId) return;
    setIssuesLoading(true);
    try {
      const hasFilter = Boolean(problemsStock || problemsCategory);
      const res = await platformService.listCatalogIssues({
        ruleId,
        stock: problemsStock || undefined,
        category: problemsCategory.trim() || undefined,
        limit: hasFilter ? 5000 : 2000,
      });
      setIssues(res.issues || []);
      setIssuesByCategory(res.byCategory || []);
      setIssuesTotal(res.total || 0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao listar produtos', 'error');
    } finally {
      setIssuesLoading(false);
    }
  }, [problemsStock, problemsCategory, showToast]);

  useEffect(() => {
    if (!isCatalogAdmin || aiBulkJob?.status !== 'running') return undefined;
    const t = window.setInterval(() => {
      void platformService.getBulkCatalogAiSuggestJob().then((r) => {
        const j = r.job;
        setAiBulkJob(j);
        // Atualiza lista de aprovação enquanto as ondas vão enchendo
        void loadAiDrafts();
        if (j && j.status !== 'running') {
          void refreshDash();
          if (selectedRule) void loadIssues(selectedRule);
          if (j.status === 'done') {
            showToast(j.message || 'Rascunhos prontos — revise antes de aplicar no Bling.', 'success');
          } else if (j.status === 'cancelled') {
            showToast(j.message || 'Geração cancelada.', 'info');
          }
        }
      }).catch(() => {});
    }, 2500);
    return () => window.clearInterval(t);
  }, [isCatalogAdmin, aiBulkJob?.status, loadAiDrafts, refreshDash, loadIssues, selectedRule, showToast]);

  useEffect(() => {
    if (tab !== 'problems' || !selectedRule) return;
    loadIssues(selectedRule);
    setSelectedIds(new Set());
  }, [tab, selectedRule, loadIssues]);

  useEffect(() => {
    if (tab !== 'comparator') return;
    setCompareLoading(true);
    platformService
      .listCatalogCompare({
        search: compareSearch.trim() || undefined,
        diff: compareDiff || 'any',
        stock: compareStock || undefined,
        limit: 1000,
      })
      .then(setCompareData)
      .catch((e) => showToast(e instanceof Error ? e.message : 'Erro ao comparar', 'error'))
      .finally(() => setCompareLoading(false));
  }, [tab, compareSearch, compareDiff, compareStock, showToast]);

  useEffect(() => {
    if (tab !== 'comparator' || !(dash?.wooCount)) return;
    platformService
      .listPhotoImportCandidates({ limit: 1 })
      .then((r) => setPhotoCandidates(r.total || 0))
      .catch(() => {});
    platformService
      .getPhotoImportJob()
      .then((r) => setPhotoImportJob(r.job))
      .catch(() => {});
  }, [tab, dash?.wooCount]);

  useEffect(() => {
    if (tab !== 'comparator' || photoImportJob?.status !== 'running') return undefined;
    const t = setInterval(() => {
      platformService
        .getPhotoImportJob()
        .then((r) => {
          setPhotoImportJob(r.job);
          if (r.job && r.job.status !== 'running') {
            setPhotoCandidates((prev) => Math.max(0, prev - (r.job?.ok || 0)));
            void refreshDash().catch(() => {});
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [tab, photoImportJob?.status, refreshDash]);

  const refreshImgOptCandidates = useCallback(async (source: 'all' | 'bling' | 'woo' = imgOptSourceFilter) => {
    try {
      const r = await platformService.listImageOptimizeCandidates({ source, limit: 2000 });
      setImgOptCandidates(r.candidates || []);
      setImgOptTotal(r.total || 0);
    } catch {
      /* ignore */
    }
  }, [imgOptSourceFilter]);

  useEffect(() => {
    if (tab !== 'comparator' || !isCatalogAdmin) return;
    platformService
      .getImageOptimizeJob()
      .then((r) => setImgOptJob(r.job))
      .catch(() => {});
    void refreshImgOptCandidates('all');
  }, [tab, isCatalogAdmin, refreshImgOptCandidates]);

  useEffect(() => {
    if (tab !== 'comparator' || !isCatalogAdmin) return;
    void refreshImgOptCandidates(imgOptSourceFilter);
  }, [tab, isCatalogAdmin, imgOptSourceFilter, refreshImgOptCandidates]);

  useEffect(() => {
    if (tab !== 'comparator' || !isCatalogAdmin || imgOptJob?.status !== 'running') return undefined;
    const t = setInterval(() => {
      platformService
        .getImageOptimizeJob()
        .then((r) => {
          setImgOptJob(r.job);
          if (r.job && r.job.status !== 'running') {
            if (r.job.kind === 'scan' || r.job.kind === 'optimize') {
              void refreshImgOptCandidates(imgOptSourceFilter);
            }
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [tab, isCatalogAdmin, imgOptJob?.status, imgOptSourceFilter, refreshImgOptCandidates]);

  // Atualiza cadeados na lista enquanto a equipe trabalha
  useEffect(() => {
    if (tab !== 'problems' || !selectedRule) return undefined;
    const t = setInterval(() => {
      const hasFilter = Boolean(problemsStock || problemsCategory);
      platformService.listCatalogIssues({
        ruleId: selectedRule,
        stock: problemsStock || undefined,
        category: problemsCategory.trim() || undefined,
        limit: hasFilter ? 5000 : 2000,
      })
        .then((res) => {
          setIssues(res.issues || []);
          setIssuesByCategory(res.byCategory || []);
          setIssuesTotal(res.total || 0);
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [tab, selectedRule, problemsStock, problemsCategory]);

  // Mantém a reserva enquanto o modal está aberto
  useEffect(() => {
    if (!editIssue?.externalId) return undefined;
    const id = editIssue.externalId;
    const t = setInterval(() => {
      platformService.heartbeatCatalogProduct(id).catch(() => {});
    }, 45_000);
    return () => clearInterval(t);
  }, [editIssue?.externalId]);

  // Libera reserva se fechar a aba
  useEffect(() => {
    const onUnload = () => {
      const id = editIssue?.externalId;
      if (!id) return;
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('va_token') : null;
        fetch(`/api/catalog/products/${encodeURIComponent(id)}/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: '{}',
          keepalive: true,
        });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [editIssue?.externalId]);

  const closeEdit = useCallback(async (opts?: { skipRelease?: boolean }) => {
    const id = editIssue?.externalId;
    setEditIssue(null);
    setAiRationale('');
    setEditLiveStatus('idle');
    setRefreshingLive(false);
    if (!opts?.skipRelease && id) {
      try {
        await platformService.releaseCatalogProduct(id);
      } catch {
        /* ignore */
      }
      // refresh list so cadeado some para os outros
      if (selectedRule) {
        void loadIssues(selectedRule);
      }
    }
  }, [editIssue?.externalId, selectedRule, loadIssues]);

  const loadCatalogCategories = useCallback(async () => {
    try {
      const res = await platformService.listCatalogCategories();
      setCatalogCategories(res.categories || []);
    } catch {
      /* silencioso — select fica vazio */
    }
  }, []);

  const openEdit = async (iss: CatalogIssue) => {
    if (!iss.externalId || iss.channel !== 'bling') return;
    if (iss.lock && !iss.lock.isMine && String(iss.lock.userId) !== String(currentUser?.id || '')) {
      showToast(`Produto bloqueado — ${iss.lock.userName} está editando.`, 'info');
      return;
    }
    try {
      await platformService.claimCatalogProduct(iss.externalId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Produto já está em edição por outra pessoa.', 'error');
      if (selectedRule) {
        void loadIssues(selectedRule);
      }
      return;
    }
    setEditIssue(iss);
    setAiRationale('');
    setNewCategoryName('');
    setEditLiveStatus('loading');
    void loadCatalogCategories();
    setEditForm({
      sku: iss.sku || '',
      name: iss.name || '',
      price: '',
      weight: '',
      height: '',
      width: '',
      length: '',
      ncm: '',
      brand: '',
      categoryId: '',
      shortDescription: '',
      description: '',
      seoTitle: '',
      seoDescription: '',
      focusKeyword: '',
    });
    try {
      try {
        await platformService.refreshCatalogProduct(iss.externalId);
        setEditLiveStatus('ok');
      } catch {
        setEditLiveStatus('error');
      }
      const p = await platformService.getCatalogProduct(iss.externalId) as {
        sku?: string; name?: string; price?: number; weight?: number;
        height?: number; width?: number; length?: number; ncm?: string;
        brand?: string; category?: string; description?: string; shortDescription?: string;
        seoTitle?: string; seoDescription?: string; focusKeyword?: string;
        rawJson?: string | Record<string, unknown>;
      };
      const categoryId = categoryIdFromProduct(p);
      setEditForm({
        sku: p.sku || iss.sku || '',
        name: p.name || iss.name || '',
        price: p.price != null ? String(p.price) : '',
        weight: p.weight != null ? String(p.weight) : '',
        height: p.height != null ? String(p.height) : '',
        width: p.width != null ? String(p.width) : '',
        length: p.length != null ? String(p.length) : '',
        ncm: p.ncm || '',
        brand: p.brand || DEFAULT_CATALOG_BRAND,
        categoryId,
        shortDescription: p.shortDescription || '',
        description: p.description || '',
        seoTitle: p.seoTitle || '',
        seoDescription: p.seoDescription || '',
        focusKeyword: p.focusKeyword || '',
      });
      // Se já existir rascunho IA pendente, preenche campos vazios
      try {
        const draftsRes = await platformService.listCatalogAiDrafts({ status: 'pending', limit: 300 });
        const draft = (draftsRes.drafts || []).find((d) => String(d.externalId) === String(iss.externalId));
        if (draft) {
          const src = draft.edited || draft.suggested || {};
          setEditForm((prev) => {
            const blank = (v: string) => {
              const t = String(v || '').trim().replace(',', '.');
              if (!t) return true;
              const n = Number(t);
              return Number.isFinite(n) && n <= 0;
            };
            const blankNcm = !String(prev.ncm || '').replace(/\D/g, '');
            const blankText = (v: string) => !String(v || '').trim();
            return {
              ...prev,
              ncm: blankNcm && src.ncm ? String(src.ncm) : prev.ncm,
              weight: blank(prev.weight) && src.weight != null ? String(src.weight) : prev.weight,
              height: blank(prev.height) && src.height != null ? String(src.height) : prev.height,
              width: blank(prev.width) && src.width != null ? String(src.width) : prev.width,
              length: blank(prev.length) && src.length != null ? String(src.length) : prev.length,
              brand: blankText(prev.brand) && src.brand ? String(src.brand) : (prev.brand || DEFAULT_CATALOG_BRAND),
              shortDescription: blankText(prev.shortDescription) && src.shortDescription
                ? String(src.shortDescription) : prev.shortDescription,
              description: blankText(prev.description) && src.description
                ? String(src.description) : prev.description,
              seoTitle: blankText(prev.seoTitle) && src.seoTitle
                ? String(src.seoTitle) : prev.seoTitle,
              seoDescription: blankText(prev.seoDescription) && src.seoDescription
                ? String(src.seoDescription) : prev.seoDescription,
              focusKeyword: blankText(prev.focusKeyword) && src.focusKeyword
                ? String(src.focusKeyword) : prev.focusKeyword,
            };
          });
          if (src.rationale) setAiRationale(String(src.rationale));
        }
      } catch {
        /* ignore */
      }
      } catch {
        /* usa dados do issue */
        setEditLiveStatus((prev) => (prev === 'loading' ? 'error' : prev));
      }
    };

  const openRequestGoiania = (iss: CatalogIssue) => {
    if (!iss.externalId || iss.channel !== 'bling') return;
    const st = iss.physicalCheck?.status;
    if (st === 'pending' || st === 'answered') {
      showToast(
        st === 'answered'
          ? 'Goiânia já respondeu este produto. Abrindo a fila…'
          : 'Este produto já está em análise em Goiânia. Abrindo a fila…',
        'info',
      );
      setTab('goiania');
      setCheckFilter(st === 'answered' ? 'answered' : 'pending');
      return;
    }
    setRequestIssue(iss);
    setRequestNeed(['weight', 'photo']);
    setRequestNote('');
    setRequestPriority('normal');
    setRequestDueHours(24);
    setRequestError('');
  };

  const openGoianiaQueueFromIssue = (iss: CatalogIssue) => {
    setTab('goiania');
    setCheckFilter(
      iss.physicalCheck?.status === 'answered' ? 'answered'
        : iss.physicalCheck?.status === 'pending' ? 'pending'
          : 'open',
    );
  };

  const submitRequestGoiania = async () => {
    if (!requestIssue?.externalId) return;
    if (!requestNeed.length) {
      setRequestError('Marque o que precisa ser conferido.');
      showToast('Marque o que precisa ser conferido.', 'error');
      return;
    }
    setRequestBusy(true);
    setRequestError('');
    try {
      const res = await platformService.createPhysicalCheck({
        externalId: requestIssue.externalId,
        sku: requestIssue.sku,
        name: requestIssue.name,
        need: requestNeed,
        requestNote,
        priority: requestPriority,
        dueHours: requestDueHours,
      });
      setDash(res.dashboard);
      setRequestIssue(null);
      showToast('Pedido enviado para a fila Goiânia. Operadores serão avisados no WhatsApp em ~2 min.', 'success');
      setTab('goiania');
      setCheckFilter('open');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar pedido';
      setRequestError(msg);
      showToast(msg, 'error');
    } finally {
      setRequestBusy(false);
    }
  };

  const openAnswer = (check: CatalogPhysicalCheck) => {
    setAnswerCheck(check);
    setAnswerForm({
      responseNote: '',
      weight: check.responseWeight != null ? String(check.responseWeight) : '',
      height: check.responseHeight != null ? String(check.responseHeight) : '',
      width: check.responseWidth != null ? String(check.responseWidth) : '',
      length: check.responseLength != null ? String(check.responseLength) : '',
      photoBase64: '',
    });
  };

  const onPickPhoto = (file: File | null) => {
    if (!file) {
      setAnswerForm((f) => ({ ...f, photoBase64: '' }));
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('Envie uma imagem (JPG/PNG/WebP).', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAnswerForm((f) => ({ ...f, photoBase64: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  };

  const submitAnswer = async () => {
    if (!answerCheck) return;
    const needsPhoto = (answerCheck.need || []).includes('photo');
    if (needsPhoto && !answerForm.photoBase64) {
      showToast('Este pedido exige foto. Envie a foto da peça/etiqueta.', 'error');
      return;
    }
    setAnswerBusy(true);
    try {
      const res = await platformService.answerPhysicalCheck(answerCheck.id, {
        responseNote: answerForm.responseNote,
        weight: answerForm.weight,
        height: answerForm.height,
        width: answerForm.width,
        length: answerForm.length,
        photoBase64: answerForm.photoBase64 || undefined,
      });
      if (res.dashboard) setDash(res.dashboard);
      setAnswerCheck(null);
      showToast('Resposta enviada. O cadastro pode aplicar no Bling.', 'success');
      await loadChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao responder', 'error');
    } finally {
      setAnswerBusy(false);
    }
  };

  const openReturn = (check: CatalogPhysicalCheck, mode: 'reopen' | 'close') => {
    setReturnTarget({ check, mode });
    setReturnReason('');
  };

  const submitReturn = async () => {
    if (!returnTarget) return;
    const reason = returnReason.trim();
    if (!reason) {
      showToast('Informe o motivo da devolução.', 'error');
      return;
    }
    setReturnBusy(true);
    try {
      const res = await platformService.returnPhysicalCheck(returnTarget.check.id, {
        reason,
        mode: returnTarget.mode,
      });
      if (res.dashboard) setDash(res.dashboard);
      setReturnTarget(null);
      showToast(
        returnTarget.mode === 'reopen'
          ? 'Pedido devolvido para Goiânia refazer.'
          : 'Pedido marcado como devolvido.',
        'success',
      );
      await loadChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao devolver', 'error');
    } finally {
      setReturnBusy(false);
    }
  };

  const openCheckDetail = async (check: CatalogPhysicalCheck) => {
    setDetailCheck(check);
    setCommentDraft('');
    setComments([]);
    setHistoryRows([]);
    setCommentsBusy(true);
    setHistoryLoading(true);
    try {
      const [cRes, hRes] = await Promise.all([
        platformService.listPhysicalCheckComments(check.id),
        platformService.listPhysicalChecks({ externalId: check.externalId, limit: 50 }),
      ]);
      setComments(cRes.comments || []);
      setHistoryRows(hRes.checks || []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar detalhes', 'error');
    } finally {
      setCommentsBusy(false);
      setHistoryLoading(false);
    }
  };

  const submitComment = async () => {
    if (!detailCheck) return;
    const body = commentDraft.trim();
    if (!body) return;
    setCommentsBusy(true);
    try {
      const res = await platformService.addPhysicalCheckComment(detailCheck.id, body);
      setComments((prev) => [...prev, res.comment]);
      setCommentDraft('');
      showToast('Comentário adicionado.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao comentar', 'error');
    } finally {
      setCommentsBusy(false);
    }
  };

  const handleApplyCheck = async (check: CatalogPhysicalCheck) => {
    try {
      const res = await platformService.applyPhysicalCheck(check.id);
      setDash(res.dashboard);
      showToast(
        res.patched
          ? 'Peso/dims aplicados no Bling.'
          : 'Marcado como aplicado (sem peso/dims para gravar — use a foto/nota no Corrigir).',
        'success',
      );
      await loadChecks();
      await refreshDash();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao aplicar', 'error');
    }
  };

  const handleCancelCheck = async (check: CatalogPhysicalCheck) => {
    if (!confirm('Cancelar este pedido pendente?')) return;
    try {
      const res = await platformService.cancelPhysicalCheck(check.id);
      setDash(res.dashboard);
      showToast('Pedido cancelado.', 'info');
      await loadChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao cancelar', 'error');
    }
  };

  const handleDeleteCheck = async (check: CatalogPhysicalCheck) => {
    const label = [check.sku, check.name].filter(Boolean).join(' — ') || check.externalId;
    if (!confirm(`Excluir este pedido da fila?\n\n${label}\n\nUse se preencheram errado. Depois pode criar um novo pedido.`)) {
      return;
    }
    try {
      const res = await platformService.deletePhysicalCheck(check.id);
      setDash(res.dashboard);
      showToast('Pedido excluído. Pode criar outro se precisar.', 'success');
      await loadChecks();
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao excluir', 'error');
    }
  };

  /** Sempre pede todos os campos úteis — a UI só sobrescreve os que estão vazios/zerados. */
  const fieldsForAiSuggest = (_ruleId?: string): Array<'ncm' | 'weight' | 'dimensions' | 'description'> => (
    ['ncm', 'weight', 'dimensions', 'description']
  );

  const handleSuggestAi = async () => {
    if (!editIssue?.externalId) return;
    setSuggestingAi(true);
    try {
      const fields = fieldsForAiSuggest(editIssue.ruleId);
      const res = await platformService.suggestCatalogProduct(editIssue.externalId, {
        name: editForm.name,
        sku: editForm.sku,
        fields,
        provider: undefined, // backend escolhe Gemini se OpenAI estiver sem cota
        saveDraft: true,
      });
      const s = res.suggestions || {
        ncm: null, weight: null, height: null, width: null, length: null,
        shortDescription: null, description: null, seoTitle: null, seoDescription: null,
        focusKeyword: null, rationale: '',
      };
      /** Vazio ou zero inválido (0 / 0,0) — Bling manda 0 quando não tem valor real. */
      const isBlankMeasure = (v: string) => {
        const t = String(v || '').trim().replace(',', '.');
        if (!t) return true;
        const n = Number(t);
        return Number.isFinite(n) && n <= 0;
      };
      const isBlankNcm = (v: string) => !String(v || '').replace(/\D/g, '');
      const isBlankText = (v: string) => !String(v || '').trim();

      const next = { ...editForm };
      let filled = 0;
      if (isBlankNcm(editForm.ncm) && s.ncm) {
        next.ncm = s.ncm;
        filled += 1;
      }
      if (isBlankMeasure(editForm.weight) && s.weight != null) {
        next.weight = String(s.weight);
        filled += 1;
      }
      if (isBlankMeasure(editForm.height) && s.height != null) {
        next.height = String(s.height);
        filled += 1;
      }
      if (isBlankMeasure(editForm.width) && s.width != null) {
        next.width = String(s.width);
        filled += 1;
      }
      if (isBlankMeasure(editForm.length) && s.length != null) {
        next.length = String(s.length);
        filled += 1;
      }
      if (isBlankText(editForm.shortDescription) && s.shortDescription) {
        next.shortDescription = s.shortDescription;
        filled += 1;
      }
      if (isBlankText(editForm.description) && s.description) {
        next.description = s.description;
        filled += 1;
      }
      if (isBlankText(editForm.seoTitle) && s.seoTitle) {
        next.seoTitle = s.seoTitle;
        filled += 1;
      }
      if (isBlankText(editForm.seoDescription) && s.seoDescription) {
        next.seoDescription = s.seoDescription;
        filled += 1;
      }
      if (isBlankText(editForm.focusKeyword) && s.focusKeyword) {
        next.focusKeyword = s.focusKeyword;
        filled += 1;
      }
      setEditForm(next);
      setAiRationale(s.rationale || '');
      void platformService.listCatalogAiDrafts({ status: 'pending', limit: 1 })
        .then((r) => setAiDraftsPending(r.pending || 0))
        .catch(() => {});
      const hadSuggestion = Boolean(
        s.ncm || s.weight != null || s.height != null || s.width != null || s.length != null
        || s.shortDescription || s.description || s.seoTitle || s.seoDescription || s.focusKeyword,
      );
      const via = res.provider === 'openai' ? 'ChatGPT' : (res.provider || 'IA');
      if (filled > 0) {
        showToast(`${via} preencheu ${filled} campo(s). Revise antes de salvar no Bling.`, 'success');
      } else if (hadSuggestion) {
        showToast('Campos já têm valores válidos — a IA não sobrescreveu. Zere o campo se quiser nova sugestão.', 'info');
      } else {
        showToast('IA não conseguiu sugerir valores úteis. Tente de novo ou preencha manualmente.', 'info');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao sugerir com IA', 'error');
    } finally {
      setSuggestingAi(false);
    }
  };

  const handleBulkAiSuggest = async () => {
    const allIds = [...selectedIds];
    if (!allIds.length) {
      showToast('Selecione ao menos um produto.', 'info');
      return;
    }
    const WAVE = 15;
    const QUEUE_MAX = 500;
    const ids = allIds.slice(0, QUEUE_MAX);
    const waves = Math.ceil(ids.length / WAVE);
    const estMin = Math.max(1, Math.ceil((ids.length * 5 + Math.max(0, waves - 1) * 20) / 60));
    const truncatedNote = allIds.length > QUEUE_MAX
      ? `\n(Máximo ${QUEUE_MAX} por fila — ${allIds.length - QUEUE_MAX} ficaram de fora.)\n`
      : '';
    if (!confirm(
      `Gerar rascunhos para ${ids.length} produto(s)?\n`
      + truncatedNote
      + `\nProcessa em ondas de ${WAVE} (ex.: onda 1 → pausa → onda 2…).\n`
      + `Total: ${waves} onda(s) · ~${estMin} min.\n`
      + `Campos: ${fieldsForAiSuggest(selectedRule).join(', ')}\n\n`
      + 'Cada SKU vai entrando na lista de aprovação. Nada vai ao Bling até você aplicar.',
    )) {
      return;
    }

    setBulkBusy(true);
    try {
      const res = await platformService.startBulkCatalogAiSuggest({
        externalIds: ids,
        fields: fieldsForAiSuggest(selectedRule),
      });
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
      if (res.alreadyRunning) {
        showToast('Já existe uma geração de rascunhos em andamento.', 'info');
      } else {
        showToast(
          waves > 1
            ? `Fila de ${ids.length} iniciada · ${waves} ondas de até ${WAVE}. Acompanhe em Rascunhos IA.`
            : `Gerando ${ids.length} rascunho(s)… abra Rascunhos IA.`,
          'success',
        );
        setTab('ai-drafts');
      }
      setAiBulkJob(res.job);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao iniciar sugestão em massa', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const draftEditValue = (id: string) => aiDraftEdits[id] || {
    ncm: '', weight: '', height: '', width: '', length: '',
    brand: DEFAULT_CATALOG_BRAND,
    shortDescription: '', description: '', seoTitle: '', seoDescription: '',
    focusKeyword: '',
  };

  const setDraftField = (id: string, key: keyof ReturnType<typeof draftEditValue>, value: string) => {
    setAiDraftEdits((prev) => ({
      ...prev,
      [id]: { ...draftEditValue(id), ...(prev[id] || {}), [key]: value },
    }));
  };

  const handleApplyAiDraft = async (draft: CatalogAiDraft) => {
    const ed = draftEditValue(draft.id);
    if (!confirm(`Aplicar correção de ${draft.sku || draft.externalId} no Bling agora?`)) return;
    setAiDraftBusy(true);
    try {
      await platformService.applyCatalogAiDraft(draft.id, {
        ncm: ed.ncm || null,
        weight: ed.weight ? Number(ed.weight.replace(',', '.')) : null,
        height: ed.height ? Number(ed.height.replace(',', '.')) : null,
        width: ed.width ? Number(ed.width.replace(',', '.')) : null,
        length: ed.length ? Number(ed.length.replace(',', '.')) : null,
        brand: ed.brand || DEFAULT_CATALOG_BRAND,
        shortDescription: ed.shortDescription || null,
        description: ed.description || null,
        seoTitle: ed.seoTitle || null,
        seoDescription: ed.seoDescription || null,
        focusKeyword: ed.focusKeyword || null,
      });
      showToast(`Aplicado no Bling: ${draft.sku || draft.externalId}`, 'success');
      setAiDraftSelected((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
      await loadAiDrafts();
      await refreshDash();
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao aplicar no Bling', 'error');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const handleDiscardAiDraft = async (draft: CatalogAiDraft) => {
    if (!confirm(`Descartar rascunho de ${draft.sku || draft.externalId}?`)) return;
    setAiDraftBusy(true);
    try {
      await platformService.discardCatalogAiDraft(draft.id);
      await loadAiDrafts();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao descartar', 'error');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const handleApplyAiDraftsBulk = async () => {
    const ids = [...aiDraftSelected];
    if (!ids.length) {
      showToast('Selecione rascunhos para aplicar.', 'info');
      return;
    }
    if (!confirm(
      `Aplicar ${ids.length} rascunho(s) no Bling?\n\n`
      + 'Só confirme se já conferiu NCM / peso / dimensões / textos.',
    )) return;
    setAiDraftBusy(true);
    try {
      // Salva edições locais antes de aplicar
      for (const id of ids) {
        const ed = draftEditValue(id);
        try {
          await platformService.updateCatalogAiDraft(id, {
            ncm: ed.ncm || null,
            weight: ed.weight ? Number(ed.weight.replace(',', '.')) : null,
            height: ed.height ? Number(ed.height.replace(',', '.')) : null,
            width: ed.width ? Number(ed.width.replace(',', '.')) : null,
            length: ed.length ? Number(ed.length.replace(',', '.')) : null,
            brand: ed.brand || DEFAULT_CATALOG_BRAND,
            shortDescription: ed.shortDescription || null,
            description: ed.description || null,
            seoTitle: ed.seoTitle || null,
            seoDescription: ed.seoDescription || null,
            focusKeyword: ed.focusKeyword || null,
          });
        } catch {
          /* apply ainda usa suggested se update falhar */
        }
      }
      const res = await platformService.applyCatalogAiDraftsBulk(ids);
      showToast(
        `Aplicados no Bling: ${res.ok} ok${res.failed ? ` · ${res.failed} erro(s)` : ''}`,
        res.failed ? 'info' : 'success',
      );
      setAiDraftSelected(new Set());
      await loadAiDrafts();
      await refreshDash();
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao aplicar em massa', 'error');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const handleDiscardAiDraftsBulk = async (all = false) => {
    const ids = all ? aiDrafts.map((d) => d.id) : [...aiDraftSelected];
    if (!ids.length) {
      showToast(all ? 'Lista vazia.' : 'Selecione rascunhos para descartar.', 'info');
      return;
    }
    if (!confirm(
      all
        ? `Limpar toda a lista de aprovação (${ids.length} rascunho(s))?\n\n`
          + 'Eles voltam a aparecer em Problemas. Nada é enviado ao Bling.'
        : `Descartar ${ids.length} rascunho(s) selecionado(s)?\n\n`
          + 'Voltam para Problemas. Nada é enviado ao Bling.',
    )) return;
    setAiDraftBusy(true);
    try {
      const res = await platformService.discardCatalogAiDraftsBulk(ids);
      showToast(`Descartados: ${res.discarded}`, 'success');
      setAiDraftSelected(new Set());
      await loadAiDrafts();
      await refreshDash();
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao descartar', 'error');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editIssue?.externalId) return;
    setSaving(true);
    try {
      const res = await platformService.fixCatalogProduct(editIssue.externalId, {
        sku: editForm.sku,
        name: editForm.name,
        price: editForm.price,
        weight: editForm.weight,
        height: editForm.height,
        width: editForm.width,
        length: editForm.length,
        ncm: editForm.ncm,
        brand: editForm.brand,
        categoryId: editForm.categoryId ? Number(editForm.categoryId) : undefined,
        shortDescription: editForm.shortDescription,
        description: editForm.description,
        seoTitle: editForm.seoTitle,
        seoDescription: editForm.seoDescription,
        focusKeyword: editForm.focusKeyword,
      });
      setDash(res.dashboard);
      setEditIssue(null);
      setAiRationale('');
      showToast(
        res.remainingIssues > 0
          ? `Salvo no Bling. Ainda restam ${res.remainingIssues} problema(s) neste produto.`
          : 'Salvo no Bling e marcado como revisado.',
        res.remainingIssues > 0 ? 'info' : 'success',
      );
      if (selectedRule) await loadIssues(selectedRule);
      if (tab === 'reviewed') await loadReviewed();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar no Bling', 'error');
    } finally {
      setSaving(false);
    }
  };

  const markReviewedOnly = async () => {
    if (!editIssue?.externalId) return;
    setSaving(true);
    try {
      const res = await platformService.markCatalogProductReviewed(editIssue.externalId);
      setDash(res.dashboard);
      setEditIssue(null);
      showToast('Produto marcado como revisado.', 'success');
      if (selectedRule) await loadIssues(selectedRule);
      if (tab === 'reviewed') await loadReviewed();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao marcar revisado', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (iss: CatalogIssue) => {
    if (!iss.externalId || iss.channel !== 'bling') return;
    const label = [iss.sku, iss.name].filter(Boolean).join(' — ') || iss.externalId;
    if (!confirm(`Excluir permanentemente no Bling?\n\n${label}\nID ${iss.externalId}\n\nSe o Bling bloquear (pedido/NF), oferecemos inativar.`)) {
      return;
    }
    setDeletingId(iss.externalId);
    try {
      const res = await platformService.deleteCatalogProduct(iss.externalId);
      setDash(res.dashboard);
      if (editIssue?.externalId === iss.externalId) setEditIssue(null);
      showToast(`Excluído no Bling: ${res.name || res.sku || res.deletedId}`, 'success');
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir no Bling';
      const canInactivate = /não permite excluir|não pode ser removido|inativar|validação/i.test(msg);
      if (canInactivate && confirm(`${msg}\n\nInativar este produto no Bling agora?`)) {
        try {
          const res = await platformService.inactivateCatalogProduct(iss.externalId);
          setDash(res.dashboard);
          if (editIssue?.externalId === iss.externalId) setEditIssue(null);
          showToast(`Inativado no Bling: ${res.name || res.sku || iss.externalId}`, 'success');
          if (selectedRule) await loadIssues(selectedRule);
        } catch (e2) {
          showToast(e2 instanceof Error ? e2.message : 'Erro ao inativar', 'error');
        }
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleInactivate = async (iss: CatalogIssue) => {
    if (!iss.externalId || iss.channel !== 'bling') return;
    const label = [iss.sku, iss.name].filter(Boolean).join(' — ') || iss.externalId;
    if (!confirm(`Inativar no Bling?\n\n${label}\n\nO produto deixa de aparecer como ativo (não apaga histórico).`)) {
      return;
    }
    setDeletingId(iss.externalId);
    try {
      const res = await platformService.inactivateCatalogProduct(iss.externalId);
      setDash(res.dashboard);
      if (editIssue?.externalId === iss.externalId) setEditIssue(null);
      showToast(`Inativado: ${res.name || res.sku || iss.externalId}`, 'success');
      if (selectedRule) await loadIssues(selectedRule);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao inativar', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const ids = filteredIssues
      .filter((i) => i.channel === 'bling' && i.externalId)
      .map((i) => String(i.externalId));
    setSelectedIds((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulk = async (action: 'inactivate' | 'delete') => {
    const ids = [...selectedIds];
    if (!ids.length) {
      showToast('Selecione ao menos um produto.', 'info');
      return;
    }
    const CHUNK = 100;
    const waves = Math.ceil(ids.length / CHUNK);
    const label = action === 'inactivate' ? 'inativar' : 'excluir';
    const extra = action === 'delete'
      ? '\n\nSe o Bling bloquear algum, ele será inativado automaticamente.'
      : '\n\nFicam Inativos no Bling (histórico preservado).';
    if (!confirm(
      `${label.toUpperCase()} ${ids.length} produto(s) no Bling?`
      + (waves > 1 ? `\n\nSerão ${waves} lotes de até ${CHUNK}.` : '')
      + extra,
    )) return;

    setBulkBusy(true);
    setBulkProgress(`0/${ids.length}`);
    let ok = 0;
    let failed = 0;
    let inactivatedFallback = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        setBulkProgress(`${Math.min(i + chunk.length, ids.length)}/${ids.length}`);
        const res = await platformService.bulkCatalogProducts({
          action,
          ids: chunk,
          fallbackInactivate: true,
        });
        ok += res.ok || 0;
        failed += res.failed || 0;
        inactivatedFallback += res.inactivatedFallback || 0;
        if (res.dashboard) setDash(res.dashboard);
      }
      setSelectedIds(new Set());
      const parts = [`${ok} ok`];
      if (inactivatedFallback) parts.push(`${inactivatedFallback} inativado(s) (fallback)`);
      if (failed) parts.push(`${failed} erro(s)`);
      showToast(`Bulk ${label}: ${parts.join(' · ')} de ${ids.length}`, failed ? 'info' : 'success');
      if (selectedRule) await loadIssues(selectedRule);
      await refreshDash();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro na ação em massa', 'error');
    } finally {
      setBulkBusy(false);
      setBulkProgress('');
    }
  };

  /** Inativa TODOS os produtos ativos da categoria no Bling (em lotes — evita timeout). */
  const handleInactivateCategoryFilter = async () => {
    const catLabel = problemsCategory.trim();
    if (!catLabel) {
      showToast('Selecione uma categoria no filtro.', 'info');
      return;
    }

    setBulkBusy(true);
    setBulkProgress('contando…');
    try {
      const listed = await platformService.listCatalogIdsByCategory(catLabel);
      const ids = listed.ids || [];
      if (!ids.length) {
        showToast(`Nenhum produto ativo na categoria "${catLabel}".`, 'info');
        return;
      }
      const CHUNK = 100;
      const waves = Math.ceil(ids.length / CHUNK);
      if (!confirm(
        `INATIVAR a categoria "${catLabel}" no Bling?\n\n`
        + `${ids.length} produto(s) ativo(s) · ${waves} lote(s) de até ${CHUNK}.\n`
        + 'Inclui todos os ativos dessa categoria (não só esta lista). Histórico preservado.',
      )) return;

      let ok = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        setBulkProgress(`${Math.min(i + chunk.length, ids.length)}/${ids.length}`);
        const res = await platformService.bulkCatalogProducts({
          action: 'inactivate',
          ids: chunk,
          fallbackInactivate: true,
        });
        ok += res.ok || 0;
        failed += res.failed || 0;
        if (res.dashboard) setDash(res.dashboard);
      }
      showToast(
        `Categoria "${catLabel}": ${ok} inativado(s)${failed ? ` · ${failed} erro(s)` : ''} · ${ids.length} no total`,
        failed ? 'info' : 'success',
      );
      setSelectedIds(new Set());
      if (selectedRule) await loadIssues(selectedRule);
      await refreshDash();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao inativar categoria', 'error');
    } finally {
      setBulkBusy(false);
      setBulkProgress('');
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await platformService.startCatalogScan({ syncWoo: syncWooInclude });
      setScan(res.scan);
      if (res.alreadyRunning) {
        showToast('Já existe uma verificação em andamento.', 'info');
      } else {
        showToast(
          syncWooInclude
            ? 'Verificação iniciada — sync Bling + Woo e regras.'
            : 'Verificação iniciada — sync Bling (Woo: snapshot anterior, se houver).',
          'info',
        );
      }
    } catch (e) {
      setScanning(false);
      showToast(e instanceof Error ? e.message : 'Erro ao iniciar scan', 'error');
    }
  };

  const handleResolveCategories = async () => {
    setScanning(true);
    try {
      const res = await platformService.resolveCatalogCategoryNames();
      if (res.scan) setScan(res.scan);
      if (res.alreadyRunning) {
        showToast('Já existe uma verificação em andamento.', 'info');
      } else {
        showToast('Atualizando categorias no Bling — busca o cadastro atual dos produtos sem categoria real.', 'info');
      }
    } catch (e) {
      setScanning(false);
      showToast(e instanceof Error ? e.message : 'Erro ao atualizar categorias', 'error');
    }
  };

  const handleRefreshLiveEdit = async () => {
    if (!editIssue?.externalId) return;
    setRefreshingLive(true);
    setEditLiveStatus('loading');
    try {
      const res = await platformService.refreshCatalogProduct(editIssue.externalId);
      const p = (res.product || await platformService.getCatalogProduct(editIssue.externalId)) as {
        sku?: string; name?: string; price?: number; weight?: number;
        height?: number; width?: number; length?: number; ncm?: string;
        brand?: string; category?: string; description?: string; shortDescription?: string;
        seoTitle?: string; seoDescription?: string; focusKeyword?: string;
        rawJson?: string | Record<string, unknown>;
      };
      setEditForm((prev) => ({
        ...prev,
        sku: p.sku || prev.sku,
        name: p.name || prev.name,
        price: p.price != null ? String(p.price) : prev.price,
        weight: p.weight != null ? String(p.weight) : prev.weight,
        height: p.height != null ? String(p.height) : prev.height,
        width: p.width != null ? String(p.width) : prev.width,
        length: p.length != null ? String(p.length) : prev.length,
        ncm: p.ncm || prev.ncm,
        brand: p.brand || prev.brand,
        categoryId: categoryIdFromProduct(p) || prev.categoryId,
        shortDescription: p.shortDescription || prev.shortDescription,
        description: p.description || prev.description,
        seoTitle: p.seoTitle || prev.seoTitle,
        seoDescription: p.seoDescription || prev.seoDescription,
        focusKeyword: p.focusKeyword || prev.focusKeyword,
      }));
      await loadCatalogCategories();
      if (res.dashboard) setDash(res.dashboard);
      setEditLiveStatus('ok');
      const catName = String(p.category || '').trim();
      showToast(
        catName
          ? `Cadastro atual do Bling: categoria “${catName}”.`
          : 'Cadastro atualizado. No Bling este item ainda está sem categoria real.',
        catName ? 'success' : 'info',
      );
    } catch (e) {
      setEditLiveStatus('error');
      showToast(e instanceof Error ? e.message : 'Não foi possível buscar o Bling agora.', 'error');
    } finally {
      setRefreshingLive(false);
    }
  };

  const handleExport = async (ruleId?: string) => {
    setExporting(true);
    try {
      const { count, filename } = await platformService.downloadCatalogExport({
        ...(ruleId ? { ruleId } : {}),
        ...(problemsStock ? { stock: problemsStock } : {}),
        ...(problemsCategory.trim() ? { category: problemsCategory.trim() } : {}),
      });
      showToast(
        count > 0
          ? `CSV baixado: ${count} linha(s) · ${filename}`
          : 'CSV vazio — nenhum problema com esse filtro.',
        count > 0 ? 'success' : 'info',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao exportar CSV', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportFullInventory = async () => {
    setExportingInventory(true);
    try {
      const { count, filename, withProblems, withoutProblems } = await platformService.downloadFullCatalogInventory({
        status: 'A',
      });
      showToast(
        `Inventário: ${count} produto(s) · ${withProblems} com problema · ${withoutProblems} ok · ${filename}`,
        'success',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao exportar inventário', 'error');
    } finally {
      setExportingInventory(false);
    }
  };

  const handleExportOutOfScope = async () => {
    setExportingOutOfScope(true);
    try {
      const { count, filename } = await platformService.downloadOutOfScopeExport({
        search: outOfScopeSearch.trim() || undefined,
        category: outOfScopeCategory.trim() || undefined,
        stock: outOfScopeStock || undefined,
      });
      showToast(
        count > 0
          ? `CSV fora do escopo: ${count} produto(s) · ${filename}`
          : 'CSV vazio — nenhum produto fora do escopo.',
        count > 0 ? 'success' : 'info',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao exportar fora do escopo', 'error');
    } finally {
      setExportingOutOfScope(false);
    }
  };

  const handleExportWooIdClones = async () => {
    setExportingWooIdClones(true);
    try {
      const { count, filename } = await platformService.downloadWooIdClonesExport({
        search: wooIdClonesSearch.trim() || undefined,
        confidence: wooIdClonesConfidence || undefined,
        cloneStatus: 'active',
      });
      showToast(
        count > 0
          ? `CSV clones: ${count} linha(s) · ${filename}`
          : 'CSV vazio — nenhum clone com esse filtro.',
        count > 0 ? 'success' : 'info',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao exportar clones', 'error');
    } finally {
      setExportingWooIdClones(false);
    }
  };

  const toggleCloneSelect = (id: string) => {
    setCloneSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllClones = () => {
    const ids = (wooIdClones?.rows || []).map((r) => r.clone.id).filter(Boolean);
    setCloneSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  };

  const handleBulkInactivateClones = async () => {
    const ids = [...cloneSelectedIds];
    if (!ids.length) {
      showToast('Selecione ao menos um clone.', 'info');
      return;
    }
    if (ids.length > 100) {
      showToast('Máximo 100 por vez. Reduza a seleção.', 'error');
      return;
    }
    if (!confirm(
      `INATIVAR ${ids.length} clone(s) no Bling?\n\n`
      + 'Só o cadastro com SKU = ID do Woo será inativado.\n'
      + 'O SKU real (mesmo nome) permanece ativo.\n'
      + 'Depois, no Woo, troque o SKU do produto publicado para o código real.',
    )) return;

    setCloneBulkBusy(true);
    try {
      const res = await platformService.bulkCatalogProducts({
        action: 'inactivate',
        ids,
        fallbackInactivate: true,
      });
      const parts = [`${res.ok} ok`];
      if (res.failed) parts.push(`${res.failed} erro(s)`);
      showToast(`Clones inativados: ${parts.join(' · ')}`, res.failed ? 'info' : 'success');
      await loadWooIdClones();
      await refreshDash();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao inativar clones', 'error');
    } finally {
      setCloneBulkBusy(false);
    }
  };

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((iss) => {
      const hay = `${iss.sku} ${iss.name} ${iss.externalId} ${iss.message}`.toLowerCase();
      return hay.includes(q);
    });
  }, [issues, search]);

  const filteredComparator = useMemo(() => compareData?.rows || [], [compareData]);

  const DIFF_RULE: Record<string, string> = {
    stock: 'stock_divergent',
    photos_asymmetric: 'photos_asymmetric',
    photos: 'photos_divergent',
    price: 'price_divergent',
    weight: 'weight_divergent',
    dimensions: 'dimensions_divergent',
    name: 'name_divergent',
  };

  const diffLabel = (d: string) => {
    if (d === 'stock') return 'Estoque';
    if (d === 'photos_asymmetric') return 'Foto Woo';
    if (d === 'photos') return 'Fotos';
    if (d === 'price') return 'Preço';
    if (d === 'weight') return 'Peso';
    if (d === 'dimensions') return 'Dims';
    if (d === 'name') return 'Nome';
    return d;
  };

  const handleExportCompare = async () => {
    setExportingCompare(true);
    try {
      const { count, filename } = await platformService.downloadCatalogCompare({
        search: compareSearch.trim() || undefined,
        diff: compareDiff || 'all',
        stock: compareStock || undefined,
      });
      showToast(
        count > 0 ? `CSV comparador: ${count} · ${filename}` : 'CSV vazio.',
        count > 0 ? 'success' : 'info',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao exportar comparador', 'error');
    } finally {
      setExportingCompare(false);
    }
  };

  const handleStartPhotoImport = async (dryRun = false) => {
    if (!dryRun) {
      const ok = window.confirm(
        `Importar fotos do Woo para o Bling em ~${photoCandidates} produto(s) sem foto?\n\n`
        + 'O Bling baixa as URLs do Woo e grava como imagem armazenada no cadastro.\n'
        + 'IMPORTANTE: no Bling mantenha "Imagens armazenadas no Bling" (NÃO use "URL de imagens externas" — isso esconde as fotos já anexadas).\n'
        + 'Pode levar vários minutos (rate limit da API).',
      );
      if (!ok) return;
    }
    setPhotoImportBusy(true);
    try {
      const res = await platformService.startPhotoImport({ dryRun });
      setPhotoImportJob(res.job as typeof photoImportJob);
      if (res.alreadyRunning) {
        showToast('Já existe um import de fotos em andamento.', 'info');
      } else {
        showToast(dryRun ? 'Simulação iniciada.' : 'Importação de fotos iniciada.', 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao iniciar import', 'error');
    } finally {
      setPhotoImportBusy(false);
    }
  };

  const handleCancelPhotoImport = async () => {
    try {
      await platformService.cancelPhotoImport();
      showToast('Cancelamento solicitado.', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao cancelar', 'error');
    }
  };

  const handleStartImageScan = async () => {
    setImgOptBusy(true);
    try {
      const res = await platformService.startImageOptimizeScan({
        source: 'all',
        minPx: 2000,
        minBytes: Math.round(1.5 * 1024 * 1024),
      });
      setImgOptJob(res.job as typeof imgOptJob);
      if (res.alreadyRunning) {
        showToast('Já existe um job de imagens em andamento.', 'info');
      } else {
        showToast('Varredura de imagens iniciada — pode levar vários minutos.', 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao iniciar varredura', 'error');
    } finally {
      setImgOptBusy(false);
    }
  };

  const handleStartImageOptimize = async (dryRun: boolean, onlySelected: boolean) => {
    const blingIds = onlySelected
      ? [...imgOptSelected]
      : imgOptCandidates.filter((c) => c.source === 'bling').map((c) => String(c.blingId || c.externalId));
    if (!blingIds.length) {
      showToast(onlySelected ? 'Selecione produtos Bling na lista.' : 'Nenhum candidato Bling na lista. Rode a varredura.', 'info');
      return;
    }
    if (!dryRun) {
      const ok = window.confirm(
        `Otimizar ${blingIds.length} produto(s) Bling?\n\n`
        + 'Cada foto vira WebP ≤1000px. As fotos ANTIGAS são apagadas no Bling e só ficam as otimizadas (sem duplicar).\n'
        + 'Produtos que já estão leves serão pulados.\n'
        + 'Mantenha no Bling “Imagens armazenadas no Bling”.',
      );
      if (!ok) return;
    }
    setImgOptBusy(true);
    try {
      const res = await platformService.startImageOptimize({ blingIds, dryRun });
      if (res.error) throw new Error(res.error);
      setImgOptJob(res.job as typeof imgOptJob);
      if (res.alreadyRunning) {
        showToast('Já existe um job de imagens em andamento.', 'info');
      } else {
        showToast(dryRun ? 'Simulação iniciada.' : 'Otimização iniciada.', 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao iniciar otimização', 'error');
    } finally {
      setImgOptBusy(false);
    }
  };

  const handleCancelImageOptimize = async () => {
    try {
      await platformService.cancelImageOptimize();
      showToast('Cancelamento solicitado.', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao cancelar', 'error');
    }
  };

  const fmtBytes = (n: number) => {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const fmtDims = (p?: { height?: number | null; width?: number | null; length?: number | null } | null) => {
    if (!p || p.height == null || p.width == null || p.length == null) return '—';
    return `${p.height}×${p.width}×${p.length}`;
  };

  const ind = dash?.indicators || {};
  const cards: { key: string; label: string; hint: string; tone?: string; ruleId?: string }[] = [
    { key: 'blingTotal', label: 'Total Bling', hint: 'ERP (fonte oficial)', tone: 'neutral' },
    { key: 'withErrors', label: 'Com erros', hint: 'Só críticos: SKU / peso inválido / preço zerado', tone: 'danger' },
    { key: 'reviewed', label: 'Revisados', hint: 'Clique para ver a lista', tone: 'ok' },
    { key: 'pending', label: 'Pendentes', hint: 'Aguardando revisão', tone: 'warn' },
    { key: 'goianiaOpen', label: 'Fila Goiânia', hint: 'Conferência física pendente/respondida', tone: 'warn' },
    { key: 'goianiaOverdue', label: 'Goiânia atrasados', hint: 'Prazo vencido na fila', tone: 'danger' },
    { key: 'skuMissing', label: 'Sem SKU', hint: 'Crítico — clique para ver lista', tone: 'danger', ruleId: 'sku_missing' },
    { key: 'skuDuplicate', label: 'SKU duplicado', hint: 'Crítico', tone: 'danger', ruleId: 'sku_duplicate' },
    { key: 'weightInvalid', label: 'Peso inválido', hint: 'Crítico', tone: 'danger', ruleId: 'weight_invalid' },
    { key: 'weightMissing', label: 'Sem peso', hint: 'Médio', tone: 'warn', ruleId: 'weight_missing' },
    { key: 'photosMissing', label: 'Sem fotos', hint: 'Médio', tone: 'warn', ruleId: 'photos_missing' },
    { key: 'ncmMissing', label: 'Sem NCM', hint: 'Médio', tone: 'warn', ruleId: 'ncm_missing' },
    { key: 'categoryMissing', label: 'Sem categoria', hint: 'Pode ser categoria padrão no Bling', tone: 'warn', ruleId: 'category_missing' },
    { key: 'descriptionMissing', label: 'Sem descrição', hint: 'Médio — curta/complementar', tone: 'warn', ruleId: 'description_missing' },
    { key: 'priceZero', label: 'Preço zerado', hint: 'Crítico', tone: 'danger', ruleId: 'price_zero' },
    { key: 'dimensionsMissing', label: 'Sem dimensões', hint: 'Médio', tone: 'warn', ruleId: 'dimensions_missing' },
    { key: 'stockDivergent', label: 'Estoque diverge', hint: 'Bling × Woo', tone: 'warn', ruleId: 'stock_divergent' },
    { key: 'photosAsymmetric', label: 'Foto só no Woo', hint: 'Sem foto no Bling', tone: 'warn', ruleId: 'photos_asymmetric' },
  ];

  const CROSS_RULES = useMemo(
    () => new Set([
      'orphan_bling', 'orphan_woo', 'price_divergent', 'name_divergent', 'seo_missing',
      'stock_divergent', 'photos_asymmetric', 'photos_divergent', 'weight_divergent', 'dimensions_divergent',
    ]),
    [],
  );

  const visibleRules = useMemo(
    () => (dash?.rules || []).filter((r) => !CROSS_RULES.has(r.id) || (dash?.wooCount || 0) > 0),
    [dash, CROSS_RULES],
  );

  const openRule = (ruleId: string) => {
    setSelectedRule(ruleId);
    setSearch('');
    setTab('problems');
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando Qualidade do Catálogo…</div>;
  }

  const selectedRuleMeta = (dash?.rules || []).find((r) => r.id === selectedRule);

  return (
    <div className="w-full max-w-none space-y-3 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold text-bs-text tracking-tight">
            {isCatalogManager ? 'Qualidade do Catálogo' : 'Fila Goiânia'}
          </h2>
          <p className="text-xs text-bs-muted mt-0.5 truncate hidden sm:block">
            {isCatalogManager
              ? 'Inspetor do catálogo Bling · conferência física em Goiânia'
              : 'Responda pedidos com foto, peso e medidas'}
          </p>
        </div>
        {isCatalogAdmin && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
            <label className="flex items-center gap-2 text-xs text-bs-muted cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                className="rounded border-bs-border"
                checked={syncWooInclude}
                onChange={(e) => setSyncWooInclude(e.target.checked)}
                disabled={scanning}
              />
              Incluir WooCommerce
            </label>
            <button
              type="button"
              onClick={() => void handleResolveCategories()}
              disabled={scanning}
              className="bs-btn-secondary px-3 py-2 text-sm shrink-0 disabled:opacity-60"
              title="Busca nomes no Bling e atualiza o cadastro dos produtos ainda na categoria padrão. Não derruba o WhatsApp."
            >
              {scanning && String(scan?.id || '').includes('_cats') ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-2" />
                  Categorias…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-tags mr-2" />
                  Atualizar categorias
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="bs-btn px-3 py-2 text-sm shrink-0 disabled:opacity-60"
            >
              {scanning ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-2" />
                  Verificando…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-magnifying-glass-chart mr-2" />
                  Verificar Catálogo
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {isCatalogAdmin && (scanning || scan) && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${
          scan?.status === 'failed'
            ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300'
            : 'border-bs-border bg-bs-elevated text-bs-muted'
        }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-semibold text-bs-text">
              {scan?.status === 'done' ? 'Última análise' : scan?.status === 'failed' ? 'Falhou' : 'Em andamento'}
            </span>
            <span className="truncate">{scan?.message || '—'}</span>
            {scan?.status === 'done' && (
              <span className="text-bs-subtle whitespace-nowrap">
                {scan.blingCount} Bling · {scan.issueCount} problemas · {formatDuration(scan.durationMs)}
              </span>
            )}
          </div>
        </div>
      )}

      {visibleTabs.length > 1 && (
      <div className="flex flex-wrap gap-0.5 border-b border-bs-border pb-px">
        {visibleTabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1.5 text-sm rounded-t-lg transition-colors flex items-center gap-1.5 ${
                active
                  ? 'text-bs-accent font-semibold border-b-2 border-bs-accent -mb-px'
                  : 'text-bs-muted hover:text-bs-text'
              }`}
            >
              <i className={`fa-solid ${t.icon} text-[11px]`} />
              {t.label}
              {t.id === 'ai-drafts' && aiDraftsPending > 0 && (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 tabular-nums">
                  {aiDraftsPending}
                </span>
              )}
            </button>
          );
        })}
      </div>
      )}

      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="bs-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-semibold text-bs-text">Catálogo revisado</p>
                <p className="text-xs text-bs-muted">Progresso humano após o scan automático</p>
              </div>
              <p className="text-2xl font-bold text-bs-text tabular-nums">{dash?.progressPct ?? 0}%</p>
            </div>
            <div className="h-3 rounded-full bg-bs-canvas border border-bs-border overflow-hidden">
              <div
                className="h-full bg-bs-accent rounded-full transition-all"
                style={{ width: `${Math.min(100, dash?.progressPct || 0)}%` }}
              />
            </div>
            <p className="text-xs text-bs-subtle mt-2">
              {dash?.reviewed || 0} / {dash?.blingCount || 0} produtos revisados
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {cards.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={!c.ruleId && c.key !== 'goianiaOpen' && c.key !== 'goianiaOverdue' && c.key !== 'reviewed'}
                onClick={() => {
                  if (c.key === 'goianiaOpen') {
                    setTab('goiania');
                    setCheckFilter('open');
                  } else if (c.key === 'goianiaOverdue') {
                    setTab('goiania');
                    setCheckFilter('overdue');
                  } else if (c.key === 'reviewed') {
                    setTab('reviewed');
                    setReviewedSearch('');
                  } else if (c.ruleId) openRule(c.ruleId);
                }}
                className={`rounded-xl border p-4 text-left transition-colors ${toneClass(c.tone)} ${
                  c.ruleId || c.key === 'goianiaOpen' || c.key === 'goianiaOverdue' || c.key === 'reviewed'
                    ? 'hover:border-bs-accent/50 cursor-pointer'
                    : 'cursor-default'
                }`}
              >
                <p className="text-[11px] uppercase tracking-wide text-bs-subtle font-semibold">{c.label}</p>
                <p className="text-2xl font-bold text-bs-text mt-1 tabular-nums">{ind[c.key] ?? 0}</p>
                <p className="text-[11px] text-bs-muted mt-1">{c.hint}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-bs-subtle">
            Dica: clique em um card de problema (ex.: Sem SKU) para abrir a lista com nome e SKU de cada produto.
          </p>
        </div>
      )}

      {tab === 'problems' && (
        <div className="space-y-2">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="lg:w-52 xl:w-56 shrink-0 space-y-0.5 max-h-[min(70vh,calc(100vh-12rem))] overflow-y-auto custom-scrollbar pr-1">
              <p className="text-[10px] font-bold uppercase text-bs-subtle px-1 mb-1">Tipos de problema</p>
              {(visibleRules).map((p) => {
                const active = selectedRule === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedRule(p.id);
                      setSearch('');
                      setProblemsCategory('');
                      setSelectedIds(new Set());
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-[13px] transition-colors flex items-center justify-between gap-2 ${
                      active
                        ? 'bg-bs-accent/15 text-bs-accent font-semibold border border-bs-accent/30'
                        : 'text-bs-muted hover:bg-bs-hover hover:text-bs-text border border-transparent'
                    }`}
                  >
                    <span className="truncate min-w-0">{p.label}</span>
                    <span className="text-[11px] tabular-nums opacity-80 shrink-0">{p.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-bs-text truncate">
                    {selectedRuleMeta?.label || 'Produtos'}
                    <span className="ml-2 text-xs font-normal text-bs-muted tabular-nums">
                      {problemsCategory || problemsStock
                        ? `${issuesTotal} no filtro · ${filteredIssues.length} na tela`
                        : `${selectedRuleMeta?.count ?? 0} · até ${filteredIssues.length}`}
                      {selectedIds.size > 0 ? ` · ${selectedIds.size} sel.` : ''}
                    </span>
                  </h3>
                </div>
                <div className="flex gap-2 sm:items-center shrink-0 flex-wrap justify-end">
                  <input
                    className="bs-input text-sm py-1.5 sm:w-44"
                    placeholder="Buscar SKU, nome ou ID…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    className="bs-input text-sm py-1.5 min-w-[160px] max-w-[220px]"
                    value={problemsCategory}
                    onChange={(e) => {
                      setProblemsCategory(e.target.value);
                      setSelectedIds(new Set());
                    }}
                    title="Filtrar por categoria do produto no Bling"
                  >
                    <option value="">Categoria: todas</option>
                    {issuesByCategory.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.count})
                      </option>
                    ))}
                  </select>
                  <select
                    className="bs-input text-sm py-1.5 min-w-[140px]"
                    value={problemsStock}
                    onChange={(e) => {
                      setProblemsStock(e.target.value as '' | 'in_stock' | 'out_of_stock' | 'unknown');
                      setSelectedIds(new Set());
                    }}
                    title="Filtrar por estoque"
                  >
                    <option value="">Estoque: todos</option>
                    <option value="in_stock">Com estoque (&gt; 0)</option>
                    <option value="out_of_stock">Sem estoque (0)</option>
                    <option value="unknown">Estoque desconhecido</option>
                  </select>
                  <button
                    type="button"
                    className="bs-btn-secondary text-xs px-2.5 py-1.5 flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                    disabled={exporting || !(issuesTotal || selectedRuleMeta?.count)}
                    onClick={() => handleExport(selectedRule)}
                    title="Exporta desta lista (respeita filtros de categoria e estoque)"
                  >
                    <i className={`fa-solid ${exporting ? 'fa-spinner animate-spin' : 'fa-file-csv'}`} />
                    CSV
                  </button>
                </div>
              </div>

              {issuesByCategory.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {issuesByCategory.slice(0, 16).map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={`text-[11px] px-2 py-1 rounded-md border bg-bs-elevated ${
                        problemsCategory === c.name
                          ? 'border-bs-accent/50 text-bs-text'
                          : 'border-bs-border text-bs-muted hover:border-bs-accent/40 hover:text-bs-text'
                      }`}
                      onClick={() => {
                        setProblemsCategory(problemsCategory === c.name ? '' : c.name);
                        setSelectedIds(new Set());
                      }}
                      title="Filtrar por esta categoria de produto"
                    >
                      {c.name} · {c.count}
                    </button>
                  ))}
                </div>
              )}

              {selectedRule === 'category_missing' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-bs-muted space-y-1">
                  <p>
                    Esta lista usa o <strong className="text-bs-text">snapshot local</strong>.
                    No Bling o produto pode já ter categoria (ex.: Anéis) e aqui ainda aparecer “sem categoria”.
                  </p>
                  <p>
                    Use <strong className="text-bs-text">Atualizar categorias</strong> no topo para buscar o cadastro atual,
                    ou <strong className="text-bs-text">Corrigir</strong> num item — ao abrir já puxamos o Bling ao vivo.
                    Não inative em massa só por esta lista.
                  </p>
                </div>
              )}

              {canInactivate && selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bs-border bg-bs-elevated px-2.5 py-1.5">
                  <span className="text-xs text-bs-text font-medium">
                    {selectedIds.size} selecionado(s)
                    {bulkBusy && bulkProgress ? ` · ${bulkProgress}` : ''}
                  </span>
                  {canFix && (
                    <button
                      type="button"
                      className="bs-btn text-xs px-2.5 py-1"
                      disabled={bulkBusy || aiBulkJob?.status === 'running'}
                      onClick={() => void handleBulkAiSuggest()}
                      title="Seleciona todos e gera rascunhos em ondas de 15 — entram na lista de aprovação automaticamente"
                    >
                      {aiBulkJob?.status === 'running' ? 'Gerando IA…' : 'Sugerir IA em massa'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="bs-btn-secondary text-xs px-2.5 py-1"
                    disabled={bulkBusy}
                    onClick={() => void handleBulk('inactivate')}
                  >
                    {bulkBusy ? `Inativando… ${bulkProgress}` : 'Inativar'}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      className="bs-btn-danger text-xs px-2.5 py-1"
                      disabled={bulkBusy}
                      onClick={() => void handleBulk('delete')}
                    >
                      Excluir
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs text-bs-muted hover:text-bs-text px-2"
                    disabled={bulkBusy}
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Limpar
                  </button>
                </div>
              )}

              {canInactivate && problemsCategory && problemsCategory !== '(sem categoria)' && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
                  <span className="text-xs text-bs-muted">
                    Categoria <strong className="text-bs-text">{problemsCategory}</strong>
                    {' '}· inativa <em>todos</em> os ativos dessa categoria no Bling (não só esta lista)
                    {bulkBusy && bulkProgress ? ` · ${bulkProgress}` : ''}
                  </span>
                  <button
                    type="button"
                    className="bs-btn-secondary text-xs px-2.5 py-1"
                    disabled={bulkBusy}
                    onClick={() => void handleInactivateCategoryFilter()}
                  >
                    {bulkBusy ? `Inativando… ${bulkProgress}` : 'Inativar categoria no Bling'}
                  </button>
                </div>
              )}

              <IssuesTable
                issues={filteredIssues}
                loading={issuesLoading}
                emptyText="Nenhum produto neste filtro (ou rode Verificar Catálogo)."
                onEdit={canFix ? openEdit : undefined}
                onRequestGoiania={canFix ? openRequestGoiania : undefined}
                onOpenGoianiaQueue={canFix ? openGoianiaQueueFromIssue : undefined}
                onDelete={canDelete ? handleDelete : undefined}
                onInactivate={canInactivate ? handleInactivate : undefined}
                deletingId={deletingId}
                selectable={canInactivate}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAllFiltered}
                currentUserId={currentUser?.id}
                showCategory
              />
              {!issuesLoading && issues.length >= 1000 && (
                <p className="text-xs text-bs-subtle">
                  Lista limitada a 1000 linhas nesta página. Use a busca ou filtre por categoria crítica primeiro.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'ai-drafts' && isCatalogAdmin && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-bs-text">Rascunhos de correção (IA)</h3>
              <p className="text-xs text-bs-muted max-w-2xl mt-1">
                Sugestões no padrão Rank Math + Mercado Livre (título ~60, meta ~155, descrição com atributos).
                Confira e só então <strong className="text-bs-text">Aplicar no Bling</strong>.
                Textos vão ao Bling; o Bling é quem sincroniza com o Woo (evita duplicata).
                Título/meta/focus keyword ficam no rascunho/snapshot para conferência.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {aiBulkJob?.status === 'running' ? (
                <button
                  type="button"
                  className="bs-btn-secondary text-sm"
                  onClick={() => void platformService.cancelBulkCatalogAiSuggest().then(() => showToast('Cancelamento solicitado.', 'info'))}
                >
                  Cancelar geração
                </button>
              ) : (
                <button type="button" className="bs-btn-secondary text-sm" disabled={aiDraftsLoading} onClick={() => void loadAiDrafts()}>
                  Atualizar
                </button>
              )}
              <button
                type="button"
                className="bs-btn text-sm disabled:opacity-50"
                disabled={aiDraftBusy || aiDraftSelected.size === 0}
                onClick={() => void handleApplyAiDraftsBulk()}
              >
                Aprovar em massa ({aiDraftSelected.size})
              </button>
              <button
                type="button"
                className="bs-btn-secondary text-sm disabled:opacity-50"
                disabled={aiDraftBusy || aiDraftSelected.size === 0}
                onClick={() => void handleDiscardAiDraftsBulk(false)}
              >
                Descartar selecionados
              </button>
              <button
                type="button"
                className="text-sm text-bs-muted underline disabled:opacity-50 px-1"
                disabled={aiDraftBusy || !aiDrafts.length}
                onClick={() => void handleDiscardAiDraftsBulk(true)}
              >
                Limpar lista
              </button>
            </div>
          </div>

          {aiBulkJob && (
            <div className="text-xs text-bs-muted rounded-lg border border-bs-border bg-bs-elevated px-3 py-2 space-y-1">
              <div>
                <span className="font-medium text-bs-text">
                  {aiBulkJob.status === 'running' ? 'Gerando…' : aiBulkJob.status}
                </span>
                {' · '}
                {aiBulkJob.done}/{aiBulkJob.total}
                {aiBulkJob.wavesTotal && aiBulkJob.wavesTotal > 1 ? (
                  <span className="text-bs-subtle">
                    {' '}· onda {aiBulkJob.wave || 1}/{aiBulkJob.wavesTotal}
                    {aiBulkJob.waveSize ? ` (até ${aiBulkJob.waveSize})` : ''}
                  </span>
                ) : null}
                {typeof aiBulkJob.ok === 'number' ? (
                  <span className="text-bs-subtle"> · {aiBulkJob.ok} na aprovação</span>
                ) : null}
              </div>
              {aiBulkJob.message ? <div className="text-bs-subtle">{aiBulkJob.message}</div> : null}
            </div>
          )}

          {aiDraftsLoading ? (
            <p className="text-sm text-bs-muted animate-pulse py-6">Carregando rascunhos…</p>
          ) : !aiDrafts.length ? (
            <div className="rounded-lg border border-dashed border-bs-border p-8 text-center text-sm text-bs-muted">
              Nenhum rascunho pendente.
              <span className="block text-xs mt-1 text-bs-subtle">
                Em Problemas, selecione produtos e use “Sugerir IA em massa”, ou “Sugerir com ChatGPT” no Corrigir.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs items-center">
                <button
                  type="button"
                  className="text-bs-accent underline"
                  onClick={() => setAiDraftSelected(new Set(aiDrafts.map((d) => d.id)))}
                >
                  Selecionar todos
                </button>
                <button type="button" className="text-bs-muted underline" onClick={() => setAiDraftSelected(new Set())}>
                  Desmarcar
                </button>
                <span className="text-bs-subtle">{aiDrafts.length} pendente(s) · somem de Problemas até aprovar ou descartar</span>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-lg border border-bs-border">
                <table className="w-full text-xs">
                  <thead className="bg-bs-elevated sticky top-0">
                    <tr className="text-left text-bs-muted">
                      <th className="p-2 w-8" />
                      <th className="p-2">SKU</th>
                      <th className="p-2">Marca</th>
                      <th className="p-2">NCM</th>
                      <th className="p-2">Peso</th>
                      <th className="p-2">A×L×P</th>
                      <th className="p-2">Nota IA</th>
                      <th className="p-2 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiDrafts.map((d) => {
                      const ed = draftEditValue(d.id);
                      const checked = aiDraftSelected.has(d.id);
                      const hasDesc = true; // sempre mostra descrições no rascunho
                      return (
                        <React.Fragment key={d.id}>
                          <tr className="border-t border-bs-border align-top">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setAiDraftSelected((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d.id)) next.delete(d.id);
                                    else next.add(d.id);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="p-2">
                              <div className="font-mono text-bs-text">{d.sku || '—'}</div>
                              <div className="text-[10px] text-bs-subtle truncate max-w-[140px]" title={d.name}>{d.name}</div>
                            </td>
                            <td className="p-2">
                              <input
                                className="bs-input text-xs py-1 w-[120px]"
                                value={ed.brand}
                                onChange={(e) => setDraftField(d.id, 'brand', e.target.value)}
                                title="Marca padrão da loja"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                className="bs-input text-xs py-1 w-[88px]"
                                value={ed.ncm}
                                onChange={(e) => setDraftField(d.id, 'ncm', e.target.value)}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                className="bs-input text-xs py-1 w-[72px]"
                                value={ed.weight}
                                onChange={(e) => setDraftField(d.id, 'weight', e.target.value)}
                              />
                            </td>
                            <td className="p-2">
                              <div className="flex gap-1">
                                <input className="bs-input text-xs py-1 w-[52px]" value={ed.height} onChange={(e) => setDraftField(d.id, 'height', e.target.value)} title="Altura" />
                                <input className="bs-input text-xs py-1 w-[52px]" value={ed.width} onChange={(e) => setDraftField(d.id, 'width', e.target.value)} title="Largura" />
                                <input className="bs-input text-xs py-1 w-[52px]" value={ed.length} onChange={(e) => setDraftField(d.id, 'length', e.target.value)} title="Profundidade" />
                              </div>
                            </td>
                            <td className="p-2 text-bs-muted max-w-[160px]">
                              <span className="line-clamp-2" title={d.rationale || d.suggested?.rationale || ''}>
                                {d.rationale || d.suggested?.rationale || '—'}
                              </span>
                              {d.provider && (
                                <span className="block text-[10px] text-bs-subtle mt-0.5">{d.provider}</span>
                              )}
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                className="bs-btn text-[11px] px-2 py-1 mr-1 disabled:opacity-50"
                                disabled={aiDraftBusy}
                                onClick={() => void handleApplyAiDraft(d)}
                              >
                                Aplicar
                              </button>
                              <button
                                type="button"
                                className="text-[11px] text-bs-muted underline disabled:opacity-50"
                                disabled={aiDraftBusy}
                                onClick={() => void handleDiscardAiDraft(d)}
                              >
                                Descartar
                              </button>
                            </td>
                          </tr>
                          {hasDesc && (
                            <tr className="border-t border-bs-border/60 bg-bs-elevated/40">
                              <td />
                              <td colSpan={7} className="p-2 space-y-2">
                                <label className="block text-[10px] text-bs-muted">
                                  Palavra-chave de foco (Rank Math)
                                  <input
                                    className="bs-input mt-1 text-xs w-full"
                                    value={ed.focusKeyword}
                                    onChange={(e) => setDraftField(d.id, 'focusKeyword', e.target.value)}
                                    placeholder="ex.: aromatizador de ambientes alecrim"
                                  />
                                </label>
                                <label className="block text-[10px] text-bs-muted">
                                  Título SEO / ML ({(ed.seoTitle || '').length}/60)
                                  <input
                                    className="bs-input mt-1 text-xs w-full"
                                    value={ed.seoTitle}
                                    maxLength={60}
                                    onChange={(e) => setDraftField(d.id, 'seoTitle', e.target.value)}
                                    placeholder="50–60 caracteres · palavra-chave no início"
                                  />
                                </label>
                                <label className="block text-[10px] text-bs-muted">
                                  Meta description Rank Math ({(ed.seoDescription || '').length}/160)
                                  <textarea
                                    className="bs-input mt-1 text-xs min-h-[52px] w-full"
                                    value={ed.seoDescription}
                                    maxLength={160}
                                    onChange={(e) => setDraftField(d.id, 'seoDescription', e.target.value)}
                                  />
                                </label>
                                <label className="block text-[10px] text-bs-muted">
                                  Descrição curta / Bling ({(ed.shortDescription || '').length}/160)
                                  <textarea
                                    className="bs-input mt-1 text-xs min-h-[52px] w-full"
                                    value={ed.shortDescription}
                                    maxLength={200}
                                    onChange={(e) => setDraftField(d.id, 'shortDescription', e.target.value)}
                                  />
                                </label>
                                <label className="block text-[10px] text-bs-muted">
                                  Descrição completa (ML / complementar)
                                  <textarea
                                    className="bs-input mt-1 text-xs min-h-[72px] w-full"
                                    value={ed.description}
                                    onChange={(e) => setDraftField(d.id, 'description', e.target.value)}
                                  />
                                </label>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'reviewed' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <div>
              <h3 className="text-sm font-semibold text-bs-text">Produtos já revisados</h3>
              <p className="text-xs text-bs-muted">
                {reviewedTotal} no total · mostrando {reviewedProducts.length}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                className="bs-input text-sm py-1.5 sm:w-56"
                placeholder="Buscar SKU, nome ou ID…"
                value={reviewedSearch}
                onChange={(e) => setReviewedSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadReviewed();
                }}
              />
              <button
                type="button"
                className="bs-btn-secondary text-xs px-2.5 py-1.5"
                onClick={() => void loadReviewed()}
              >
                Buscar
              </button>
            </div>
          </div>

          {reviewedLoading ? (
            <p className="text-sm text-bs-muted animate-pulse py-6">Carregando revisados…</p>
          ) : !reviewedProducts.length ? (
            <div className="rounded-lg border border-dashed border-bs-border p-8 text-center text-sm text-bs-muted">
              Nenhum produto marcado como revisado ainda.
              <span className="block text-xs mt-1 text-bs-subtle">
                Ao salvar uma correção no Bling (ou aplicar resposta de Goiânia), o produto entra aqui.
              </span>
            </div>
          ) : (
            <div className="bs-table-wrap overflow-x-auto">
              <table className="bs-table text-[13px] [&_th]:!px-2.5 [&_th]:!py-2 [&_td]:!px-2.5 [&_td]:!py-1.5">
                <thead className="bs-table-head">
                  <tr>
                    <th>SKU</th>
                    <th>Nome</th>
                    <th>Peso</th>
                    <th>Dims</th>
                    <th>NCM</th>
                    <th className="text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewedProducts.map((p) => (
                    <tr key={p.externalId} className="bs-table-row">
                      <td className="font-mono text-xs whitespace-nowrap">{p.sku || '—'}</td>
                      <td className="text-bs-text max-w-[280px]">
                        <span className="block truncate" title={p.name}>{p.name || '—'}</span>
                        <span className="text-[10px] text-bs-subtle">ID {p.externalId}</span>
                      </td>
                      <td className="text-bs-muted whitespace-nowrap">
                        {p.weight != null ? `${p.weight} kg` : '—'}
                      </td>
                      <td className="text-bs-muted whitespace-nowrap text-xs">
                        {p.height != null
                          ? `${p.height}×${p.width ?? '?'}×${p.length ?? '?'}`
                          : '—'}
                      </td>
                      <td className="font-mono text-xs text-bs-muted">{p.ncm || '—'}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="bs-btn text-[11px] px-2 py-1"
                          onClick={() => void openReviewedProduct(p.externalId, p.sku, p.name)}
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'comparator' && (
        <div className="space-y-3">
          {!(dash?.wooCount) && !compareLoading ? (
            <div className="bs-card p-6 space-y-3 text-sm text-bs-muted">
              <p className="font-semibold text-bs-text">Comparador Bling × Woo</p>
              <p>
                Ainda não há snapshot Woo. Marque <strong className="text-bs-text">Incluir WooCommerce</strong> e rode
                Verificar Catálogo (credenciais REST em Integrações).
              </p>
              <button
                type="button"
                className="bs-btn text-sm mt-2"
                disabled={scanning}
                onClick={() => {
                  setSyncWooInclude(true);
                  void handleScan();
                }}
              >
                Verificar com Woo
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Pareados (SKU)</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{compareData?.matched ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Com divergência</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{compareData?.withDiffs ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Só no Bling</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{compareData?.blingOnly ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Só no Woo</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{compareData?.wooOnly ?? '—'}</p>
                </div>
              </div>

              {(photoCandidates > 0 || photoImportJob) && (
                <div className="bs-card p-4 space-y-3 border border-bs-accent/20 bg-bs-accent/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-bs-text text-sm">Importar fotos Woo → Bling</p>
                      <p className="text-xs text-bs-muted mt-1 max-w-xl">
                        {photoCandidates} produto(s) sem foto no Bling e com foto no Woo.
                        O Bling baixa as URLs e grava no cadastro (~{Math.ceil(photoCandidates * 0.5 / 60)} min estimado).
                        {' '}Mantenha no Bling a opção <strong className="text-bs-text">Imagens armazenadas no Bling</strong>
                        {' '}(não “URL externas”).
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {photoImportJob?.status === 'running' ? (
                        <button
                          type="button"
                          className="bs-btn-secondary text-sm"
                          onClick={() => void handleCancelPhotoImport()}
                        >
                          Cancelar
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="bs-btn-secondary text-sm disabled:opacity-50"
                            disabled={photoImportBusy || !photoCandidates}
                            onClick={() => void handleStartPhotoImport(true)}
                          >
                            Simular
                          </button>
                          <button
                            type="button"
                            className="bs-btn text-sm disabled:opacity-50"
                            disabled={photoImportBusy || !photoCandidates}
                            onClick={() => void handleStartPhotoImport(false)}
                          >
                            {photoImportBusy ? 'Iniciando…' : `Importar ${photoCandidates}`}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {photoImportJob && (
                    <div className="text-xs text-bs-muted space-y-1">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-medium text-bs-text">
                          {photoImportJob.status === 'running' ? 'Em andamento' : photoImportJob.status === 'done' ? 'Concluído' : photoImportJob.status === 'cancelled' ? 'Cancelado' : photoImportJob.status}
                          {photoImportJob.dryRun ? ' (simulação)' : ''}
                        </span>
                        <span className="tabular-nums">
                          {photoImportJob.done}/{photoImportJob.total}
                          {' · '}ok {photoImportJob.ok}
                          {' · '}falhas {photoImportJob.failed}
                        </span>
                        {photoImportJob.currentSku && (
                          <span>SKU {photoImportJob.currentSku}</span>
                        )}
                      </div>
                      {photoImportJob.message && <p>{photoImportJob.message}</p>}
                      {photoImportJob.status === 'running' && photoImportJob.total > 0 && (
                        <div className="h-1.5 rounded-full bg-bs-elevated overflow-hidden">
                          <div
                            className="h-full bg-bs-accent transition-all"
                            style={{ width: `${Math.min(100, Math.round((photoImportJob.done / photoImportJob.total) * 100))}%` }}
                          />
                        </div>
                      )}
                      {!!photoImportJob.errors?.length && photoImportJob.status !== 'running' && (
                        <p className="text-amber-700 dark:text-amber-400">
                          Ex.: {photoImportJob.errors.slice(0, 3).map((e) => `${e.sku}: ${e.error}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isCatalogAdmin && (
                <div className="bs-card p-4 space-y-3 border border-amber-500/25 bg-amber-500/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-bs-text text-sm">Imagens pesadas (Bling / Woo)</p>
                      <p className="text-xs text-bs-muted mt-1 max-w-2xl">
                        Varre fotos ≥2000px / ≥1,5&nbsp;MB <em>e</em> produtos com ≥3 fotos (duplicatas).
                        Otimização (só Bling): WebP ≤1000px, remove duplicatas visuais,
                        <strong className="text-bs-text"> apaga as antigas</strong> e grava só as únicas.
                        Só pula se já estiver leve <em>e</em> com poucas fotos.
                        {imgOptTotal > 0 && (
                          <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">
                            {imgOptTotal} produto(s) flagado(s).
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {imgOptJob?.status === 'running' ? (
                        <button
                          type="button"
                          className="bs-btn-secondary text-sm"
                          onClick={() => void handleCancelImageOptimize()}
                        >
                          Cancelar
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="bs-btn text-sm disabled:opacity-50"
                            disabled={imgOptBusy}
                            onClick={() => void handleStartImageScan()}
                          >
                            {imgOptBusy ? 'Iniciando…' : 'Varrer imagens'}
                          </button>
                          <button
                            type="button"
                            className="bs-btn-secondary text-sm disabled:opacity-50"
                            disabled={imgOptBusy || !imgOptCandidates.some((c) => c.source === 'bling')}
                            onClick={() => void handleStartImageOptimize(true, false)}
                          >
                            Simular otimizar
                          </button>
                          <button
                            type="button"
                            className="bs-btn-secondary text-sm disabled:opacity-50"
                            disabled={imgOptBusy || imgOptSelected.size === 0}
                            onClick={() => void handleStartImageOptimize(false, true)}
                          >
                            Otimizar selecionados
                          </button>
                          <button
                            type="button"
                            className="bs-btn text-sm disabled:opacity-50"
                            disabled={imgOptBusy || !imgOptCandidates.some((c) => c.source === 'bling')}
                            onClick={() => void handleStartImageOptimize(false, false)}
                          >
                            Otimizar todos (Bling)
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {imgOptJob && (
                    <div className="text-xs text-bs-muted space-y-1">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-medium text-bs-text">
                          {imgOptJob.kind === 'scan' ? 'Varredura' : 'Otimização'}
                          {' · '}
                          {imgOptJob.status === 'running' ? 'em andamento' : imgOptJob.status === 'done' ? 'concluído' : imgOptJob.status}
                          {imgOptJob.dryRun ? ' (simulação)' : ''}
                        </span>
                        <span className="tabular-nums">
                          {imgOptJob.done}/{imgOptJob.total}
                          {' · '}ok {imgOptJob.ok}
                          {' · '}pulados {imgOptJob.skipped ?? 0}
                          {' · '}falhas {imgOptJob.failed}
                          {typeof imgOptJob.flaggedProducts === 'number' && (
                            <> · flagados {imgOptJob.flaggedProducts}</>
                          )}
                        </span>
                        {imgOptJob.currentSku && <span>SKU {imgOptJob.currentSku}</span>}
                      </div>
                      {imgOptJob.message && <p>{imgOptJob.message}</p>}
                      {imgOptJob.status === 'running' && imgOptJob.total > 0 && (
                        <div className="h-1.5 rounded-full bg-bs-elevated overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all"
                            style={{ width: `${Math.min(100, Math.round((imgOptJob.done / imgOptJob.total) * 100))}%` }}
                          />
                        </div>
                      )}
                      {!!imgOptJob.errors?.length && imgOptJob.status !== 'running' && (
                        <p className="text-amber-700 dark:text-amber-400">
                          Ex.: {imgOptJob.errors.slice(0, 3).map((e) => `${e.sku}: ${e.error}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}

                  {imgOptCandidates.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="bs-input text-xs py-1 min-w-[120px]"
                          value={imgOptSourceFilter}
                          onChange={(e) => setImgOptSourceFilter(e.target.value as 'all' | 'bling' | 'woo')}
                        >
                          <option value="all">Todas origens</option>
                          <option value="bling">Só Bling</option>
                          <option value="woo">Só Woo</option>
                        </select>
                        <button
                          type="button"
                          className="text-xs text-bs-accent underline"
                          onClick={() => {
                            const bling = imgOptCandidates.filter((c) => c.source === 'bling');
                            setImgOptSelected(new Set(bling.map((c) => String(c.blingId || c.externalId))));
                          }}
                        >
                          Selecionar todos Bling
                        </button>
                        <button
                          type="button"
                          className="text-xs text-bs-muted underline"
                          onClick={() => setImgOptSelected(new Set())}
                        >
                          Limpar seleção
                        </button>
                      </div>
                      <div className="max-h-64 overflow-auto rounded-lg border border-bs-border">
                        <table className="w-full text-xs">
                          <thead className="bg-bs-elevated sticky top-0">
                            <tr className="text-left text-bs-muted">
                              <th className="p-2 w-8" />
                              <th className="p-2">SKU</th>
                              <th className="p-2">Origem</th>
                              <th className="p-2">Dimensão</th>
                              <th className="p-2">Tamanho</th>
                              <th className="p-2">Fotos</th>
                              <th className="p-2">Nome</th>
                            </tr>
                          </thead>
                          <tbody>
                            {imgOptCandidates.slice(0, 500).map((c) => {
                              const id = String(c.blingId || c.externalId);
                              const checked = imgOptSelected.has(id);
                              return (
                                <tr key={`${c.source}-${id}`} className="border-t border-bs-border">
                                  <td className="p-2">
                                    {c.source === 'bling' ? (
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setImgOptSelected((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(id)) next.delete(id);
                                            else next.add(id);
                                            return next;
                                          });
                                        }}
                                      />
                                    ) : (
                                      <span className="text-bs-subtle">—</span>
                                    )}
                                  </td>
                                  <td className="p-2 font-mono text-bs-text">{c.sku || '—'}</td>
                                  <td className="p-2 uppercase">{c.source}</td>
                                  <td className="p-2 tabular-nums text-bs-text">
                                    {c.maxWidth || c.maxHeight ? `${c.maxWidth}×${c.maxHeight}` : '—'}
                                  </td>
                                  <td className="p-2 tabular-nums">{fmtBytes(c.maxBytes)}</td>
                                  <td className="p-2 tabular-nums">
                                    {c.flaggedCount}/{c.imageCount}
                                    {c.likelyDuplicates ? (
                                      <span className="ml-1 text-amber-700 dark:text-amber-400">dup</span>
                                    ) : null}
                                  </td>
                                  <td className="p-2 truncate max-w-[180px] text-bs-muted">{c.name || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="search"
                  className="bs-input text-sm min-w-[160px] flex-1"
                  placeholder="Buscar SKU ou nome…"
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                />
                <select
                  className="bs-input text-sm min-w-[150px]"
                  value={compareDiff}
                  onChange={(e) => setCompareDiff(e.target.value)}
                >
                  <option value="any">Só com divergência</option>
                  <option value="all">Todos pareados</option>
                  <option value="stock">Estoque</option>
                  <option value="photos">Fotos</option>
                  <option value="photos_asymmetric">Sem foto Bling (tem Woo)</option>
                  <option value="price">Preço</option>
                  <option value="weight">Peso</option>
                  <option value="dimensions">Dimensões</option>
                  <option value="name">Nome</option>
                </select>
                <select
                  className="bs-input text-sm min-w-[130px]"
                  value={compareStock}
                  onChange={(e) => setCompareStock(e.target.value as '' | 'in_stock' | 'out_of_stock' | 'unknown')}
                >
                  <option value="">Estoque Bling: todos</option>
                  <option value="in_stock">Com estoque</option>
                  <option value="out_of_stock">Sem estoque</option>
                  <option value="unknown">Desconhecido</option>
                </select>
                <button
                  type="button"
                  className="bs-btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50"
                  disabled={exportingCompare || !(compareData?.total)}
                  onClick={() => void handleExportCompare()}
                >
                  <i className={`fa-solid ${exportingCompare ? 'fa-spinner animate-spin' : 'fa-file-csv'}`} />
                  CSV
                </button>
              </div>

              <div className="bs-table-wrap overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto">
                <table className="bs-table text-[12px] [&_th]:!px-2 [&_th]:!py-1.5 [&_td]:!px-2 [&_td]:!py-1">
                  <thead className="bs-table-head sticky top-0 z-10">
                    <tr>
                      <th>SKU</th>
                      <th>Nome</th>
                      <th className="text-right">Est. B</th>
                      <th className="text-right">Est. W</th>
                      <th className="text-right">Fotos B</th>
                      <th className="text-right">Fotos W</th>
                      <th className="text-right hidden lg:table-cell">R$ B</th>
                      <th className="text-right hidden lg:table-cell">R$ W</th>
                      <th className="hidden xl:table-cell">Peso B/W</th>
                      <th className="hidden xl:table-cell">Dims</th>
                      <th>Diffs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareLoading && !filteredComparator.length ? (
                      <tr>
                        <td colSpan={11} className="text-center text-bs-muted py-8">Carregando…</td>
                      </tr>
                    ) : !filteredComparator.length ? (
                      <tr>
                        <td colSpan={11} className="text-center text-bs-muted py-8">
                          Nenhum par com esse filtro.
                        </td>
                      </tr>
                    ) : (
                      filteredComparator.map((row) => (
                        <tr key={row.sku} className="bs-table-row">
                          <td className="font-mono text-[11px] whitespace-nowrap">{row.sku}</td>
                          <td className="max-w-[200px] truncate" title={row.bling?.name || row.woo?.name}>
                            {row.bling?.name || row.woo?.name || '—'}
                          </td>
                          <td className={`text-right tabular-nums ${row.diffs.includes('stock') ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                            {row.bling?.stockQty ?? '—'}
                          </td>
                          <td className={`text-right tabular-nums ${row.diffs.includes('stock') ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                            {row.woo?.stockQty ?? '—'}
                          </td>
                          <td className={`text-right tabular-nums ${row.diffs.includes('photos_asymmetric') || row.diffs.includes('photos') ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                            {row.bling?.imageCount ?? 0}
                          </td>
                          <td className={`text-right tabular-nums ${row.diffs.includes('photos_asymmetric') || row.diffs.includes('photos') ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                            {row.woo?.imageCount ?? 0}
                          </td>
                          <td className="text-right tabular-nums hidden lg:table-cell">{row.bling?.price ?? '—'}</td>
                          <td className="text-right tabular-nums hidden lg:table-cell">{row.woo?.price ?? row.woo?.salePrice ?? '—'}</td>
                          <td className="hidden xl:table-cell whitespace-nowrap text-bs-muted">
                            {row.bling?.weight ?? '—'} / {row.woo?.weight ?? '—'}
                          </td>
                          <td className="hidden xl:table-cell whitespace-nowrap text-bs-muted text-[11px]" title={`B ${fmtDims(row.bling)} · W ${fmtDims(row.woo)}`}>
                            {fmtDims(row.bling)}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {row.diffs.map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-bs-border bg-bs-elevated text-bs-muted hover:border-bs-accent/40 hover:text-bs-text"
                                  title="Abrir em Problemas"
                                  onClick={() => {
                                    const rule = DIFF_RULE[d];
                                    if (rule) openRule(rule);
                                  }}
                                >
                                  {diffLabel(d)}
                                </button>
                              ))}
                              {!row.diffs.length && <span className="text-bs-subtle">—</span>}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {compareData?.truncated && (
                <p className="text-xs text-bs-subtle">
                  Mostrando {filteredComparator.length} de {compareData.total}. Use o CSV para a lista completa.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'goiania' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-semibold text-bs-text">Fila Goiânia — conferência física</h3>
              <p className="text-xs text-bs-muted">
                {isCatalogAdmin
                  ? 'Você pede o que falta · Goiânia responde com foto/peso/medidas · você aplica no Bling.'
                  : 'Responda os pedidos pendentes com foto, peso e/ou medidas.'}
                {isCatalogAdmin && !showCompletedReport && (
                  <>
                    {' '}
                    Abertos: {dash?.goiania?.open ?? ind.goianiaOpen ?? 0}
                    {' · '}
                    Pendentes: {dash?.goiania?.pending ?? ind.goianiaPending ?? 0}
                    {' · '}
                    Respondidos: {dash?.goiania?.answered ?? ind.goianiaAnswered ?? 0}
                    {' · '}
                    Atrasados: {dash?.goiania?.overdue ?? ind.goianiaOverdue ?? 0}
                  </>
                )}
                {!isCatalogAdmin && !showCompletedReport && (ind.goianiaOverdue || dash?.goiania?.overdue) ? (
                  <> · Atenção: há pedidos atrasados</>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowCompletedReport((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border ${
                  showCompletedReport
                    ? 'border-bs-accent text-bs-accent bg-bs-accent/10'
                    : 'border-bs-border text-bs-muted hover:text-bs-text'
                }`}
              >
                <i className="fa-solid fa-chart-simple mr-1.5" />
                Relatório
              </button>
              {!showCompletedReport && ([
                ['open', 'Abertos'],
                ['pending', 'Pendentes'],
                ['answered', 'Respondidos'],
                ['returned', 'Devolvidos'],
                ['overdue', 'Atrasados'],
                ['applied', 'Aplicados'],
                ['all', 'Todos'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCheckFilter(id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    checkFilter === id
                      ? 'border-bs-accent text-bs-accent bg-bs-accent/10'
                      : 'border-bs-border text-bs-muted hover:text-bs-text'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="bs-btn-secondary text-xs px-3 py-1.5"
                onClick={() => void (showCompletedReport ? loadCompletedReport() : loadChecks())}
              >
                Atualizar
              </button>
            </div>
          </div>

          {showCompletedReport ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {([
                  ['today', 'Hoje'],
                  ['7d', '7 dias'],
                  ['30d', '30 dias'],
                  ['all', 'Tudo'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReportPeriod(id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      reportPeriod === id
                        ? 'border-bs-accent text-bs-accent bg-bs-accent/10'
                        : 'border-bs-border text-bs-muted hover:text-bs-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {reportLoading && !report ? (
                <p className="text-sm text-bs-muted animate-pulse py-6">Carregando relatório…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Concluídos', value: report?.summary.completed ?? 0, hint: 'Respondidos + aplicados', tone: 'ok' as const },
                      { label: 'Aplicados', value: report?.summary.applied ?? 0, hint: 'Já no Bling', tone: 'ok' as const },
                      { label: 'Aguardando apply', value: report?.summary.answered ?? 0, hint: 'Respondidos, ainda não aplicados', tone: 'warn' as const },
                      { label: 'Devolvidos', value: report?.summary.returned ?? 0, hint: 'Não conseguimos / reabertos', tone: 'danger' as const },
                    ].map((c) => (
                      <div key={c.label} className={`rounded-xl border p-4 ${toneClass(c.tone)}`}>
                        <p className="text-[11px] uppercase tracking-wide text-bs-subtle font-semibold">{c.label}</p>
                        <p className="text-2xl font-bold text-bs-text mt-1 tabular-nums">{c.value}</p>
                        <p className="text-[11px] text-bs-muted mt-1">{c.hint}</p>
                      </div>
                    ))}
                  </div>

                  {(report?.byResponder || []).length > 0 && (
                    <div className="bs-card p-4">
                      <p className="text-xs font-semibold text-bs-text mb-2">Quem respondeu</p>
                      <div className="flex flex-wrap gap-2">
                        {report!.byResponder.map((r) => (
                          <span
                            key={r.name}
                            className="text-xs px-2.5 py-1 rounded-lg border border-bs-border bg-bs-elevated text-bs-muted"
                          >
                            <span className="text-bs-text font-medium">{r.name}</span>
                            {' · '}
                            {r.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {!report?.items?.length ? (
                    <div className="rounded-lg border border-dashed border-bs-border p-8 text-center text-sm text-bs-muted">
                      Nenhum concluído neste período.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-bs-text">
                        Lista ({report.items.length})
                      </p>
                      {report.items.map((c) => (
                        <div key={c.id} className="bs-card p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                c.status === 'applied'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              }`}
                              >
                                {checkStatusLabel(c.status)}
                              </span>
                              <span className="font-mono text-xs text-bs-muted">{c.sku || 'sem SKU'}</span>
                              <span className="text-sm text-bs-text truncate">{c.name || '—'}</span>
                            </div>
                            <p className="text-xs text-bs-muted">
                              {c.answeredByName ? `Resposta: ${c.answeredByName}` : '—'}
                              {c.answeredAt ? ` · ${formatDueAt(c.answeredAt)}` : ''}
                              {c.status === 'applied' && c.appliedAt
                                ? ` · Aplicado ${formatDueAt(c.appliedAt)}`
                                : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="bs-btn-secondary text-xs px-3 py-1.5 shrink-0"
                            onClick={() => void openCheckDetail(c)}
                          >
                            Detalhes
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : checksLoading ? (
            <p className="text-sm text-bs-muted animate-pulse py-6">Carregando fila…</p>
          ) : !checks.length ? (
            <div className="rounded-lg border border-dashed border-bs-border p-8 text-center text-sm text-bs-muted">
              {isCatalogAdmin
                ? <>Nenhum pedido neste filtro. Em Problemas, use o botão <strong className="text-bs-text">Goiânia</strong> no produto.</>
                : 'Nenhuma solicitação neste filtro. Quando pedirem conferência, aparece aqui.'}
            </div>
          ) : (
            <div className="space-y-3">
              {checks.map((c) => {
                const photoSrc = c.photoUrl
                  ? `${c.photoUrl}?token=${encodeURIComponent(authToken)}`
                  : null;
                const overdue = checkIsOverdue(c);
                const dueLabel = formatDueAt(c.dueAt);
                return (
                  <div
                    key={c.id}
                    className={`bs-card p-4 space-y-3 ${overdue ? 'border-red-500/40' : ''}`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            c.status === 'pending' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              : c.status === 'answered' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : c.status === 'returned' ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
                                  : 'bg-bs-elevated text-bs-muted border border-bs-border'
                          }`}
                          >
                            {checkStatusLabel(c.status)}
                          </span>
                          {c.priority === 'urgent' ? (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                              Urgente
                            </span>
                          ) : null}
                          {overdue ? (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-300">
                              Atrasado
                            </span>
                          ) : null}
                          <span className="font-mono text-xs text-bs-muted">{c.sku || 'sem SKU'}</span>
                          <span className="text-xs text-bs-subtle">ID {c.externalId}</span>
                        </div>
                        <p className="text-sm font-medium text-bs-text">{c.name || '—'}</p>
                        <p className="text-xs text-bs-muted">
                          Pedido por {c.requestedByName || '—'} · precisa:{' '}
                          {(c.need || []).map(needLabel).join(', ') || '—'}
                          {dueLabel ? ` · prazo ${dueLabel}` : ''}
                        </p>
                        {c.requestNote ? (
                          <p className="text-xs text-bs-subtle">Obs.: {c.requestNote}</p>
                        ) : null}
                        {c.returnReason ? (
                          <p className="text-xs text-orange-700 dark:text-orange-300">
                            Devolução{c.returnedByName ? ` (${c.returnedByName})` : ''}: {c.returnReason}
                          </p>
                        ) : null}
                        {c.status === 'answered' || c.status === 'applied' ? (
                          <div className="text-xs text-bs-muted space-y-0.5 pt-1">
                            <p>
                              Resposta de {c.answeredByName || '—'}
                              {c.responseWeight != null ? ` · peso ${c.responseWeight} kg` : ''}
                              {c.responseHeight != null
                                ? ` · ${c.responseHeight}×${c.responseWidth ?? '?'}×${c.responseLength ?? '?'} cm`
                                : ''}
                            </p>
                            {c.responseNote ? <p>Nota: {c.responseNote}</p> : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          className="bs-btn-secondary text-xs px-3 py-1.5"
                          onClick={() => void openCheckDetail(c)}
                        >
                          Detalhes
                        </button>
                        {c.status === 'pending' && canAnswerChecks && (
                          <button type="button" className="bs-btn text-xs px-3 py-1.5" onClick={() => openAnswer(c)}>
                            Responder
                          </button>
                        )}
                        {c.status === 'pending' && canAnswerChecks && (
                          <button
                            type="button"
                            className="bs-btn-secondary text-xs px-3 py-1.5"
                            onClick={() => openReturn(c, 'close')}
                          >
                            Não consegui
                          </button>
                        )}
                        {c.status === 'pending' && isCatalogAdmin && (
                          <button type="button" className="bs-btn-secondary text-xs px-3 py-1.5" onClick={() => void handleCancelCheck(c)}>
                            Cancelar
                          </button>
                        )}
                        {c.status === 'answered' && isCatalogAdmin && (
                          <button type="button" className="bs-btn text-xs px-3 py-1.5" onClick={() => void handleApplyCheck(c)}>
                            Aplicar no Bling
                          </button>
                        )}
                        {c.status === 'answered' && isCatalogAdmin && (
                          <button
                            type="button"
                            className="bs-btn-secondary text-xs px-3 py-1.5"
                            onClick={() => openReturn(c, 'reopen')}
                          >
                            Devolver
                          </button>
                        )}
                        {isCatalogAdmin && c.status !== 'applied' && (
                          <button
                            type="button"
                            className="bs-btn-danger text-xs px-3 py-1.5"
                            onClick={() => void handleDeleteCheck(c)}
                            title="Excluir pedido (preenchimento errado)"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </div>
                    {photoSrc ? (
                      <a href={photoSrc} target="_blank" rel="noreferrer" className="inline-block">
                        <img src={photoSrc} alt="Conferência" className="max-h-40 rounded-lg border border-bs-border" />
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          <div className="bs-card p-6 space-y-3 text-sm text-bs-muted">
            <div>
              <p className="font-semibold text-bs-text">Inventário completo (para a gerente)</p>
              <p className="text-sm text-bs-muted mt-1 max-w-2xl">
                Exporta <strong className="text-bs-text">todos</strong> os produtos ativos do Bling — com e sem erro.
                Colunas <code>Tem problema?</code>, tipos e detalhe dos erros. Separador <code>;</code> (Excel BR).
                Use a última análise; se estiver velha, rode Verificar Catálogo antes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="bs-btn text-sm flex items-center gap-2 disabled:opacity-50"
                disabled={exportingInventory}
                onClick={() => void handleExportFullInventory()}
              >
                <i className={`fa-solid ${exportingInventory ? 'fa-spinner animate-spin' : 'fa-file-excel'}`} />
                Baixar inventário completo (CSV)
              </button>
            </div>
            {dash && (
              <p className="text-xs text-bs-subtle">
                Snapshot atual: {dash.blingCount ?? '—'} Bling · {dash.productsWithAnyIssue ?? '—'} com algum problema
                · {dash.productsWithErrors ?? '—'} com crítico
              </p>
            )}
          </div>

          <div className="bs-card p-6 space-y-3 text-sm text-bs-muted">
            {scan?.status === 'done' && scan.summary ? (
              <>
                <p className="font-semibold text-bs-text">Resumo da última análise</p>
                <p>Analisados: {scan.summary.analyzed}</p>
                <p>Com problemas: {scan.summary.withProblems}</p>
                <p>Sem problemas: {scan.summary.withoutProblems}</p>
                <p>Duração: {formatDuration(scan.durationMs)}</p>
                <p className="text-xs text-bs-subtle">
                  Este botão exporta <strong className="text-bs-text">só linhas com problema</strong> (uma por regra).
                  Separador <code>;</code> para Excel BR.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    className="bs-btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
                    disabled={exporting || !(scan.issueCount)}
                    onClick={() => handleExport()}
                  >
                    <i className={`fa-solid ${exporting ? 'fa-spinner animate-spin' : 'fa-file-csv'}`} />
                    Exportar só os problemas
                  </button>
                  <button type="button" className="bs-btn-secondary text-sm" onClick={() => setTab('problems')}>
                    Ver lista na tela
                  </button>
                </div>
              </>
            ) : (
              <p>Rode Verificar Catálogo para gerar o relatório de problemas.</p>
            )}
          </div>

          <div className="bs-card p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-bs-text">Fora do escopo (não semijoia / não Bíblia)</p>
                <p className="text-sm text-bs-muted mt-1 max-w-2xl">
                  Lista para o responsável conferir se esses itens existem de verdade ou são produtos fantasmas.
                  Semijoias e Bíblias ficam de fora. Separador <code>;</code> no CSV (Excel BR).
                </p>
              </div>
              <button
                type="button"
                className="bs-btn text-sm flex items-center gap-2 disabled:opacity-50 shrink-0"
                disabled={exportingOutOfScope || !(outOfScope?.total)}
                onClick={() => void handleExportOutOfScope()}
              >
                <i className={`fa-solid ${exportingOutOfScope ? 'fa-spinner animate-spin' : 'fa-file-csv'}`} />
                Baixar CSV completo
              </button>
            </div>

            {outOfScope?.counts && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">
                    {outOfScopeSearch || outOfScopeCategory || outOfScopeStock ? 'Neste filtro' : 'Fora do escopo'}
                  </p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{outOfScope.total}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Semijoia (excluídos)</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{outOfScope.counts.jewelry}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Bíblia (excluídas)</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{outOfScope.counts.bible}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Categorias na lista</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{outOfScope.byCategory?.length || 0}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                className="bs-input text-sm min-w-[180px] flex-1"
                placeholder="Buscar SKU, nome, marca…"
                value={outOfScopeSearch}
                onChange={(e) => setOutOfScopeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadOutOfScope();
                }}
              />
              <select
                className="bs-input text-sm min-w-[160px]"
                value={outOfScopeCategory}
                onChange={(e) => setOutOfScopeCategory(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                {(outOfScope?.byCategory || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.count})
                  </option>
                ))}
              </select>
              <select
                className="bs-input text-sm min-w-[140px]"
                value={outOfScopeStock}
                onChange={(e) => setOutOfScopeStock(e.target.value as '' | 'in_stock' | 'out_of_stock' | 'unknown')}
              >
                <option value="">Estoque: todos</option>
                <option value="in_stock">Com estoque (&gt; 0)</option>
                <option value="out_of_stock">Sem estoque (0)</option>
                <option value="unknown">Estoque desconhecido</option>
              </select>
              <button
                type="button"
                className="bs-btn-secondary text-sm"
                disabled={outOfScopeLoading}
                onClick={() => void loadOutOfScope()}
              >
                {outOfScopeLoading ? 'Carregando…' : 'Filtrar'}
              </button>
            </div>

            {outOfScope?.byCategory && outOfScope.byCategory.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {outOfScope.byCategory.slice(0, 12).map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={`text-[11px] px-2 py-1 rounded-md border bg-bs-elevated ${
                      outOfScopeCategory === c.name
                        ? 'border-bs-accent/50 text-bs-text'
                        : 'border-bs-border text-bs-muted hover:border-bs-accent/40 hover:text-bs-text'
                    }`}
                    onClick={() => {
                      setOutOfScopeCategory(outOfScopeCategory === c.name ? '' : c.name);
                    }}
                  >
                    {c.name} · {c.count}
                  </button>
                ))}
              </div>
            )}

            <div className="bs-table-wrap overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="bs-table text-[13px] [&_th]:!px-2.5 [&_th]:!py-2 [&_td]:!px-2.5 [&_td]:!py-1.5">
                <thead className="bs-table-head sticky top-0 z-10">
                  <tr>
                    <th>SKU</th>
                    <th>Nome</th>
                    <th>Categoria</th>
                    <th className="hidden md:table-cell">Marca</th>
                    <th className="text-right">Estoque</th>
                    <th className="hidden lg:table-cell">Situação</th>
                    <th className="hidden xl:table-cell">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {outOfScopeLoading && !(outOfScope?.products?.length) ? (
                    <tr>
                      <td colSpan={7} className="text-center text-bs-muted py-8">Carregando…</td>
                    </tr>
                  ) : !(outOfScope?.products?.length) ? (
                    <tr>
                      <td colSpan={7} className="text-center text-bs-muted py-8">
                        Nenhum produto fora do escopo com esse filtro.
                      </td>
                    </tr>
                  ) : (
                    outOfScope.products.map((p) => (
                      <tr key={p.externalId} className="bs-table-row">
                        <td className="font-mono text-[12px] whitespace-nowrap">{p.sku || '—'}</td>
                        <td className="max-w-[280px] truncate" title={p.name}>{p.name || '—'}</td>
                        <td className="whitespace-nowrap">{p.category || '(sem categoria)'}</td>
                        <td className="hidden md:table-cell whitespace-nowrap">{p.brand || '—'}</td>
                        <td className="text-right tabular-nums">{p.stockQty ?? '—'}</td>
                        <td className="hidden lg:table-cell">
                          {p.status === 'I' ? 'Inativo' : p.status === 'A' ? 'Ativo' : (p.status || '—')}
                        </td>
                        <td className="hidden xl:table-cell font-mono text-[11px] text-bs-muted">{p.externalId}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {outOfScope?.truncated && (
              <p className="text-xs text-bs-subtle">
                Mostrando os primeiros {outOfScope.products.length} de {outOfScope.total}. Use o CSV para a lista completa.
              </p>
            )}
          </div>

          <div className="bs-card p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-bs-text">Clones Woo-ID × SKU real (Bling)</p>
                <p className="text-sm text-bs-muted mt-1 max-w-2xl">
                  Produtos em que o Woo usa o próprio ID como SKU e o Bling tem um espelho desse código,
                  enquanto o SKU real (mesmo nome) também existe. Ação: <strong className="text-bs-text">inativar o clone</strong> no Bling
                  e no Woo trocar o SKU para o código real. Não apaga o produto da vitrine.
                </p>
              </div>
              <button
                type="button"
                className="bs-btn text-sm flex items-center gap-2 disabled:opacity-50 shrink-0"
                disabled={exportingWooIdClones || !(wooIdClones?.total)}
                onClick={() => void handleExportWooIdClones()}
              >
                <i className={`fa-solid ${exportingWooIdClones ? 'fa-spinner animate-spin' : 'fa-file-csv'}`} />
                Baixar CSV
              </button>
            </div>

            {wooIdClones?.counts && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Clones ativos listados</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{wooIdClones.total}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Com SKU real (mesmo nome)</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{wooIdClones.counts.withRealAlt}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Confiança alta</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{wooIdClones.counts.high}</p>
                </div>
                <div className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                  <p className="text-[11px] text-bs-muted">Woo SKU = ID</p>
                  <p className="text-lg font-semibold text-bs-text tabular-nums">{wooIdClones.counts.wooSkuEqId}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                className="bs-input text-sm min-w-[180px] flex-1"
                placeholder="Buscar nome, SKU clone, SKU real…"
                value={wooIdClonesSearch}
                onChange={(e) => setWooIdClonesSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadWooIdClones();
                }}
              />
              <select
                className="bs-input text-sm min-w-[140px]"
                value={wooIdClonesConfidence}
                onChange={(e) => setWooIdClonesConfidence(e.target.value as '' | 'high' | 'medium' | 'low')}
              >
                <option value="">Confiança: todas</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
              <button
                type="button"
                className="bs-btn-secondary text-sm"
                disabled={wooIdClonesLoading}
                onClick={() => void loadWooIdClones()}
              >
                {wooIdClonesLoading ? 'Carregando…' : 'Filtrar'}
              </button>
              {canInactivate && cloneSelectedIds.size > 0 && (
                <button
                  type="button"
                  className="bs-btn text-sm disabled:opacity-50"
                  disabled={cloneBulkBusy}
                  onClick={() => void handleBulkInactivateClones()}
                >
                  {cloneBulkBusy ? 'Inativando…' : `Inativar ${cloneSelectedIds.size} clone(s)`}
                </button>
              )}
            </div>

            <div className="bs-table-wrap overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="bs-table text-[13px] [&_th]:!px-2.5 [&_th]:!py-2 [&_td]:!px-2.5 [&_td]:!py-1.5">
                <thead className="bs-table-head sticky top-0 z-10">
                  <tr>
                    {canInactivate && (
                      <th className="w-8">
                        <input
                          type="checkbox"
                          checked={
                            (wooIdClones?.rows?.length || 0) > 0
                            && (wooIdClones?.rows || []).every((r) => cloneSelectedIds.has(r.clone.id))
                          }
                          onChange={toggleSelectAllClones}
                          aria-label="Selecionar todos"
                        />
                      </th>
                    )}
                    <th>Conf.</th>
                    <th>Nome</th>
                    <th>Clone (Woo ID)</th>
                    <th>SKU real</th>
                    <th className="hidden md:table-cell text-right">Fotos C/R/W</th>
                    <th className="hidden lg:table-cell">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {wooIdClonesLoading && !(wooIdClones?.rows?.length) ? (
                    <tr>
                      <td colSpan={canInactivate ? 7 : 6} className="text-center text-bs-muted py-8">Carregando…</td>
                    </tr>
                  ) : !(wooIdClones?.rows?.length) ? (
                    <tr>
                      <td colSpan={canInactivate ? 7 : 6} className="text-center text-bs-muted py-8">
                        Nenhum clone ativo com esse filtro.
                      </td>
                    </tr>
                  ) : (
                    wooIdClones.rows.map((r) => (
                      <tr key={r.clone.id} className="bs-table-row">
                        {canInactivate && (
                          <td>
                            <input
                              type="checkbox"
                              checked={cloneSelectedIds.has(r.clone.id)}
                              onChange={() => toggleCloneSelect(r.clone.id)}
                              aria-label={`Selecionar clone ${r.clone.sku}`}
                            />
                          </td>
                        )}
                        <td>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                            r.confidence === 'high'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : r.confidence === 'medium'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                : 'bg-bs-elevated text-bs-muted border border-bs-border'
                          }`}>
                            {r.confidence === 'high' ? 'alta' : r.confidence === 'medium' ? 'média' : 'baixa'}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate" title={r.name}>{r.name || '—'}</td>
                        <td className="font-mono text-[12px] whitespace-nowrap">
                          {r.clone.sku || '—'}
                          <span className="block text-[10px] text-bs-muted">{r.clone.imageCount || 0} foto(s)</span>
                        </td>
                        <td className="font-mono text-[12px] whitespace-nowrap">
                          {r.keep?.sku || '—'}
                          {r.keep && (
                            <span className="block text-[10px] text-bs-muted">{r.keep.imageCount || 0} foto(s)</span>
                          )}
                        </td>
                        <td className="hidden md:table-cell text-right tabular-nums text-bs-muted">
                          {r.clone.imageCount || 0}/{r.keep?.imageCount ?? '—'}/{r.woo.imageCount || 0}
                        </td>
                        <td className="hidden lg:table-cell text-[11px] text-bs-muted max-w-[220px]" title={r.action}>
                          {r.keep
                            ? `Inativar ${r.clone.sku} · Woo → ${r.keep.sku}`
                            : r.action}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {wooIdClones?.truncated && (
              <p className="text-xs text-bs-subtle">
                Mostrando os primeiros {wooIdClones.rows.length} de {wooIdClones.total}. Use o CSV para a lista completa.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="bs-card p-6 space-y-2">
          <p className="text-sm text-bs-muted mb-3">
            Motor modular — cada regra é plugável. Peso máximo atual: 5 kg.
            Em Problemas, use <strong className="text-bs-text">Corrigir</strong> para gravar direto no Bling.
          </p>
          {(visibleRules).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openRule(r.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-bs-elevated border border-bs-border text-sm hover:border-bs-accent/40"
            >
              <span className="text-bs-text">{r.label}</span>
              <span className="text-bs-muted text-xs">
                {r.count} · {priorityLabel(r.priority)}
              </span>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!editIssue}
        title="Corrigir e sincronizar no Bling"
        onClose={() => { if (!saving && !suggestingAi) void closeEdit(); }}
      >
        {editIssue && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-xs text-bs-muted">
                ID {editIssue.externalId} · {editIssue.message}
              </p>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  className="bs-btn-secondary text-sm px-3 py-2 disabled:opacity-60"
                  onClick={() => void handleRefreshLiveEdit()}
                  disabled={saving || suggestingAi || refreshingLive || !!deletingId}
                  title="Busca o cadastro atual deste produto no Bling"
                >
                  {refreshingLive || editLiveStatus === 'loading' ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Bling…
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-arrow-down mr-2" />
                      Buscar no Bling
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="bs-btn-secondary text-sm px-3 py-2 shrink-0 disabled:opacity-60"
                  onClick={handleSuggestAi}
                  disabled={saving || suggestingAi || !!deletingId}
                  title="Gera NCM/peso/dims/descrições com IA (Gemini). Só grava no Bling ao salvar"
                >
                  {suggestingAi ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Gerando…
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-wand-magic-sparkles mr-2" />
                      Sugerir com IA
                    </>
                  )}
                </button>
              </div>
            </div>
            {editLiveStatus === 'ok' && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Cadastro atualizado do Bling agora. A categoria abaixo é a do ERP, não do snapshot antigo.
              </p>
            )}
            {editLiveStatus === 'error' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Não deu para buscar o Bling agora. Os campos são do snapshot local — clique em “Buscar no Bling”.
              </p>
            )}
            {editLiveStatus === 'loading' && (
              <p className="text-[11px] text-bs-muted">
                Buscando cadastro atual no Bling…
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-bs-muted sm:col-span-2">
                SKU
                <input className="bs-input mt-1 text-sm" value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Nome
                <input className="bs-input mt-1 text-sm" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Preço (R$)
                <input className="bs-input mt-1 text-sm" value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Marca
                <input
                  className="bs-input mt-1 text-sm"
                  list="catalog-brand-suggestions"
                  value={editForm.brand}
                  onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                  placeholder={`${DEFAULT_CATALOG_BRAND} (padrão)`}
                />
                <datalist id="catalog-brand-suggestions">
                  {[DEFAULT_CATALOG_BRAND, 'VA', 'Própria', 'Geográfica Editora'].map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Categoria (Bling)
                <select
                  className="bs-input mt-1 text-sm"
                  value={editForm.categoryId}
                  onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                >
                  <option value="">— Sem categoria —</option>
                  {editForm.categoryId && !catalogCategories.some((c) => String(c.id) === String(editForm.categoryId)) && (
                    <option value={editForm.categoryId}>
                      ID {editForm.categoryId} (não está na lista — possivelmente categoria padrão)
                    </option>
                  )}
                  {catalogCategories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.parentId ? `↳ ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
                <span className="block mt-1 text-[11px] text-bs-subtle">
                  {(() => {
                    const selected = catalogCategories.find((c) => String(c.id) === String(editForm.categoryId));
                    if (selected && isPlaceholderCategoryName(selected.name)) {
                      return 'Essa é a categoria padrão do Bling — escolha Anéis, Brincos, Colares etc.';
                    }
                    if (editForm.categoryId && !selected) {
                      return 'Este ID não aparece na lista de categorias de produto. Busque no Bling ou escolha outra.';
                    }
                    if (!editForm.categoryId) {
                      return 'Vazio aqui quase sempre é “Categoria padrão” no Bling, não falta de cadastro.';
                    }
                    return selected ? `Categoria atual: ${selected.name}` : '';
                  })()}
                </span>
              </label>
              <div className="sm:col-span-2 flex flex-col sm:flex-row gap-2 sm:items-end">
                <label className="text-xs text-bs-muted flex-1">
                  Nova categoria no Bling
                  <input
                    className="bs-input mt-1 text-sm"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="ex.: Pulseiras Prata"
                  />
                </label>
                <button
                  type="button"
                  className="bs-btn-secondary text-xs px-3 py-2 shrink-0 disabled:opacity-50"
                  disabled={categoryBusy || !newCategoryName.trim()}
                  onClick={async () => {
                    const name = newCategoryName.trim();
                    if (!name) return;
                    setCategoryBusy(true);
                    try {
                      const res = await platformService.createCatalogCategory({ name });
                      await loadCatalogCategories();
                      if (res.category?.id) {
                        setEditForm((f) => ({ ...f, categoryId: String(res.category.id) }));
                      }
                      setNewCategoryName('');
                      showToast(`Categoria "${res.category?.name || name}" criada no Bling.`, 'success');
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : 'Erro ao criar categoria', 'error');
                    } finally {
                      setCategoryBusy(false);
                    }
                  }}
                >
                  {categoryBusy ? 'Criando…' : 'Criar e usar'}
                </button>
              </div>
              <label className="text-xs text-bs-muted">
                Peso (kg)
                <input className="bs-input mt-1 text-sm" value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} placeholder="ex.: 0.05" />
              </label>
              <label className="text-xs text-bs-muted">
                NCM
                <input className="bs-input mt-1 text-sm" value={editForm.ncm} onChange={(e) => setEditForm({ ...editForm, ncm: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Altura (cm)
                <input className="bs-input mt-1 text-sm" value={editForm.height} onChange={(e) => setEditForm({ ...editForm, height: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Largura (cm)
                <input className="bs-input mt-1 text-sm" value={editForm.width} onChange={(e) => setEditForm({ ...editForm, width: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Comprimento (cm)
                <input className="bs-input mt-1 text-sm" value={editForm.length} onChange={(e) => setEditForm({ ...editForm, length: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Palavra-chave de foco Rank Math
                <input
                  className="bs-input mt-1 text-sm"
                  value={editForm.focusKeyword}
                  onChange={(e) => setEditForm({ ...editForm, focusKeyword: e.target.value })}
                  placeholder="ex.: aromatizador de ambientes alecrim"
                />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Título SEO Rank Math / ML ({editForm.seoTitle.length}/60)
                <input
                  className="bs-input mt-1 text-sm"
                  value={editForm.seoTitle}
                  maxLength={60}
                  onChange={(e) => setEditForm({ ...editForm, seoTitle: e.target.value })}
                  placeholder="50–60 caracteres · tipo + atributo no início"
                />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Meta description Rank Math ({editForm.seoDescription.length}/160)
                <textarea
                  className="bs-input mt-1 text-sm min-h-[64px]"
                  value={editForm.seoDescription}
                  maxLength={160}
                  onChange={(e) => setEditForm({ ...editForm, seoDescription: e.target.value })}
                  placeholder="140–160 caracteres · benefício + CTA"
                />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Descrição curta (Bling / snippet) ({editForm.shortDescription.length}/160)
                <textarea
                  className="bs-input mt-1 text-sm min-h-[72px]"
                  value={editForm.shortDescription}
                  maxLength={200}
                  onChange={(e) => setEditForm({ ...editForm, shortDescription: e.target.value })}
                  placeholder="Texto curto SEO — ideal 140–160 caracteres"
                />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Descrição completa (ML / Bling complementar)
                <textarea
                  className="bs-input mt-1 text-sm min-h-[110px]"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Blocos com | — material, medidas, uso, diferencial"
                />
              </label>
            </div>
            {aiRationale ? (
              <p className="text-[11px] text-bs-muted rounded-lg border border-bs-border bg-bs-elevated px-3 py-2">
                <span className="font-semibold text-bs-text">IA: </span>
                {aiRationale}
              </p>
            ) : null}
            <p className="text-[11px] text-bs-subtle">
              IA segue Rank Math + Mercado Livre. Ao salvar, grava só no Bling (descrições). Woo recebe via sync do Bling — nada é enviado direto à loja.
            </p>
            <div className="flex justify-between gap-2 flex-wrap">
              {canInactivate ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="bs-btn-secondary text-sm px-4 py-2"
                    onClick={() => editIssue && handleInactivate(editIssue)}
                    disabled={saving || suggestingAi || !!deletingId}
                  >
                    Inativar
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      className="bs-btn-danger text-sm px-4 py-2"
                      onClick={() => editIssue && handleDelete(editIssue)}
                      disabled={saving || suggestingAi || !!deletingId}
                    >
                      {deletingId === editIssue.externalId ? '…' : 'Excluir'}
                    </button>
                  )}
                </div>
              ) : <span />}
              <div className="flex gap-2 flex-wrap justify-end">
                <button type="button" className="bs-btn-secondary text-sm px-4 py-2" onClick={() => void closeEdit()} disabled={saving || suggestingAi || !!deletingId}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="bs-btn-secondary text-sm px-4 py-2"
                  onClick={() => void markReviewedOnly()}
                  disabled={saving || suggestingAi || !!deletingId}
                  title="Marca como revisado sem alterar o Bling"
                >
                  Só marcar revisado
                </button>
                <button type="button" className="bs-btn text-sm px-4 py-2" onClick={saveEdit} disabled={saving || suggestingAi || !!deletingId}>
                  {saving ? 'Salvando no Bling…' : 'Salvar no Bling'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!requestIssue}
        title="Pedir conferência em Goiânia"
        onClose={() => { if (!requestBusy) setRequestIssue(null); }}
      >
        {requestIssue && (
          <div className="space-y-4">
            <p className="text-xs text-bs-muted">
              {requestIssue.sku || 'sem SKU'} · {requestIssue.name || requestIssue.externalId}
            </p>
            <div>
              <p className="text-xs font-semibold text-bs-text mb-2">O que precisam conferir?</p>
              <div className="flex flex-wrap gap-2">
                {NEED_OPTIONS.map((n) => {
                  const on = requestNeed.includes(n.id);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setRequestNeed((prev) => (
                          on ? prev.filter((x) => x !== n.id) : [...prev, n.id]
                        ));
                      }}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${
                        on
                          ? 'border-bs-accent text-bs-accent bg-bs-accent/10'
                          : 'border-bs-border text-bs-muted'
                      }`}
                    >
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-bs-text mb-2">Prioridade</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['normal', 'Normal (24h)'],
                    ['urgent', 'Urgente (8h)'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setRequestPriority(id);
                        setRequestDueHours(id === 'urgent' ? 8 : 24);
                      }}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${
                        requestPriority === id
                          ? 'border-bs-accent text-bs-accent bg-bs-accent/10'
                          : 'border-bs-border text-bs-muted'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs text-bs-muted">
                Prazo (horas)
                <input
                  type="number"
                  min={1}
                  max={168}
                  className="bs-input mt-1 text-sm"
                  value={requestDueHours}
                  onChange={(e) => setRequestDueHours(Math.max(1, Number(e.target.value) || 24))}
                />
              </label>
            </div>
            <label className="text-xs text-bs-muted block">
              Observação (opcional)
              <textarea
                className="bs-input mt-1 text-sm min-h-[72px]"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Ex.: pesar com embalagem; foto da etiqueta…"
              />
            </label>
            <p className="text-[11px] text-bs-subtle">
              Operadores com telefone cadastrado recebem aviso no WhatsApp (~2 min após o pedido).
            </p>
            {requestError ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300 space-y-2">
                <p>{requestError}</p>
                <button
                  type="button"
                  className="bs-btn text-xs px-3 py-1.5"
                  onClick={() => {
                    setRequestIssue(null);
                    setTab('goiania');
                    setCheckFilter('open');
                  }}
                >
                  Abrir fila Goiânia
                </button>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="bs-btn-secondary text-sm px-4 py-2" disabled={requestBusy} onClick={() => setRequestIssue(null)}>
                Cancelar
              </button>
              <button type="button" className="bs-btn text-sm px-4 py-2" disabled={requestBusy} onClick={() => void submitRequestGoiania()}>
                {requestBusy ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!answerCheck}
        title="Responder conferência (Goiânia)"
        onClose={() => { if (!answerBusy) setAnswerCheck(null); }}
      >
        {answerCheck && (
          <div className="space-y-4">
            <p className="text-xs text-bs-muted">
              {answerCheck.sku || 'sem SKU'} · {answerCheck.name}
            </p>
            <p className="text-xs text-bs-subtle">
              Pedido: {(answerCheck.need || []).map(needLabel).join(', ')}
              {answerCheck.requestNote ? ` — ${answerCheck.requestNote}` : ''}
            </p>
            {(answerCheck.need || []).includes('photo') ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Foto obrigatória neste pedido.
              </p>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-bs-muted">
                Peso (kg)
                <input className="bs-input mt-1 text-sm" value={answerForm.weight} onChange={(e) => setAnswerForm({ ...answerForm, weight: e.target.value })} placeholder="ex.: 0.05" />
              </label>
              <label className="text-xs text-bs-muted">
                Altura (cm)
                <input className="bs-input mt-1 text-sm" value={answerForm.height} onChange={(e) => setAnswerForm({ ...answerForm, height: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Largura (cm)
                <input className="bs-input mt-1 text-sm" value={answerForm.width} onChange={(e) => setAnswerForm({ ...answerForm, width: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted">
                Comprimento (cm)
                <input className="bs-input mt-1 text-sm" value={answerForm.length} onChange={(e) => setAnswerForm({ ...answerForm, length: e.target.value })} />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Foto{(answerCheck.need || []).includes('photo') ? ' *' : ''}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="mt-1 block w-full text-sm text-bs-muted"
                  onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
                />
              </label>
              <label className="text-xs text-bs-muted sm:col-span-2">
                Observação
                <textarea
                  className="bs-input mt-1 text-sm min-h-[72px]"
                  value={answerForm.responseNote}
                  onChange={(e) => setAnswerForm({ ...answerForm, responseNote: e.target.value })}
                />
              </label>
            </div>
            {answerForm.photoBase64 ? (
              <img src={answerForm.photoBase64} alt="Preview" className="max-h-36 rounded-lg border border-bs-border" />
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="bs-btn-secondary text-sm px-4 py-2" disabled={answerBusy} onClick={() => setAnswerCheck(null)}>
                Cancelar
              </button>
              <button type="button" className="bs-btn text-sm px-4 py-2" disabled={answerBusy} onClick={() => void submitAnswer()}>
                {answerBusy ? 'Enviando…' : 'Enviar resposta'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!returnTarget}
        title={returnTarget?.mode === 'reopen' ? 'Devolver para refazer' : 'Não consegui conferir'}
        onClose={() => { if (!returnBusy) setReturnTarget(null); }}
      >
        {returnTarget && (
          <div className="space-y-4">
            <p className="text-xs text-bs-muted">
              {returnTarget.check.sku || 'sem SKU'} · {returnTarget.check.name}
            </p>
            <p className="text-xs text-bs-subtle">
              {returnTarget.mode === 'reopen'
                ? 'A resposta volta para pendente. Goiânia precisa refazer a conferência.'
                : 'Marca o pedido como devolvido e libera o produto para um novo pedido.'}
            </p>
            <label className="text-xs text-bs-muted block">
              Motivo *
              <textarea
                className="bs-input mt-1 text-sm min-h-[80px]"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Ex.: peça não encontrada / foto ilegível / medição errada…"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="bs-btn-secondary text-sm px-4 py-2" disabled={returnBusy} onClick={() => setReturnTarget(null)}>
                Cancelar
              </button>
              <button type="button" className="bs-btn text-sm px-4 py-2" disabled={returnBusy} onClick={() => void submitReturn()}>
                {returnBusy ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!detailCheck}
        title="Detalhes · comentários · histórico"
        onClose={() => setDetailCheck(null)}
      >
        {detailCheck && (
          <div className="space-y-5 max-h-[70vh] overflow-y-auto">
            <div className="text-xs text-bs-muted space-y-1">
              <p className="text-sm font-medium text-bs-text">
                {detailCheck.sku || 'sem SKU'} · {detailCheck.name}
              </p>
              <p>
                Status: {checkStatusLabel(detailCheck.status)}
                {detailCheck.priority === 'urgent' ? ' · Urgente' : ''}
                {formatDueAt(detailCheck.dueAt) ? ` · prazo ${formatDueAt(detailCheck.dueAt)}` : ''}
              </p>
              <p>ID Bling {detailCheck.externalId}</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-bs-text">Comentários</p>
              {commentsBusy && !comments.length ? (
                <p className="text-xs text-bs-muted animate-pulse">Carregando…</p>
              ) : !comments.length ? (
                <p className="text-xs text-bs-subtle">Nenhum comentário ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((cm) => (
                    <li key={cm.id} className="rounded-lg border border-bs-border bg-bs-elevated px-3 py-2 text-xs">
                      <p className="text-bs-text whitespace-pre-wrap">{cm.body}</p>
                      <p className="text-bs-subtle mt-1">
                        {cm.actorName || '—'} · {formatDueAt(cm.createdAt) || '—'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <label className="text-xs text-bs-muted block">
                Novo comentário
                <textarea
                  className="bs-input mt-1 text-sm min-h-[64px]"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Observação para o time…"
                />
              </label>
              <button
                type="button"
                className="bs-btn text-xs px-3 py-1.5"
                disabled={commentsBusy || !commentDraft.trim()}
                onClick={() => void submitComment()}
              >
                Comentar
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-bs-text">Histórico deste produto</p>
              {historyLoading ? (
                <p className="text-xs text-bs-muted animate-pulse">Carregando…</p>
              ) : !historyRows.length ? (
                <p className="text-xs text-bs-subtle">Sem histórico.</p>
              ) : (
                <ul className="space-y-2">
                  {historyRows.map((h) => (
                    <li key={h.id} className="text-xs text-bs-muted border-b border-bs-border pb-2">
                      <span className="font-semibold text-bs-text">{checkStatusLabel(h.status)}</span>
                      {' · '}
                      {formatDueAt(h.requestedAt) || '—'}
                      {h.priority === 'urgent' ? ' · urgente' : ''}
                      {h.returnReason ? ` · devolução: ${h.returnReason}` : ''}
                      {(h.need || []).length ? ` · ${(h.need || []).map(needLabel).join(', ')}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CatalogQualityView;
