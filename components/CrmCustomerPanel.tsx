import React, { useCallback, useEffect, useState } from 'react';
import platformService from '../services/platformService';
import { useToast } from '../contexts/ToastContext';
import { formatPhoneLabel, isWhatsAppLid } from '../utils/phoneDisplay';

type CrmContact = {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  notes?: string;
  source?: string;
  needsHelp?: boolean;
};

type CrmDeal = {
  id: string;
  title: string;
  stage: string;
  value: number;
  updatedAt: number;
};

type CrmOrder = {
  orderId: string;
  numero: string;
  status: string;
  rastreio: string;
  produtos: string;
  total: string | number;
  date?: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  new: 'Novo',
  attending: 'Atendendo',
  link_sent: 'Link enviado',
  awaiting_payment: 'Aguardando pag.',
  paid: 'Pago',
  lost: 'Perdido',
  lead: 'Novo',
  qualified: 'Atendendo',
  proposal: 'Link enviado',
  won: 'Pago',
};

type Props = {
  phone: string;
  contactName: string;
  conversationId?: string;
  className?: string;
  onProfileChange?: () => void;
};

const CrmCustomerPanel: React.FC<Props> = ({ phone, contactName, conversationId, className = '', onProfileChange }) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [orders, setOrders] = useState<CrmOrder[]>([]);
  const [blingRegistered, setBlingRegistered] = useState<boolean | null>(null);
  const [blingContactName, setBlingContactName] = useState<string>('');
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [needsHelp, setNeedsHelp] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [creatingDeal, setCreatingDeal] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    try {
      const profile = await platformService.getCrmProfile(phone, contactName);
      setContact(profile.contact);
      setDeals(profile.deals || []);
      setNotes(profile.contact?.notes || '');
      setNeedsHelp(!!profile.contact?.needsHelp);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar ficha', 'error');
    } finally {
      setLoading(false);
    }
  }, [phone, contactName, showToast]);

  const loadOrders = useCallback(async () => {
    if (!phone) return;
    setOrdersLoading(true);
    setBlingRegistered(null);
    try {
      const res = await platformService.getCrmOrders(phone);
      setOrders(res.orders || []);
      setBlingRegistered(!!res.registered);
      setBlingContactName(res.contact?.name || '');
      setOrdersError(res.error);
    } catch (e) {
      setOrders([]);
      setBlingRegistered(false);
      setBlingContactName('');
      setOrdersError(e instanceof Error ? e.message : 'Falha ao buscar pedidos');
    } finally {
      setOrdersLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    void loadProfile();
    void loadOrders();
  }, [loadProfile, loadOrders]);

  const persist = async (patch: Partial<CrmContact> & { tags?: string[] }) => {
    setSaving(true);
    try {
      const res = await platformService.saveCrmProfile({
        phone,
        name: patch.name || contact?.name || contactName,
        tags: patch.tags || contact?.tags || ['whatsapp'],
        notes: patch.notes !== undefined ? patch.notes : notes,
        source: contact?.source || 'whatsapp',
        needsHelp: patch.needsHelp !== undefined ? patch.needsHelp : needsHelp,
      });
      setContact(res.contact as unknown as CrmContact);
      onProfileChange?.();
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar ficha', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await persist({ notes, needsHelp });
    if (ok) showToast('Ficha do cliente salva.', 'success');
  };

  const addTag = async () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    setTagInput('');
    await persist({ tags: [...new Set([...(contact?.tags || []), t])] });
  };

  const removeTag = async (tag: string) => {
    await persist({ tags: (contact?.tags || []).filter((x) => x !== tag) });
  };

  const createDeal = async () => {
    setCreatingDeal(true);
    try {
      await platformService.createCrmDeal({
        phone,
        contactName: contact?.name || contactName,
        title: `Venda assistida — ${contact?.name || contactName}`,
        stage: 'attending',
        source: 'whatsapp',
        conversationId,
        value: 0,
      });
      showToast('Oportunidade criada no pipeline.', 'success');
      await loadProfile();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao criar oportunidade', 'error');
    } finally {
      setCreatingDeal(false);
    }
  };

  if (loading) {
    return (
      <div className={`bs-card p-4 text-sm text-bs-muted animate-pulse ${className}`}>
        Carregando ficha…
      </div>
    );
  }

  const latestOrder = orders[0];
  const latestTracking = latestOrder?.rastreio?.trim() || '';

  return (
    <div className={`bs-card flex flex-col overflow-hidden min-h-0 ${className}`}>
      <div className="px-3 py-2.5 border-b border-bs-border shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-bs-subtle">Cliente</p>
        <p className="font-semibold text-sm text-bs-text truncate">{contact?.name || contactName}</p>
        <p className="text-[11px] text-bs-muted font-mono truncate">{formatPhoneLabel(contact?.phone || phone)}</p>
        <div className="mt-2">
          {ordersLoading || blingRegistered === null ? (
            <span className="inline-flex items-center text-[10px] text-bs-muted">Consultando Bling…</span>
          ) : isWhatsAppLid(phone) || (ordersError && /LID|não resolvido/i.test(ordersError)) ? (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-bs-elevated text-bs-muted border border-bs-border">
              Número WhatsApp oculto
            </span>
          ) : ordersError ? (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300">
              Bling indisponível
            </span>
          ) : blingRegistered ? (
            <div className="space-y-0.5">
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                Cadastrado no Bling
              </span>
              {blingContactName && (
                <p className="text-[10px] text-bs-muted truncate">Nome no Bling: {blingContactName}</p>
              )}
              <p className="text-[10px] text-bs-muted">
                {orders.length === 1 ? '1 pedido recente' : `${orders.length} pedidos recentes`}
              </p>
            </div>
          ) : (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-bs-elevated text-bs-muted border border-bs-border">
              Sem cadastro no Bling
            </span>
          )}
        </div>
      </div>

      {!ordersLoading && latestTracking && (
        <div className="px-3 py-2 border-b border-bs-border bg-emerald-500/10 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Rastreio — pedido #{latestOrder?.numero || latestOrder?.orderId}
          </p>
          <p className="text-sm font-mono font-semibold text-bs-text mt-0.5 break-all">{latestTracking}</p>
          {latestOrder?.status && (
            <p className="text-[10px] text-bs-muted mt-0.5">{latestOrder.status}</p>
          )}
        </div>
      )}

      {!ordersLoading && latestOrder && !latestTracking && /envi|transit|transport|postad|despach/i.test(String(latestOrder.status || '')) && (
        <div className="px-3 py-2 border-b border-bs-border bg-amber-500/10 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Pedido #{latestOrder.numero || latestOrder.orderId}
          </p>
          <p className="text-[11px] text-bs-muted mt-0.5">Enviado — rastreio ainda não disponível no Bling</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4 text-sm">
        <label className="flex items-start gap-2 text-xs text-bs-text cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-bs-border mt-0.5"
            checked={needsHelp}
            onChange={(e) => setNeedsHelp(e.target.checked)}
          />
          <span>Precisa de ajuda no site (venda assistida no WPP)</span>
        </label>

        <div>
          <p className="text-[11px] font-semibold text-bs-subtle mb-1">Tags</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {(contact?.tags || []).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => void removeTag(t)}
                className="bs-badge-accent normal-case text-[10px] hover:opacity-80"
                title="Remover tag"
              >
                {t} ×
              </button>
            ))}
            {!contact?.tags?.length && <span className="text-[11px] text-bs-muted">Sem tags</span>}
          </div>
          <div className="flex gap-1">
            <input
              className="bs-input text-xs py-1 flex-1"
              placeholder="nova tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTag(); } }}
            />
            <button type="button" className="bs-btn-secondary text-[10px] px-2" onClick={() => void addTag()} disabled={saving}>
              +
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-bs-subtle mb-1">Notas do cliente</p>
          <textarea
            className="bs-input text-xs min-h-[72px]"
            placeholder="Ex.: dificuldade no checkout, prefere áudio, compra para presente…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            type="button"
            className="bs-btn text-[10px] mt-2 py-1.5 px-3"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Salvando…' : 'Salvar ficha'}
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[11px] font-semibold text-bs-subtle">Pedidos Bling</p>
            <button type="button" className="text-[10px] text-bs-accent" onClick={() => void loadOrders()} disabled={ordersLoading}>
              {ordersLoading ? '…' : 'Atualizar'}
            </button>
          </div>
          {ordersError && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-1">{ordersError}</p>
          )}
          {!ordersLoading && !orders.length && !ordersError && blingRegistered && (
            <p className="text-[11px] text-bs-muted">Cadastrado, mas sem pedidos recentes.</p>
          )}
          {!ordersLoading && !orders.length && !ordersError && blingRegistered === false && (
            <p className="text-[11px] text-bs-muted">Sem cadastro neste telefone — não há pedidos para listar.</p>
          )}
          <div className="space-y-1.5">
            {orders.map((o) => (
              <div key={o.orderId} className="rounded-md border border-bs-border bg-bs-elevated px-2 py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-xs text-bs-text">#{o.numero || o.orderId}</span>
                  <span className="text-[10px] text-bs-muted truncate">{o.status || '—'}</span>
                </div>
                {o.produtos && <p className="text-[10px] text-bs-muted truncate mt-0.5">{o.produtos}</p>}
                <div className="flex justify-between gap-2 mt-0.5 text-[10px]">
                  <span className="text-bs-accent font-semibold">{o.total || ''}</span>
                  {o.rastreio && <span className="text-bs-muted truncate">Rastreio: {o.rastreio}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[11px] font-semibold text-bs-subtle">Oportunidades</p>
            <button
              type="button"
              className="bs-btn text-[10px] py-1 px-2"
              onClick={() => void createDeal()}
              disabled={creatingDeal}
              title="Cria card no pipeline de venda assistida"
            >
              {creatingDeal ? '…' : '+ Criar'}
            </button>
          </div>
          {!deals.length && (
            <p className="text-[11px] text-bs-muted">Nenhuma oportunidade ainda.</p>
          )}
          <div className="space-y-1.5">
            {deals.map((d) => (
              <div key={d.id} className="rounded-md border border-bs-border px-2 py-1.5">
                <p className="text-xs font-semibold text-bs-text truncate">{d.title}</p>
                <div className="flex justify-between gap-2 text-[10px] text-bs-muted mt-0.5">
                  <span>{STAGE_LABEL[d.stage] || d.stage}</span>
                  {d.value > 0 && <span className="text-bs-accent font-semibold">R$ {Number(d.value).toFixed(2)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrmCustomerPanel;
