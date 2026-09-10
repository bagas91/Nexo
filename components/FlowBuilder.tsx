import React, { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Flow, FlowBlockType, FlowCanvasEdge, FlowCanvasNode } from '../services/mockStore';
import Toggle from './Toggle';

type BlockKind = FlowBlockType | 'trigger' | 'end';

export type FlowNodeData = {
  blockType: BlockKind;
  label: string;
  config: Record<string, string>;
};

const PALETTE_BLOCKS: { type: FlowBlockType; label: string; icon: string; color: string }[] = [
  { type: 'message', label: 'Enviar Mensagem', icon: 'fa-message', color: '#3b82f6' },
  { type: 'audio', label: 'Enviar Áudio', icon: 'fa-microphone', color: '#22c55e' },
  { type: 'delay', label: 'Delay / Espera', icon: 'fa-clock', color: '#a855f7' },
  { type: 'condition', label: 'Condição', icon: 'fa-code-branch', color: '#eab308' },
  { type: 'ai', label: 'Ativar Agente de IA', icon: 'fa-robot', color: '#f97316' },
  { type: 'tag', label: 'Adicionar Tag', icon: 'fa-tag', color: '#ec4899' },
  { type: 'human', label: 'Transferir p/ Humano', icon: 'fa-user', color: '#6366f1' },
  { type: 'webhook', label: 'Webhook', icon: 'fa-link', color: '#06b6d4' },
];

const NODE_STYLE: Record<BlockKind, { color: string; icon: string }> = {
  trigger: { color: '#22c55e', icon: 'fa-bolt' },
  end: { color: '#6b7280', icon: 'fa-flag-checkered' },
  message: { color: '#3b82f6', icon: 'fa-message' },
  audio: { color: '#22c55e', icon: 'fa-microphone' },
  delay: { color: '#a855f7', icon: 'fa-clock' },
  condition: { color: '#eab308', icon: 'fa-code-branch' },
  ai: { color: '#f97316', icon: 'fa-robot' },
  tag: { color: '#ec4899', icon: 'fa-tag' },
  human: { color: '#6366f1', icon: 'fa-user' },
  webhook: { color: '#06b6d4', icon: 'fa-link' },
};

function uid() {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function withDeletable(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  return nodes.map((n) => ({
    ...n,
    deletable: n.data.blockType !== 'trigger' && n.data.blockType !== 'end',
  }));
}

function createBlockNode(type: FlowBlockType, position: { x: number; y: number }): Node<FlowNodeData> {
  const meta = PALETTE_BLOCKS.find((b) => b.type === type)!;
  return {
    id: uid(),
    type: 'flowNode',
    position,
    deletable: true,
    data: {
      blockType: type,
      label: meta.label,
      config: type === 'delay' ? { seconds: '30' } : type === 'message' ? { text: '' } : type === 'ai' ? { agentId: '' } : {},
    },
  };
}

export function flowToReactFlow(flow: Flow): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes = withDeletable(
    (flow.nodes || []).map((n) => ({
      id: n.id,
      type: 'flowNode' as const,
      position: n.position,
      data: { ...n.data },
    }))
  );
  const edges: Edge[] = (flow.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    style: { stroke: 'var(--bs-subtle)', strokeWidth: 2, strokeDasharray: '6 4' },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--bs-subtle)' },
  }));
  return { nodes, edges };
}

export function reactFlowToFlow(flow: Flow, nodes: Node<FlowNodeData>[], edges: Edge[]): Flow {
  const canvasNodes: FlowCanvasNode[] = nodes.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: n.position,
    data: n.data,
  }));
  const canvasEdges: FlowCanvasEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  const triggerNode = nodes.find((n) => n.data.blockType === 'trigger');
  const blockNodes = nodes.filter((n) => n.data.blockType !== 'trigger' && n.data.blockType !== 'end');
  return {
    ...flow,
    trigger: triggerNode?.data.config.trigger || flow.trigger,
    triggerConfig: { ...triggerNode?.data.config },
    nodes: canvasNodes,
    edges: canvasEdges,
    blocks: blockNodes.map((n) => ({
      id: n.id,
      type: n.data.blockType as FlowBlockType,
      label: n.data.label,
      config: n.data.config,
    })),
  };
}

function FlowNodeCard({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const kind = data.blockType;
  const style = NODE_STYLE[kind] || NODE_STYLE.message;
  const isTrigger = kind === 'trigger';
  const isEnd = kind === 'end';
  const isAi = kind === 'ai';

  return (
    <div
      className={`flow-canvas-node min-w-[240px] max-w-[280px] rounded-xl border-2 bg-bs-surface shadow-card ${selected ? 'ring-2 ring-bs-accent ring-offset-2 ring-offset-bs-canvas' : ''}`}
      style={{ borderColor: style.color }}
    >
      {!isTrigger && (
        <Handle type="target" position={Position.Top} className="flow-handle !bg-bs-accent !border-bs-shell !w-3 !h-3" />
      )}
      <div className="px-3 py-2.5 border-b border-bs-border flex items-center gap-2" style={{ background: `${style.color}18` }}>
        <i className={`fa-solid ${style.icon} text-sm`} style={{ color: style.color }} />
        <span className="text-sm font-bold text-bs-text truncate">{data.label}</span>
      </div>
      <div className="px-3 py-3 text-xs text-bs-muted space-y-2">
        {isTrigger && (
          <>
            <p>Quando o fluxo será ativado?</p>
            <div className="rounded-lg border border-bs-border px-2 py-1.5 text-xs text-bs-text bg-bs-elevated">
              {data.config.triggerMode === 'any'
                ? 'Qualquer mensagem'
                : data.config.triggerMode === 'new'
                  ? 'Novo contato'
                  : (data.config.keyword ? `Palavra-chave: ${data.config.keyword}` : (data.config.trigger || 'Palavra-chave'))}
            </div>
          </>
        )}
        {isAi && <p className="text-bs-subtle italic">Ainda não executa no MVP</p>}
        {kind === 'message' && (
          <p className="line-clamp-2 text-bs-text">{data.config.text || 'Clique para editar o texto'}</p>
        )}
        {kind === 'delay' && <p>Esperar {data.config.seconds || '30'}s</p>}
        {kind === 'tag' && <p>Tag: {data.config.tag || '—'}</p>}
        {isEnd && <p className="text-bs-subtle">Fim do fluxo</p>}
      </div>
      {!isEnd && (
        <Handle type="source" position={Position.Bottom} className="flow-handle !bg-bs-accent !border-bs-shell !w-3 !h-3" />
      )}
    </div>
  );
}

const nodeTypes = { flowNode: FlowNodeCard };

interface BuilderBodyProps {
  draft: Flow;
  setDraftMeta: React.Dispatch<React.SetStateAction<Pick<Flow, 'name' | 'active'>>>;
  onSave: (flow: Flow) => void;
  onClose: () => void;
  onDelete: () => void;
}

function BuilderBody({ draft, setDraftMeta, onSave, onClose, onDelete }: BuilderBodyProps) {
  const initial = useMemo(() => flowToReactFlow(draft), [draft.id]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const selected = nodes.find((n) => n.id === selectedId) || null;

  const edgeDefaults = {
    type: 'smoothstep' as const,
    style: { stroke: 'var(--bs-subtle)', strokeWidth: 2, strokeDasharray: '6 4' },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--bs-subtle)' },
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...edgeDefaults }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/flow-block') as FlowBlockType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((nds) => withDeletable([...nds, createBlockNode(type, position)]));
    },
    [screenToFlowPosition, setNodes]
  );

  const onDragStart = (e: React.DragEvent, type: FlowBlockType) => {
    e.dataTransfer.setData('application/flow-block', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  const patchSelected = (patch: Partial<FlowNodeData> & { config?: Record<string, string> }) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            ...patch,
            config: { ...n.data.config, ...(patch.config || {}) },
          },
        };
      }),
    );
  };

  const handleSave = () => {
    const next = reactFlowToFlow(draft, nodesRef.current, edgesRef.current);
    // Sync trigger string from trigger node
    const triggerNode = nodesRef.current.find((n) => n.data.blockType === 'trigger');
    if (triggerNode) {
      const mode = triggerNode.data.config.triggerMode || 'keyword';
      const kw = triggerNode.data.config.keyword || '';
      if (mode === 'keyword') {
        next.trigger = kw ? `Palavra-chave: ${kw}` : 'Palavra-chave';
        next.triggerConfig = { ...triggerNode.data.config, trigger: next.trigger, keyword: kw };
      } else if (mode === 'any') {
        next.trigger = 'Qualquer mensagem recebida';
        next.triggerConfig = { ...triggerNode.data.config, trigger: next.trigger };
      } else if (mode === 'new') {
        next.trigger = 'Novo contato';
        next.triggerConfig = { ...triggerNode.data.config, trigger: next.trigger };
      }
    }
    onSave(next);
  };

  return (
    <div className="fixed inset-0 md:left-64 z-40 flex flex-col bg-bs-canvas">
      <header className="h-14 shrink-0 border-b border-bs-border bg-bs-shell px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-lg border border-bs-border hover:bg-bs-hover text-bs-muted shrink-0">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <input
            className="bs-input py-1.5 text-sm font-semibold max-w-[200px] sm:max-w-xs"
            value={draft.name}
            onChange={(e) => setDraftMeta((m) => ({ ...m, name: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-sm text-bs-muted">
            <span>Ativo</span>
            <Toggle on={draft.active} onChange={(v) => setDraftMeta((m) => ({ ...m, active: v }))} />
          </div>
          <button type="button" onClick={onDelete} className="bs-btn-danger text-xs py-1.5 px-2 sm:px-3 hidden xs:inline-flex">
            <i className="fa-solid fa-trash sm:mr-1" /><span className="hidden sm:inline">Excluir</span>
          </button>
          <button type="button" onClick={handleSave} className="bs-btn text-sm py-1.5 px-4">Salvar</button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-48 lg:w-52 shrink-0 border-r border-bs-border bg-bs-shell overflow-y-auto custom-scrollbar hidden md:block">
          <p className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-bs-subtle">Blocos</p>
          <div className="px-2 pb-4 space-y-1">
            {PALETTE_BLOCKS.map((b) => (
              <div
                key={b.type}
                draggable
                onDragStart={(e) => onDragStart(e, b.type)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-bs-border bg-bs-elevated cursor-grab active:cursor-grabbing hover:bg-bs-hover text-[11px] font-medium text-bs-text"
                style={{ borderLeftWidth: 3, borderLeftColor: b.color }}
              >
                <i className={`fa-solid ${b.icon} w-4 text-center shrink-0`} style={{ color: b.color }} />
                <span className="leading-tight">{b.label}</span>
              </div>
            ))}
          </div>
          <p className="px-3 pb-4 text-[10px] text-bs-subtle leading-relaxed">
            MVP executa: mensagem, espera, tag, humano, webhook. Clique no bloco para editar.
          </p>
        </aside>

        <div className="flex-1 min-h-0 flow-canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id || null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.35 }}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={edgeDefaults}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--bs-border)" />
            <Controls className="flow-controls" showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="w-64 lg:w-72 shrink-0 border-l border-bs-border bg-bs-shell overflow-y-auto custom-scrollbar p-3 hidden sm:block">
          <p className="text-[10px] font-bold uppercase tracking-widest text-bs-subtle mb-3">Propriedades</p>
          {!selected ? (
            <p className="text-xs text-bs-muted">Selecione um bloco no canvas para editar.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-[11px] text-bs-muted font-semibold">Rótulo</label>
                <input
                  className="bs-input text-xs py-1.5 mt-1"
                  value={selected.data.label}
                  onChange={(e) => patchSelected({ label: e.target.value })}
                />
              </div>

              {selected.data.blockType === 'trigger' && (
                <>
                  <div>
                    <label className="text-[11px] text-bs-muted font-semibold">Quando disparar</label>
                    <select
                      className="bs-input text-xs py-1.5 mt-1"
                      value={selected.data.config.triggerMode || (selected.data.config.keyword ? 'keyword' : 'any')}
                      onChange={(e) => patchSelected({ config: { triggerMode: e.target.value } })}
                    >
                      <option value="keyword">Palavra-chave</option>
                      <option value="any">Qualquer mensagem</option>
                      <option value="new">Novo contato</option>
                    </select>
                  </div>
                  {(selected.data.config.triggerMode || 'keyword') === 'keyword' && (
                    <div>
                      <label className="text-[11px] text-bs-muted font-semibold">Palavra-chave</label>
                      <input
                        className="bs-input text-xs py-1.5 mt-1"
                        placeholder="ex.: oração, rastreio, preço"
                        value={selected.data.config.keyword || ''}
                        onChange={(e) => patchSelected({ config: { keyword: e.target.value } })}
                      />
                      <p className="text-[10px] text-bs-subtle mt-1">Dispara se a mensagem do cliente contiver este texto.</p>
                    </div>
                  )}
                </>
              )}

              {selected.data.blockType === 'message' && (
                <div>
                  <label className="text-[11px] text-bs-muted font-semibold">Texto da mensagem</label>
                  <textarea
                    className="bs-input text-xs py-1.5 mt-1 min-h-[100px]"
                    placeholder="Olá {{name}}! …"
                    value={selected.data.config.text || ''}
                    onChange={(e) => patchSelected({ config: { text: e.target.value } })}
                  />
                  <p className="text-[10px] text-bs-subtle mt-1">Use {"{{name}}"} para o nome do contato.</p>
                </div>
              )}

              {selected.data.blockType === 'delay' && (
                <div>
                  <label className="text-[11px] text-bs-muted font-semibold">Esperar (segundos)</label>
                  <input
                    type="number"
                    min={1}
                    className="bs-input text-xs py-1.5 mt-1"
                    value={selected.data.config.seconds || '30'}
                    onChange={(e) => patchSelected({ config: { seconds: e.target.value } })}
                  />
                </div>
              )}

              {selected.data.blockType === 'tag' && (
                <div>
                  <label className="text-[11px] text-bs-muted font-semibold">Tag</label>
                  <input
                    className="bs-input text-xs py-1.5 mt-1"
                    placeholder="ex.: oracao"
                    value={selected.data.config.tag || ''}
                    onChange={(e) => patchSelected({ config: { tag: e.target.value } })}
                  />
                </div>
              )}

              {selected.data.blockType === 'webhook' && (
                <div>
                  <label className="text-[11px] text-bs-muted font-semibold">URL do webhook</label>
                  <input
                    className="bs-input text-xs py-1.5 mt-1"
                    placeholder="https://…"
                    value={selected.data.config.url || ''}
                    onChange={(e) => patchSelected({ config: { url: e.target.value } })}
                  />
                </div>
              )}

              {selected.data.blockType === 'human' && (
                <div>
                  <label className="text-[11px] text-bs-muted font-semibold">Mensagem ao transferir (opcional)</label>
                  <textarea
                    className="bs-input text-xs py-1.5 mt-1 min-h-[72px]"
                    placeholder="Vou te passar para um atendente…"
                    value={selected.data.config.text || selected.data.config.message || ''}
                    onChange={(e) => patchSelected({ config: { text: e.target.value, message: e.target.value } })}
                  />
                </div>
              )}

              {(selected.data.blockType === 'ai' || selected.data.blockType === 'audio' || selected.data.blockType === 'condition') && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-400/40 rounded-lg px-2 py-2">
                  Este bloco ainda não executa no MVP. Use mensagem / espera / tag / humano.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

interface FlowBuilderProps {
  flow: Flow;
  onSave: (flow: Flow) => void;
  onClose: () => void;
  onDelete: () => void;
}

const FlowBuilder: React.FC<FlowBuilderProps> = ({ flow, onSave, onClose, onDelete }) => {
  const [meta, setMeta] = React.useState({ name: flow.name, active: flow.active });
  const draft = useMemo(() => ({ ...flow, ...meta }), [flow, meta]);

  return (
    <ReactFlowProvider>
      <BuilderBody draft={draft} setDraftMeta={setMeta} onSave={onSave} onClose={onClose} onDelete={onDelete} />
    </ReactFlowProvider>
  );
};

export function createEmptyFlow(): Flow {
  return {
    id: `fl_${Date.now()}`,
    name: 'Atendimento automático',
    active: false,
    trigger: 'Palavra-chave: oi',
    triggerConfig: { triggerMode: 'keyword', keyword: 'oi', trigger: 'Palavra-chave: oi', connection: 'whatsapp' },
    blocks: [
      { id: 'b_msg', type: 'message', label: 'Enviar Mensagem', config: { text: 'Olá {{name}}! Como posso te ajudar? Digite *humano* se preferir falar com a equipe.' } },
    ],
    nodes: [
      {
        id: 'trigger',
        type: 'flowNode',
        position: { x: 280, y: 40 },
        data: {
          blockType: 'trigger',
          label: 'Gatilho inicial',
          config: { triggerMode: 'keyword', keyword: 'oi', trigger: 'Palavra-chave: oi', connection: 'whatsapp' },
        },
      },
      {
        id: 'b_msg',
        type: 'flowNode',
        position: { x: 280, y: 220 },
        data: {
          blockType: 'message',
          label: 'Enviar Mensagem',
          config: { text: 'Olá {{name}}! Como posso te ajudar? Digite *humano* se preferir falar com a equipe.' },
        },
      },
      {
        id: 'end',
        type: 'flowNode',
        position: { x: 280, y: 400 },
        data: { blockType: 'end', label: 'Encerrar fluxo', config: {} },
      },
    ],
    edges: [
      { id: 'e_t_msg', source: 'trigger', target: 'b_msg' },
      { id: 'e_msg_end', source: 'b_msg', target: 'end' },
    ],
    createdAt: Date.now(),
  };
}

export default FlowBuilder;
