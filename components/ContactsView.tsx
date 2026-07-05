import React, { useState } from 'react';
import { usePlatformEntities } from '../hooks/usePlatformData';
import type { MockContact } from '../services/mockStore';

const ContactsView: React.FC = () => {
  const [filter, setFilter] = useState('');
  const { items: contacts, loading } = usePlatformEntities<MockContact>('contacts');

  const filtered = contacts.filter(
    (c) => c.name.toLowerCase().includes(filter.toLowerCase()) || c.phone.includes(filter)
  );

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando contatos…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="bs-page-title">Contatos</h2>
        <p className="bs-page-desc mt-1">Lista de contatos e tags.</p>
      </div>
      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <input className="bs-input max-w-xs py-1.5 text-sm" placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="text-sm text-bs-muted">{filtered.length} contato(s)</span>
        </div>
        <table className="bs-table">
          <thead className="bs-table-head">
            <tr><th>Nome</th><th>Telefone</th><th>Tags</th><th>Última atividade</th></tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="bs-table-row">
                <td className="font-medium text-bs-text">{c.name}</td>
                <td className="font-mono text-xs text-bs-muted">{c.phone}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => <span key={t} className="bs-badge-accent normal-case text-[9px]">{t}</span>)}
                  </div>
                </td>
                <td className="text-xs text-bs-muted">{new Date(c.lastSeen).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContactsView;
