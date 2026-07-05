import React from 'react';

export interface FeatureModel {
  id: string;
  title: string;
  description: string;
  icon: string;
  tag?: string;
}

interface FeatureShellViewProps {
  title: string;
  description: string;
  models: FeatureModel[];
  emptyTitle: string;
  emptyDescription: string;
  createLabel: string;
  onCreate: () => void;
  onUseModel: (model: FeatureModel) => void;
  items?: { id: string; name: string; active: boolean; subtitle?: string }[];
}

const FeatureShellView: React.FC<FeatureShellViewProps> = ({
  title,
  description,
  models,
  emptyTitle,
  emptyDescription,
  createLabel,
  onCreate,
  onUseModel,
  items = [],
}) => {
  const hasItems = items.length > 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="bs-page-title">{title}</h2>
          <p className="bs-page-desc mt-1">{description}</p>
        </div>
        <button type="button" onClick={onCreate} className="bs-btn px-4 py-2 text-sm shrink-0">
          <i className="fa-solid fa-plus mr-2" />
          {createLabel}
        </button>
      </div>

      {hasItems ? (
        <div className="bs-table-wrap">
          <div className="bs-table-toolbar">
            <span className="text-sm text-bs-muted">{items.length} item(ns)</span>
          </div>
          <table className="bs-table">
            <thead className="bs-table-head">
              <tr>
                <th>Nome</th>
                <th>Detalhes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="bs-table-row">
                  <td className="font-medium text-bs-text">{item.name}</td>
                  <td className="text-bs-muted text-sm">{item.subtitle || '—'}</td>
                  <td>
                    <span className={item.active ? 'bs-badge-success normal-case' : 'bs-badge-warning normal-case'}>
                      {item.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bs-card p-8 text-center border-dashed">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-muted">
            <i className="fa-solid fa-wand-magic-sparkles" />
          </div>
          <h3 className="font-bold text-bs-text mb-1">{emptyTitle}</h3>
          <p className="text-sm text-bs-muted max-w-lg mx-auto mb-6">{emptyDescription}</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold text-bs-text mb-3 uppercase tracking-wide">Modelos prontos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onUseModel(m)}
              className="bs-card p-4 text-left hover:border-bs-accent/40 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-accent shrink-0 group-hover:border-bs-accent/30">
                  <i className={`fa-solid ${m.icon}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-bs-text">{m.title}</p>
                    {m.tag && <span className="bs-badge-accent normal-case text-[9px]">{m.tag}</span>}
                  </div>
                  <p className="text-xs text-bs-muted mt-1 line-clamp-2">{m.description}</p>
                </div>
              </div>
              <p className="text-xs text-bs-accent font-semibold mt-3">Usar modelo →</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FeatureShellView;
