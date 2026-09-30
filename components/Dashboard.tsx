import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChatEntity, ScheduledMessage, ConnectionStatus } from '../types';
import { BackendService } from '../services/backendService';
import platformService from '../services/platformService';
import { useToast } from '../contexts/ToastContext';
import SalesDailyChart, { SalesPeriod } from './dashboard/SalesDailyChart';
import StatusDonut from './dashboard/StatusDonut';
import TicketDistribution, {
  TicketBucketKey,
  TICKET_BUCKETS,
  orderInTicketBucket,
  parseOrderTotal,
} from './dashboard/TicketDistribution';
import Sparkline from './dashboard/Sparkline';
import WeekdayPattern from './dashboard/WeekdayPattern';
import TopCustomers from './dashboard/TopCustomers';
import TopProducts from './dashboard/TopProducts';
import PeriodCompare from './dashboard/PeriodCompare';
import GoalCard, { SalesGoal } from './dashboard/GoalCard';
import DayForecastCard, { TodayForecast } from './dashboard/DayForecastCard';
import ChannelScorecard from './dashboard/ChannelScorecard';
import HelpTip from './dashboard/HelpTip';
type StatusCategory = 'atendido' | 'cancelado' | 'aberto';
type OrderSortKey = 'date' | 'total' | 'status' | 'numero';

function matchesStatusCategory(status: string, cat: StatusCategory): boolean {
  const s = String(status || '').toLowerCase();
  if (cat === 'cancelado') return /cancel/.test(s);
  if (cat === 'atendido') return /atendid|conclu|pago|entreg/.test(s);
  return /aberto|andamento|digit|etiqueta|aguard|devolu/.test(s);
}

const PERIOD_KEY = 'nexo_dash_period';

function readStoredPeriod(): SalesPeriod {
  try {
    const v = Number(localStorage.getItem(PERIOD_KEY));
    if (v === 7 || v === 30) return v;
  } catch {
    /* ignore */
  }
  return 30;
}

interface DashboardProps {
  chats: ChatEntity[];
  schedules: ScheduledMessage[];
  backend?: BackendService | null;
  onRefreshSchedules?: () => Promise<void>;
}

const statusLabel: Record<string, string> = {
  pending: 'Pendente',
  paused: 'Pausado',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
};

type ConnLabel = 'connected' | 'disconnected' | 'connecting' | 'unknown';

type SalesBucket = { count: number; revenue: number; avgTicket: number };

type SalesOrderRow = {
  id?: string;
  numero: string;
  contactName: string;
  status: string;
  channel?: string;
  channelLabel?: string;
  channelName?: string;
  total?: number;
  totalLabel: string;
  date: string;
};

type SalesRecent = SalesOrderRow;

function mapConn(status?: ConnectionStatus | string, ready?: boolean): ConnLabel {
  if (ready === true || status === ConnectionStatus.CONNECTED || status === 'CONNECTED') return 'connected';
  if (
    status === ConnectionStatus.CONNECTING
    || status === ConnectionStatus.QR_READY
    || status === ConnectionStatus.PAIRING_CODE_READY
    || status === 'CONNECTING'
    || status === 'QR_READY'
  ) return 'connecting';
  if (ready === false || status === ConnectionStatus.DISCONNECTED || status === 'DISCONNECTED') {
    return 'disconnected';
  }
  return 'unknown';
}

const connBadge: Record<ConnLabel, { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bs-badge-success normal-case' },
  connecting: { label: 'Conectando…', className: 'bs-badge-warning normal-case' },
  disconnected: { label: 'Desconectado', className: 'bs-badge-warning normal-case' },
  unknown: { label: '—', className: 'bs-badge normal-case' },
};

const emptyBucket = (): SalesBucket => ({ count: 0, revenue: 0, avgTicket: 0 });

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDay = (ymd: string) => {
  if (!ymd || ymd.length < 10) return '—';
  return ymd.slice(0, 10).split('-').reverse().join('/');
};

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  const up = value > 0.05;
  const down = value < -0.05;
  const flat = !up && !down;
  const label = flat ? '0%' : `${up ? '+' : ''}${value.toFixed(0)}%`;
  const cls = up
    ? 'text-emerald-600 dark:text-emerald-400'
    : down
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-bs-muted';
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${cls}`}>
      {!flat && <i className={`fa-solid fa-arrow-${up ? 'up' : 'down'} mr-0.5 text-[9px]`} />}
      {label}
    </span>
  );
}

function blingStatusBadgeClass(status: string): string {
  const s = String(status || '').toLowerCase();
  if (/atendid|conclu|pago|entreg/.test(s)) return 'bs-badge-success normal-case text-[10px]';
  if (/cancel/.test(s)) return 'bs-badge normal-case text-[10px] opacity-80';
  if (/aberto|digit|etiqueta|aguard|devolu|andamento/.test(s)) return 'bs-badge-warning normal-case text-[10px]';
  return 'bs-badge normal-case text-[10px]';
}

function channelBadgeClass(channel?: string): string {
  const c = String(channel || '').toLowerCase();
  if (c === 'woocommerce') return 'bs-badge-accent normal-case text-[10px]';
  if (c === 'frente_caixa') return 'bs-badge-warning normal-case text-[10px]';
  if (c === 'manual') return 'bs-badge normal-case text-[10px]';
  if (c === 'tiktok') return 'bs-badge-danger normal-case text-[10px]';
  return 'bs-badge normal-case text-[10px]';
}

const Dashboard: React.FC<DashboardProps> = ({ schedules, backend, onRefreshSchedules }) => {
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendInProgress, setSendInProgress] = useState(false);
  const [dispatchPaused, setDispatchPaused] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchConn, setDispatchConn] = useState<ConnLabel>('unknown');
  const [ecommerceConn, setEcommerceConn] = useState<ConnLabel>('unknown');
  const [blingConnected, setBlingConnected] = useState(false);
  const [salesToday, setSalesToday] = useState<SalesBucket>(emptyBucket());
  const [salesYesterday, setSalesYesterday] = useState<SalesBucket>(emptyBucket());
  const [salesWeek, setSalesWeek] = useState<SalesBucket>(emptyBucket());
  const [salesMonth30, setSalesMonth30] = useState<SalesBucket>(emptyBucket());
  const [salesMonth, setSalesMonth] = useState<SalesBucket>(emptyBucket());
  const [salesPrevMonth, setSalesPrevMonth] = useState<SalesBucket>(emptyBucket());
  const [byStatus, setByStatus] = useState<Array<{ status: string; count: number; revenue: number }>>([]);
  const [byChannel, setByChannel] = useState<Array<{
    channel: string;
    channelLabel: string;
    channelName?: string;
    count: number;
    revenue: number;
    avgTicket?: number;
  }>>([]);
  const [daily, setDaily] = useState<Array<{
    date: string;
    count: number;
    revenue: number;
    prevRevenue?: number;
    prevCount?: number;
    prevDate?: string;
  }>>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRow[]>([]);
  const [openOrders, setOpenOrders] = useState(0);
  const [topProducts, setTopProducts] = useState<Array<{
    name: string;
    codigo?: string | null;
    qty: number;
    revenue: number;
    orders: number;
  }>>([]);
  const [topProductsSampled, setTopProductsSampled] = useState(0);
  const [salesGoal, setSalesGoal] = useState<SalesGoal | null>(null);
  const [todayForecast, setTodayForecast] = useState<TodayForecast | null>(null);
  const [salesFetchedAt, setSalesFetchedAt] = useState<number | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<SalesPeriod>(() => readStoredPeriod());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [statusCategory, setStatusCategory] = useState<StatusCategory | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderLimit, setOrderLimit] = useState(20);
  const [ticketBucket, setTicketBucket] = useState<TicketBucketKey | null>(null);
  const [orderSort, setOrderSort] = useState<{ key: OrderSortKey; dir: 'asc' | 'desc' }>({
    key: 'date',
    dir: 'desc',
  });
  const { showToast } = useToast();

  const clearOrderFilters = useCallback(() => {
    setSelectedDay(null);
    setSelectedStatus(null);
    setSelectedChannel(null);
    setStatusCategory(null);
    setOrderSearch('');
    setTicketBucket(null);
    setOrderLimit(20);
  }, []);

  const toggleSort = useCallback((key: OrderSortKey) => {
    setOrderSort((prev) => (
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'total' || key === 'date' ? 'desc' : 'asc' }
    ));
  }, []);

  const selectExactStatus = useCallback((status: string | null) => {
    setSelectedStatus(status);
    setStatusCategory(null);
    setOrderLimit(20);
  }, []);

  const selectChannel = useCallback((channel: string | null) => {
    setSelectedChannel(channel);
    setOrderLimit(20);
  }, []);

  const selectStatusCategory = useCallback((cat: StatusCategory) => {
    setStatusCategory((prev) => (prev === cat ? null : cat));
    setSelectedStatus(null);
    setOrderLimit(20);
  }, []);

  const setPeriod = useCallback((p: SalesPeriod) => {
    setChartPeriod(p);
    setSelectedDay(null);
    setSelectedStatus(null);
    setSelectedChannel(null);
    setStatusCategory(null);
    setTicketBucket(null);
    setOrderLimit(20);
    try {
      localStorage.setItem(PERIOD_KEY, String(p));
    } catch {
      /* ignore */
    }
  }, []);

  const uniqueSchedules = useMemo(() => {
    const map = new Map<string, ScheduledMessage>();
    schedules.forEach((s) => map.set(s.id, s));
    const list = Array.from(map.values());
    const pendingStatuses = ['pending', 'paused', 'sending'];
    return list.sort((a, b) => {
      const aPending = pendingStatuses.includes(a.status);
      const bPending = pendingStatuses.includes(b.status);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      const aTime = new Date(a.scheduledAt).getTime();
      const bTime = new Date(b.scheduledAt).getTime();
      if (aPending) return aTime - bTime;
      return bTime - aTime;
    });
  }, [schedules]);

  const pendingSchedules = uniqueSchedules.filter((s) => s.status === 'pending').length;
  const visibleSchedules = uniqueSchedules.slice(0, 10);

  const applySales = useCallback((sales: Awaited<ReturnType<typeof platformService.getSalesSummary>>) => {
    if (!sales) return;
    setBlingConnected(!!sales.connected);
    setSalesToday(sales.today || emptyBucket());
    setSalesYesterday(sales.yesterday || emptyBucket());
    setSalesWeek(sales.last7Days || emptyBucket());
    setSalesMonth30(sales.last30Days || emptyBucket());
    setSalesMonth(sales.month || emptyBucket());
    setSalesPrevMonth(sales.prevMonth || emptyBucket());
    setByStatus(sales.byStatus || []);
    setByChannel(sales.byChannel || []);
    setDaily(sales.daily || []);
    const orders = (sales.orders?.length ? sales.orders : sales.recent || []) as SalesOrderRow[];
    setSalesOrders(orders);
    setOpenOrders(Number(sales.openOrders) || 0);
    setTopProducts(sales.topProducts || []);
    setTopProductsSampled(Number(sales.topProductsSampled) || 0);
    setSalesGoal(sales.goal || null);
    setTodayForecast(sales.todayForecast || null);
    setSalesFetchedAt(sales.fetchedAt || Date.now());
    setSalesError(sales.error || null);
  }, []);

  const saveMonthlyGoal = useCallback(async (monthlyGoal: number) => {
    try {
      await platformService.setSalesDashboardConfig({ monthlyGoal });
      setSalesLoading(true);
      const sales = await platformService.getSalesSummary(true);
      applySales(sales);
      showToast(monthlyGoal > 0 ? 'Meta do mês salva.' : 'Meta removida.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar meta.', 'error');
      throw e;
    } finally {
      setSalesLoading(false);
    }
  }, [applySales, showToast]);

  useEffect(() => {
    if (!backend) return;
    const poll = async () => {
      try {
        const statusData = await backend.getStatus();
        setSendInProgress(!!statusData.sendInProgress);
        setDispatchPaused(!!statusData.dispatchPaused);
        const d = statusData.instances?.dispatch;
        const e = statusData.instances?.ecommerce as
          | { status?: ConnectionStatus; ready?: boolean }
          | undefined;
        setDispatchConn(mapConn(d?.status || statusData.status, d?.ready));
        setEcommerceConn(mapConn(e?.status, e?.ready));
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    const loadSales = async () => {
      try {
        const sales = await platformService.getSalesSummary();
        if (!cancelled) applySales(sales);
      } catch (e) {
        if (!cancelled) {
          setSalesError(e instanceof Error ? e.message : 'Erro ao carregar vendas');
        }
      } finally {
        if (!cancelled) setSalesLoading(false);
      }
    };
    loadSales();
    const id = window.setInterval(loadSales, 60000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [backend, applySales]);

  const periodCutoff = useMemo(() => {
    if (!daily.length) return '';
    const slice = daily.slice(-chartPeriod);
    return slice[0]?.date || '';
  }, [daily, chartPeriod]);

  const periodOrders = useMemo(() => {
    if (!periodCutoff) return salesOrders;
    return salesOrders.filter((o) => o.date && o.date >= periodCutoff);
  }, [salesOrders, periodCutoff]);

  const periodByStatus = useMemo(() => {
    if (chartPeriod >= 30 && !selectedDay && !selectedChannel) return byStatus;
    const source = selectedDay
      ? salesOrders.filter((o) => o.date === selectedDay)
      : periodOrders;
    const map = new Map<string, { count: number; revenue: number }>();
    for (const o of source) {
      if (selectedChannel && (o.channel || 'manual') !== selectedChannel) continue;
      const key = o.status || 'Sem status';
      const cur = map.get(key) || { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(o.total) || 0;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([status, b]) => ({
        status,
        count: b.count,
        revenue: Math.round(b.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [byStatus, chartPeriod, selectedDay, selectedChannel, salesOrders, periodOrders]);

  const periodByChannel = useMemo(() => {
    if (chartPeriod >= 30 && !selectedDay && !selectedStatus && !statusCategory) {
      return byChannel;
    }
    const source = selectedDay
      ? salesOrders.filter((o) => o.date === selectedDay)
      : periodOrders;
    const map = new Map<string, { channel: string; channelLabel: string; channelName?: string; count: number; revenue: number }>();
    for (const o of source) {
      if (selectedStatus && (o.status || 'Sem status') !== selectedStatus) continue;
      if (statusCategory && !matchesStatusCategory(o.status, statusCategory)) continue;
      // Cancelados não entram no scorecard de origem (salvo se o filtro for cancelado)
      if (
        statusCategory !== 'cancelado'
        && !/cancel/i.test(String(selectedStatus || ''))
        && /cancel/i.test(String(o.status || ''))
      ) continue;
      const channel = o.channel || 'manual';
      const channelLabel = o.channelLabel || 'Manual';
      const cur = map.get(channel) || {
        channel,
        channelLabel,
        channelName: o.channelName,
        count: 0,
        revenue: 0,
      };
      cur.count += 1;
      cur.revenue += Number(o.total) || 0;
      map.set(channel, cur);
    }
    return [...map.values()]
      .map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [byChannel, chartPeriod, selectedDay, selectedStatus, statusCategory, salesOrders, periodOrders]);

  const scopedOrders = useMemo(() => {
    let base = selectedDay
      ? salesOrders.filter((o) => o.date === selectedDay)
      : periodOrders;
    if (selectedStatus) {
      base = base.filter((o) => (o.status || 'Sem status') === selectedStatus);
    } else if (statusCategory) {
      base = base.filter((o) => matchesStatusCategory(o.status, statusCategory));
    }
    if (selectedChannel) {
      base = base.filter((o) => (o.channel || 'manual') === selectedChannel);
    }
    const q = orderSearch.trim().toLowerCase();
    if (q) {
      base = base.filter((o) => {
        const hay = `${o.numero} ${o.contactName || ''} ${o.status || ''} ${o.channelLabel || ''} ${o.channelName || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return base;
  }, [salesOrders, periodOrders, selectedDay, selectedStatus, statusCategory, selectedChannel, orderSearch]);

  const filteredOrders = useMemo(() => {
    let base = scopedOrders;
    if (ticketBucket) {
      base = base.filter((o) => orderInTicketBucket(parseOrderTotal(o), ticketBucket));
    }
    const dir = orderSort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (orderSort.key === 'total') {
        return (parseOrderTotal(a) - parseOrderTotal(b)) * dir;
      }
      if (orderSort.key === 'status') {
        return String(a.status || '').localeCompare(String(b.status || ''), 'pt-BR') * dir;
      }
      if (orderSort.key === 'numero') {
        return String(a.numero || '').localeCompare(String(b.numero || ''), 'pt-BR', { numeric: true }) * dir;
      }
      return String(a.date || '').localeCompare(String(b.date || '')) * dir
        || String(b.numero || '').localeCompare(String(a.numero || ''), 'pt-BR', { numeric: true });
    });
  }, [scopedOrders, ticketBucket, orderSort]);

  const visibleOrders = useMemo(
    () => filteredOrders.slice(0, orderLimit),
    [filteredOrders, orderLimit],
  );
  const hasMoreOrders = filteredOrders.length > visibleOrders.length;

  const periodTotals = useMemo(() => {
    const slice = daily.slice(-chartPeriod);
    const revenue = slice.reduce((s, d) => s + d.revenue, 0);
    const count = slice.reduce((s, d) => s + d.count, 0);
    return {
      revenue: Math.round(revenue * 100) / 100,
      count,
      avgTicket: count ? Math.round((revenue / count) * 100) / 100 : 0,
    };
  }, [daily, chartPeriod]);

  const peakDays = useMemo(() => {
    const slice = daily.slice(-chartPeriod).filter((d) => d.revenue > 0 || d.count > 0);
    if (!slice.length) return null;
    const best = slice.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    const worst = slice.reduce((a, b) => (b.revenue < a.revenue ? b : a));
    const avg = slice.reduce((s, d) => s + d.revenue, 0) / slice.length;
    return { best, worst, avg };
  }, [daily, chartPeriod]);

  const weekSpark = useMemo(
    () => daily.slice(-7).map((d) => d.revenue),
    [daily],
  );
  const monthSpark = useMemo(
    () => daily.slice(-30).map((d) => d.revenue),
    [daily],
  );

  const healthStats = useMemo(() => {
    const source = selectedDay
      ? salesOrders.filter((o) => o.date === selectedDay)
      : periodOrders;
    const total = source.length || 0;
    let atendido = 0;
    let cancelado = 0;
    let aberto = 0;
    for (const o of source) {
      const s = String(o.status || '').toLowerCase();
      if (/cancel/.test(s)) cancelado += 1;
      else if (/atendid|conclu|pago|entreg/.test(s)) atendido += 1;
      else if (/aberto|andamento|digit|etiqueta|aguard|devolu/.test(s)) aberto += 1;
    }
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return {
      total,
      atendido,
      cancelado,
      aberto,
      atendidoPct: pct(atendido),
      canceladoPct: pct(cancelado),
      abertoPct: pct(aberto),
    };
  }, [periodOrders, salesOrders, selectedDay]);

  const ticketOrders = scopedOrders;

  const staleOpenOrders = useMemo(() => {
    const cutoff = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();
    return salesOrders.filter((o) => {
      if (!o.date || o.date > cutoff) return false;
      return matchesStatusCategory(o.status, 'aberto');
    }).length;
  }, [salesOrders]);

  const alerts = useMemo(() => {
    const list: Array<{ tone: 'warn' | 'danger' | 'info'; text: string }> = [];
    if (dispatchConn === 'disconnected') {
      list.push({ tone: 'danger', text: 'WhatsApp Disparo desconectado — envios e PDD podem falhar.' });
    } else if (dispatchConn === 'connecting') {
      list.push({ tone: 'warn', text: 'WhatsApp Disparo reconectando…' });
    }
    if (!blingConnected) {
      list.push({ tone: 'warn', text: 'Bling offline — faturamento do dash pode estar desatualizado.' });
    }
    if (dispatchPaused) {
      list.push({ tone: 'warn', text: 'Parada de emergência ativa — disparos bloqueados.' });
    }
    if (staleOpenOrders > 0) {
      list.push({
        tone: 'warn',
        text: `${staleOpenOrders} pedido(s) em aberto / andamento com mais de 7 dias.`,
      });
    } else if (openOrders > 0) {
      list.push({
        tone: 'info',
        text: `${openOrders} pedido(s) em aberto / andamento nos últimos 30 dias.`,
      });
    }
    if (pendingSchedules > 0) {
      list.push({ tone: 'info', text: `${pendingSchedules} agendamento(s) pendente(s) na fila.` });
    }
    return list;
  }, [dispatchConn, blingConnected, dispatchPaused, openOrders, pendingSchedules, staleOpenOrders]);

  const weekVsPrev = useMemo(() => {
    if (daily.length < 14) return null;
    const last7 = daily.slice(-7);
    const prev7 = daily.slice(-14, -7);
    const cur = last7.reduce((s, d) => s + d.revenue, 0);
    const prev = prev7.reduce((s, d) => s + d.revenue, 0);
    return pctDelta(cur, prev);
  }, [daily]);

  const monthVsPrevHalf = useMemo(() => {
    if (daily.length < 30) return null;
    const last15 = daily.slice(-15);
    const prev15 = daily.slice(-30, -15);
    const cur = last15.reduce((s, d) => s + d.revenue, 0);
    const prev = prev15.reduce((s, d) => s + d.revenue, 0);
    return pctDelta(cur, prev);
  }, [daily]);

  const todayDelta = pctDelta(salesToday.revenue, salesYesterday.revenue);

  const exportCsv = () => {
    const rows = filteredOrders;
    if (!rows.length) {
      showToast('Nenhum pedido para exportar neste filtro.', 'info');
      return;
    }
    const header = ['data', 'numero', 'cliente', 'status', 'total'];
    const lines = [
      header.join(';'),
      ...rows.map((o) =>
        [
          o.date || '',
          o.numero || '',
          `"${String(o.contactName || '').replace(/"/g, '""')}"`,
          `"${String(o.status || '').replace(/"/g, '""')}"`,
          String(o.total ?? '').replace('.', ','),
        ].join(';'),
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tag = [selectedDay, selectedStatus, `${chartPeriod}d`].filter(Boolean).join('-');
    a.download = `vendas-bling-${tag || 'periodo'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} pedido(s) exportado(s).`, 'success');
  };

  const heroStats = [
    {
      label: 'Faturamento hoje',
      help: 'Soma em R$ dos pedidos de hoje.',
      value: formatBrl(salesToday.revenue),
      sub: `${salesToday.count} pedido(s)`,
      delta: todayDelta,
      deltaHint: 'vs ontem',
      spark: weekSpark.slice(-7),
    },
    {
      label: 'Ontem',
      help: 'Faturamento total do dia de ontem.',
      value: formatBrl(salesYesterday.revenue),
      sub: `${salesYesterday.count} pedido(s)`,
      delta: null as number | null,
      deltaHint: '',
      spark: null as number[] | null,
    },
    {
      label: 'Últimos 7 dias',
      help: 'Soma dos últimos 7 dias. O % compara com os 7 dias anteriores.',
      value: formatBrl(salesWeek.revenue),
      sub: `${salesWeek.count} pedido(s)`,
      delta: weekVsPrev,
      deltaHint: 'vs 7d ant.',
      spark: weekSpark,
    },
    {
      label: 'Mês atual',
      help: 'Faturamento desde o dia 1º deste mês até agora.',
      value: formatBrl(salesMonth.revenue),
      sub: `${salesMonth.count} pedido(s)`,
      delta: monthVsPrevHalf,
      deltaHint: 'quinzena',
      spark: monthSpark,
    },
  ];

  const detailStats = [
    { label: 'Ticket médio (hoje)', help: 'Valor médio por pedido hoje (faturamento ÷ pedidos).', value: formatBrl(salesToday.avgTicket) },
    { label: `Ticket médio (${chartPeriod}d)`, help: 'Valor médio por pedido no período selecionado.', value: formatBrl(periodTotals.avgTicket) },
    { label: `Pedidos ${chartPeriod}d`, help: 'Quantidade de pedidos no período.', value: String(periodTotals.count) },
    { label: `Faturamento ${chartPeriod}d`, help: 'Soma em R$ dos pedidos no período.', value: formatBrl(periodTotals.revenue) },
    { label: 'Agendamentos na fila', help: 'Mensagens WhatsApp agendadas ainda pendentes de envio.', value: String(pendingSchedules) },
    {
      label: 'Disparo',
      help: 'Status da conexão WhatsApp usada para envios em massa.',
      value: dispatchPaused ? 'Pausado' : (sendInProgress ? 'Enviando' : connBadge[dispatchConn].label),
    },
  ];

  const formatScheduledAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const scheduleStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending': return 'bs-badge-accent';
      case 'paused': return 'bs-badge-warning';
      case 'sending': return 'bs-badge-accent';
      case 'sent': return 'bs-badge-success';
      case 'failed': return 'bs-badge-danger';
      default: return 'bs-badge-accent';
    }
  };

  const handleStopAll = async () => {
    if (!backend) return;
    if (!confirm('Parar todos os disparos? Agendamentos pendentes serão pausados e o envio em andamento será cancelado.')) return;
    setDispatchBusy(true);
    try {
      const r = await backend.stopAllDispatches();
      setDispatchPaused(true);
      await onRefreshSchedules?.();
      showToast(`Parada de emergência ativa. ${r.paused || 0} agendamento(s) pausado(s).`, 'info');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao parar disparos.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  const handleResumeDispatches = async (unpauseSchedules: boolean) => {
    if (!backend) return;
    setDispatchBusy(true);
    try {
      await backend.resumeDispatches({ unpauseSchedules });
      setDispatchPaused(false);
      await onRefreshSchedules?.();
      showToast(unpauseSchedules ? 'Disparos e agendamentos reativados.' : 'Disparos reativados.', 'success');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao reativar.', 'error');
    } finally {
      setDispatchBusy(false);
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

  const handlePause = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules) return;
    setActionId(s.id);
    try {
      await backend.updateScheduleStatus(s.id, 'paused');
      await onRefreshSchedules();
      showToast('Agendamento pausado.', 'info');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao pausar.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleResume = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules) return;
    setActionId(s.id);
    try {
      await backend.updateScheduleStatus(s.id, 'pending');
      await onRefreshSchedules();
      showToast('Agendamento reativado.', 'success');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao reativar.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules) return;
    if (!confirm('Excluir este agendamento?')) return;
    setActionId(s.id);
    try {
      await backend.deleteSchedule(s.id);
      await onRefreshSchedules();
      showToast('Agendamento excluído.', 'info');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao excluir.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDeleteSelected = async () => {
    if (!backend || !onRefreshSchedules || selectedIds.size === 0) return;
    if (!confirm(`Excluir ${selectedIds.size} agendamento(s)?`)) return;
    setActionId('bulk');
    try {
      for (const id of selectedIds) {
        await backend.deleteSchedule(id);
      }
      setSelectedIds(new Set());
      await onRefreshSchedules();
      showToast('Agendamentos excluídos.', 'info');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao excluir.', 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="bs-page-title">Vendas & Controles</h2>
          <p className="bs-page-desc mt-1">
            Faturamento Bling, status das conexões e fila de disparo.
            {salesFetchedAt ? (
              <span className="text-bs-subtle">
                {' · '}atualizado{' '}
                {new Date(salesFetchedAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-bs-border overflow-hidden text-xs">
            {([7, 30] as SalesPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-2 font-semibold transition-colors ${
                  chartPeriod === p
                    ? 'bg-bs-accent text-white'
                    : 'bg-bs-elevated text-bs-muted hover:text-bs-text'
                }`}
              >
                {p} dias
              </button>
            ))}
          </div>
          <button
            type="button"
            className="bs-btn-secondary text-xs py-2 px-3"
            onClick={exportCsv}
            disabled={!periodOrders.length}
          >
            <i className="fa-solid fa-file-csv mr-1.5" />
            CSV
          </button>
          <button
            type="button"
            className="bs-btn-secondary text-xs py-2 px-3"
            onClick={() => {
              setSalesLoading(true);
              platformService.getSalesSummary(true)
                .then((sales) => applySales(sales))
                .catch((e) => setSalesError(e instanceof Error ? e.message : 'Erro'))
                .finally(() => setSalesLoading(false));
            }}
          >
            <i className={`fa-solid fa-arrows-rotate mr-1.5 ${salesLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={a.text}
              className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
                a.tone === 'danger'
                  ? 'border-rose-400/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                  : a.tone === 'warn'
                    ? 'border-amber-400/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                    : 'border-bs-accent/30 bg-bs-accent/5 text-bs-text'
              }`}
            >
              <i className={`fa-solid ${a.tone === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'} mr-2`} />
              {a.text}
            </div>
          ))}
        </div>
      )}

      {/* Controles / conexões */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bs-card p-4 flex items-center gap-3">
          <i className="fa-brands fa-whatsapp text-xl text-bs-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase text-bs-muted font-semibold">WhatsApp Disparo</p>
            <p className="text-sm font-semibold text-bs-text">Palavra do Dia</p>
          </div>
          <span className={connBadge[dispatchConn].className}>{connBadge[dispatchConn].label}</span>
        </div>
        <div className="bs-card p-4 flex items-center gap-3">
          <i className="fa-brands fa-meta text-xl text-bs-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase text-bs-muted font-semibold">Cloud API</p>
            <p className="text-sm font-semibold text-bs-text">E-commerce</p>
          </div>
          <span className={connBadge[ecommerceConn].className}>{connBadge[ecommerceConn].label}</span>
        </div>
        <div className="bs-card p-4 flex items-center gap-3">
          <i className="fa-solid fa-boxes-stacked text-xl text-bs-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase text-bs-muted font-semibold">ERP</p>
            <p className="text-sm font-semibold text-bs-text">Bling</p>
          </div>
          <span className={blingConnected ? 'bs-badge-success normal-case' : 'bs-badge-warning normal-case'}>
            {blingConnected ? 'Conectado' : 'Off'}
          </span>
        </div>
      </div>

      {dispatchPaused && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
              <i className="fa-solid fa-triangle-exclamation mr-2" />
              Parada de emergência ativa
            </p>
            <p className="text-xs text-bs-muted mt-0.5">Disparos bloqueados. Checkpoint preservado.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="bs-btn-secondary text-xs py-2 px-3" disabled={dispatchBusy} onClick={() => void handleResumeDispatches(false)}>
              Reativar disparos
            </button>
            <button type="button" className="bs-btn text-xs py-2 px-3" disabled={dispatchBusy} onClick={() => void handleResumeDispatches(true)}>
              Reativar tudo
            </button>
          </div>
        </div>
      )}

      {!dispatchPaused && backend && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleStopAll()}
            disabled={dispatchBusy}
            className="text-xs font-semibold px-3 py-2 rounded-md border border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"
          >
            <i className="fa-solid fa-hand mr-1.5" />
            Parar disparos
          </button>
        </div>
      )}

      {/* Faturamento */}
      <div>
        <h3 className="text-sm font-bold text-bs-text mb-3 inline-flex items-center gap-1.5">
          <i className="fa-solid fa-chart-line text-bs-accent" />
          Faturamento
          <HelpTip text="Faturamento = total em R$ das vendas (soma dos pedidos). Não é lucro — ainda não desconta custos nem taxas." />
        </h3>
        {!blingConnected && (
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
            Conecte o Bling em <strong>Configurações → Integrações</strong> para ver vendas reais.
            {salesError ? ` (${salesError})` : ''}
          </p>
        )}
        {salesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bs-card p-5 animate-pulse">
                <div className="h-3 w-24 rounded bg-bs-elevated" />
                <div className="h-7 w-32 rounded bg-bs-elevated mt-3" />
                <div className="h-3 w-20 rounded bg-bs-elevated mt-3" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {heroStats.map((s) => (
                <div key={s.label} className="bs-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
                      {s.label}
                      {s.help ? <HelpTip text={s.help} /> : null}
                    </p>
                    {s.delta != null && (
                      <span className="flex items-center gap-1" title={s.deltaHint}>
                        <DeltaBadge value={s.delta} />
                      </span>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-2 mt-1">
                    <p className="text-2xl font-bold text-bs-text tabular-nums">{s.value}</p>
                    {s.spark && s.spark.length > 1 && (
                      <Sparkline values={s.spark} className="w-16 h-7 opacity-80 shrink-0 mb-0.5" />
                    )}
                  </div>
                  <p className="text-xs text-bs-muted mt-1">
                    {s.sub}
                    {s.delta != null && s.deltaHint ? (
                      <span className="text-bs-subtle"> · {s.deltaHint}</span>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
              {detailStats.map((s) => (
                <div key={s.label} className="bs-card p-4">
                  <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold truncate inline-flex items-center gap-1 max-w-full">
                    <span className="truncate">{s.label}</span>
                    {s.help ? <HelpTip text={s.help} className="shrink-0" /> : null}
                  </p>
                  <p className="text-lg font-bold text-bs-text tabular-nums mt-1 truncate">{s.value}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Meta + previsão (inspirado Power BI) */}
      {!salesLoading && blingConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <GoalCard
            goal={salesGoal}
            prevMonthRevenue={salesPrevMonth.revenue}
            onSaveGoal={saveMonthlyGoal}
          />
          <DayForecastCard
            forecast={todayForecast}
            yesterdayRevenue={salesYesterday.revenue}
          />
        </div>
      )}

      {/* Saúde do funil */}
      {!salesLoading && healthStats.total > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => selectStatusCategory('atendido')}
            className={`bs-card p-4 text-left transition-shadow hover:shadow-card ${
              statusCategory === 'atendido' ? 'ring-2 ring-emerald-500/50' : ''
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
              Taxa atendido
              <HelpTip text="% de pedidos já finalizados/atendidos no período. Clique para filtrar a lista." />
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
              {healthStats.atendidoPct}%
            </p>
            <p className="text-xs text-bs-muted mt-1">{healthStats.atendido} de {healthStats.total}</p>
          </button>
          <button
            type="button"
            onClick={() => selectStatusCategory('cancelado')}
            className={`bs-card p-4 text-left transition-shadow hover:shadow-card ${
              statusCategory === 'cancelado' ? 'ring-2 ring-rose-500/50' : ''
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
              Taxa cancelado
              <HelpTip text="% de pedidos cancelados. Clique para filtrar a lista." />
            </p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-1">
              {healthStats.canceladoPct}%
            </p>
            <p className="text-xs text-bs-muted mt-1">{healthStats.cancelado} de {healthStats.total}</p>
          </button>
          <button
            type="button"
            onClick={() => selectStatusCategory('aberto')}
            className={`bs-card p-4 text-left transition-shadow hover:shadow-card ${
              statusCategory === 'aberto' ? 'ring-2 ring-amber-500/50' : ''
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
              Em aberto / andamento
              <HelpTip text="% de pedidos ainda não finalizados (em digitação, aguardando, etc.). Clique para filtrar." />
            </p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
              {healthStats.abertoPct}%
            </p>
            <p className="text-xs text-bs-muted mt-1">{healthStats.aberto} pedido(s)</p>
          </button>
          <div className="bs-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
              Ticket médio {selectedDay ? formatDay(selectedDay) : `${chartPeriod}d`}
              <HelpTip text="Valor médio por pedido no filtro atual (faturamento ÷ pedidos)." />
            </p>
            <p className="text-2xl font-bold text-bs-text tabular-nums mt-1">
              {formatBrl(
                ticketOrders.length
                  ? ticketOrders.reduce((s, o) => s + (Number(o.total) || 0), 0) / ticketOrders.length
                  : 0,
              )}
            </p>
            <p className="text-xs text-bs-muted mt-1">{ticketOrders.length} com valor</p>
          </div>
        </div>
      )}

      {peakDays && !salesLoading && (
        <div className="bs-card px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-bs-muted font-semibold uppercase tracking-wide text-[10px]">Destaques {chartPeriod}d</span>
            <button
              type="button"
              className="text-bs-text hover:text-bs-accent"
              onClick={() => { setSelectedDay(peakDays.best.date); selectExactStatus(null); setOrderLimit(20); }}
              title="Filtrar pedidos deste dia"
            >
              <i className="fa-solid fa-arrow-trend-up text-emerald-500 mr-1.5" />
              Melhor dia <strong>{formatDay(peakDays.best.date)}</strong>
              {' · '}
              <span className="tabular-nums font-semibold">{formatBrl(peakDays.best.revenue)}</span>
              <span className="text-bs-muted"> ({peakDays.best.count} ped.)</span>
            </button>
            {peakDays.worst.date !== peakDays.best.date && (
              <button
                type="button"
                className="text-bs-text hover:text-bs-accent"
                onClick={() => { setSelectedDay(peakDays.worst.date); selectExactStatus(null); setOrderLimit(20); }}
              >
                <i className="fa-solid fa-arrow-trend-down text-rose-400 mr-1.5" />
                Menor dia <strong>{formatDay(peakDays.worst.date)}</strong>
                {' · '}
                <span className="tabular-nums">{formatBrl(peakDays.worst.revenue)}</span>
              </button>
            )}
          </div>
          <span className="text-bs-muted tabular-nums">
            Média diária {formatBrl(peakDays.avg)}
          </span>
        </div>
      )}

      {/* Gráficos */}
      {daily.length > 0 && (
        <SalesDailyChart
          daily={daily}
          period={chartPeriod}
          hidePeriodToggle
          selectedDate={selectedDay}
          onDaySelect={(d) => {
            setSelectedDay(d);
            setOrderLimit(20);
            if (d) selectExactStatus(null);
          }}
        />
      )}

      {(periodByStatus.length > 0 || periodByChannel.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {periodByStatus.length > 0 && (
            <StatusDonut
              rows={periodByStatus}
              title={`Por status (${selectedDay ? formatDay(selectedDay) : `${chartPeriod}d`})`}
              selectedStatus={selectedStatus}
              onStatusSelect={selectExactStatus}
            />
          )}
          {periodByChannel.length > 0 ? (
            <ChannelScorecard
              rows={periodByChannel}
              title={`Por origem (${selectedDay ? formatDay(selectedDay) : `${chartPeriod}d`})`}
              selectedChannel={selectedChannel}
              onSelect={selectChannel}
            />
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TicketDistribution
          orders={ticketOrders}
          periodLabel={
            selectedStatus
              ? selectedStatus
              : statusCategory
                ? ({ atendido: 'Atendido', cancelado: 'Cancelado', aberto: 'Em aberto' } as const)[statusCategory]
                : selectedDay
                  ? formatDay(selectedDay)
                  : `${chartPeriod} dias`
          }
          selectedBucket={ticketBucket}
          onBucketSelect={(key) => {
            setTicketBucket(key);
            setOrderLimit(20);
          }}
        />
        {daily.length > 0 && (
          <>
            <PeriodCompare daily={daily} half={chartPeriod === 7 ? 7 : 15} />
            <WeekdayPattern daily={daily} period={chartPeriod} />
          </>
        )}
      </div>

      {daily.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopCustomers
            orders={ticketOrders}
            periodLabel={
              selectedStatus
                ? selectedStatus
                : statusCategory
                  ? ({ atendido: 'Atendido', cancelado: 'Cancelado', aberto: 'Em aberto' } as const)[statusCategory]
                  : selectedDay
                    ? formatDay(selectedDay)
                    : `${chartPeriod} dias`
            }
            selectedCustomer={orderSearch.trim() || null}
            onSelectCustomer={(name) => {
              setOrderSearch(name);
              setOrderLimit(20);
            }}
          />
          <TopProducts
            products={topProducts}
            sampled={topProductsSampled}
            periodLabel="amostra 30d · excl. cancelados"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <div className="bs-table-wrap">
          <div className="bs-table-toolbar flex-wrap gap-2">
            <h3 className="font-bold text-bs-text text-sm">
              Pedidos
              {selectedDay ? ` · ${formatDay(selectedDay)}` : ` · ${chartPeriod}d`}
              {selectedStatus ? ` · ${selectedStatus}` : ''}
              {statusCategory && !selectedStatus
                ? ` · ${({ atendido: 'Atendido', cancelado: 'Cancelado', aberto: 'Em aberto' } as const)[statusCategory]}`
                : ''}
              {selectedChannel
                ? ` · ${periodByChannel.find((c) => c.channel === selectedChannel)?.channelLabel || selectedChannel}`
                : ''}
              {ticketBucket
                ? ` · ${TICKET_BUCKETS.find((b) => b.key === ticketBucket)?.label || ticketBucket}`
                : ''}
            </h3>
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              <input
                type="search"
                value={orderSearch}
                onChange={(e) => { setOrderSearch(e.target.value); setOrderLimit(20); }}
                placeholder="Buscar nº, cliente…"
                className="bs-input text-xs py-1.5 px-2.5 w-40 sm:w-52"
              />
              {(selectedDay || selectedStatus || statusCategory || selectedChannel || orderSearch || ticketBucket) && (
                <button
                  type="button"
                  className="text-[11px] bs-link-accent font-semibold"
                  onClick={clearOrderFilters}
                >
                  Limpar filtros
                </button>
              )}
              <span className="text-xs text-bs-muted">
                {visibleOrders.length}
                {filteredOrders.length !== visibleOrders.length
                  ? ` de ${filteredOrders.length}`
                  : ` pedido(s)`}
              </span>
            </div>
          </div>
          {salesLoading ? (
            <div className="p-4 space-y-3 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded bg-bs-elevated" />
              ))}
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="bs-table-empty text-sm">Nenhum pedido neste filtro.</div>
          ) : (
            <>
              <table className="bs-table">
                <thead className="bs-table-head">
                  <tr>
                    {([
                      { key: 'numero' as const, label: 'Nº', align: 'left' },
                      { key: 'date' as const, label: 'Cliente / data', align: 'left' },
                      { key: 'status' as const, label: 'Status', align: 'left' },
                      { key: 'total' as const, label: 'Total', align: 'right' },
                    ]).map((col) => (
                        <th key={col.key} className={col.align === 'right' ? 'text-right' : undefined}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-semibold hover:text-bs-accent"
                            onClick={() => toggleSort(col.key)}
                          >
                            {col.label}
                            {orderSort.key === col.key ? (
                              <i className={`fa-solid fa-sort-${orderSort.dir === 'asc' ? 'up' : 'down'} text-[9px]`} />
                            ) : (
                              <i className="fa-solid fa-sort text-[9px] opacity-40" />
                            )}
                          </button>
                        </th>
                    ))}
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((o) => (
                    <tr key={`${o.id || o.numero}-${o.date}`} className="bs-table-row">
                      <td className="font-mono text-xs">#{o.numero}</td>
                      <td className="truncate max-w-[220px]">
                        <span className="block truncate">{o.contactName || '—'}</span>
                        <span className="text-[10px] text-bs-muted">{formatDay(o.date)}</span>
                      </td>
                      <td>
                        <span className={blingStatusBadgeClass(o.status)}>
                          {o.status || '—'}
                        </span>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{o.totalLabel}</td>
                      <td>
                        <span
                          className={channelBadgeClass(o.channel)}
                          title={o.channelName || o.channelLabel || ''}
                        >
                          {o.channelLabel || 'Manual'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMoreOrders && (
                <div className="p-3 border-t border-bs-border flex justify-center">
                  <button
                    type="button"
                    className="bs-btn-secondary text-xs py-2 px-4"
                    onClick={() => setOrderLimit((n) => n + 30)}
                  >
                    Mostrar mais ({filteredOrders.length - visibleOrders.length} restantes)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Controles — fila de disparo */}
      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-bold text-bs-text">Controles · Fila de disparo</h3>
            {sendInProgress && (
              <span className="bs-badge-warning normal-case inline-flex items-center gap-1">
                <i className="fa-solid fa-spinner animate-spin" />
                Envio em andamento
              </span>
            )}
            <span className="text-xs text-bs-muted">{visibleSchedules.length} item(ns)</span>
          </div>
          {onRefreshSchedules && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onRefreshSchedules()} className="bs-link-accent px-2 py-1 rounded hover:bg-bs-hover text-xs">
                Atualizar
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0 || actionId === 'bulk'}
                className="bs-link px-2 py-1 rounded hover:bg-bs-hover text-[var(--bs-danger-text)] disabled:opacity-50 text-xs"
              >
                Excluir ({selectedIds.size})
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          {visibleSchedules.length === 0 ? (
            <div className="bs-table-empty text-sm">Nenhum agendamento na fila.</div>
          ) : (
            <table className="bs-table">
              <thead className="bs-table-head">
                <tr>
                  {backend && onRefreshSchedules && <th className="w-10" />}
                  <th>Conteúdo</th>
                  <th>Quando</th>
                  <th>Status</th>
                  <th>Destinos</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleSchedules.map((s) => (
                  <tr key={s.id} className={`bs-table-row ${selectedIds.has(s.id) ? 'bg-[var(--bs-danger-bg)]' : ''}`}>
                    {backend && onRefreshSchedules && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="rounded border-bs-border text-bs-accent focus:ring-bs-accent"
                        />
                      </td>
                    )}
                    <td className="max-w-xs">
                      <p className="font-medium text-bs-text truncate text-sm">{s.content || '(Apenas mídia)'}</p>
                    </td>
                    <td className="whitespace-nowrap text-xs text-bs-muted">{formatScheduledAt(s.scheduledAt)}</td>
                    <td>
                      <span className={`${scheduleStatusBadgeClass(s.status)} normal-case`}>
                        {statusLabel[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="tabular-nums text-sm font-semibold text-bs-accent">{s.targets.length}</td>
                    <td>
                      {backend && onRefreshSchedules && (
                        <div className="flex items-center justify-end gap-1">
                          {s.status === 'pending' && (
                            <button type="button" onClick={() => handlePause(s)} disabled={actionId === s.id} className="bs-link-accent px-2 py-1 text-xs disabled:opacity-50">Pausar</button>
                          )}
                          {s.status === 'paused' && (
                            <button type="button" onClick={() => handleResume(s)} disabled={actionId === s.id} className="bs-link-accent px-2 py-1 text-xs disabled:opacity-50">Reativar</button>
                          )}
                          <button type="button" onClick={() => handleDelete(s)} disabled={actionId === s.id} className="bs-link px-2 py-1 text-xs text-[var(--bs-danger-text)] disabled:opacity-50">Excluir</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
