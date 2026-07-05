import React, { useState, useEffect } from 'react';
import { Category, ChatEntity } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

interface CategoriesViewProps {
  chats: ChatEntity[];
}

const CategoriesView: React.FC<CategoriesViewProps> = ({ chats }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formGroupIds, setFormGroupIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();

  const load = () => {
    setIsLoading(true);
    return backend.getCategories().then((data) => {
      setCategories(data);
      setIsLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setFormName('');
    setFormGroupIds([]);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    try {
      if (editingId) {
        await backend.saveCategory({ id: editingId, name: formName.trim(), groupIds: formGroupIds });
      } else {
        await backend.saveCategory({ name: formName.trim(), groupIds: formGroupIds });
      }
      resetForm();
      load();
      showToast(editingId ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setFormName(cat.name);
    setFormGroupIds(cat.groupIds);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta categoria?')) return;
    try {
      await backend.deleteCategory(id);
      if (editingId === id) resetForm();
      load();
      showToast('Categoria excluída.', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const toggleGroup = (id: string) => {
    setFormGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const filteredChats = chats.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="bs-page-title">Categorias</h2>
        <p className="bs-page-desc">Agrupe destinos para usar no agendamento em massa.</p>
      </div>

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm text-bs-muted">{categories.length} categoria(s)</span>
          <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="bs-btn px-3 py-1.5 text-xs">
            <i className="fa-solid fa-plus mr-1.5" />
            Nova categoria
          </button>
        </div>

        {showForm && (
          <div className="px-4 py-4 border-b border-bs-border bg-bs-elevated space-y-4">
            <p className="text-sm font-semibold text-bs-text">{editingId ? 'Editar categoria' : 'Nova categoria'}</p>
            <input
              type="text"
              placeholder="Nome da categoria"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="bs-input max-w-md"
            />
            <div className="border border-bs-border rounded-lg p-3 bg-bs-shell">
              <div className="flex items-center gap-3 mb-2">
                <p className="text-xs font-semibold text-bs-muted flex-1">Grupos desta categoria</p>
                <input
                  type="text"
                  placeholder="Filtrar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bs-input py-1 text-xs max-w-[160px]"
                />
              </div>
              <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
                {filteredChats.map((chat) => (
                  <label key={chat.id} className="flex items-center gap-2 cursor-pointer hover:bg-bs-hover rounded px-2 py-1 text-sm">
                    <input type="checkbox" checked={formGroupIds.includes(chat.id)} onChange={() => toggleGroup(chat.id)} />
                    <span className="truncate text-bs-text">{chat.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-bs-muted mt-2">{formGroupIds.length} selecionado(s)</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleSave} disabled={!formName.trim()} className="bs-btn px-4 py-1.5 text-xs disabled:opacity-50">
                {editingId ? 'Salvar' : 'Criar'}
              </button>
              <button type="button" onClick={resetForm} className="bs-btn-secondary px-4 py-1.5 text-xs">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Nome</th>
              <th>Grupos</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} className="bs-table-empty">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-bs-border border-t-bs-accent rounded-full animate-spin" />
                    Carregando...
                  </span>
                </td>
              </tr>
            ) : categories.length === 0 ? (
              <tr>
                <td colSpan={3} className="bs-table-empty">Nenhuma categoria. Crie uma acima.</td>
              </tr>
            ) : (
              categories.map((cat) => (
                <tr key={cat.id} className="bs-table-row">
                  <td className="font-medium text-bs-text">{cat.name}</td>
                  <td className="text-bs-muted">{cat.groupIds.length} grupo(s)</td>
                  <td className="text-right">
                    <button type="button" onClick={() => handleEdit(cat)} className="bs-link-accent mr-3">Editar</button>
                    <button type="button" onClick={() => handleDelete(cat.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">Excluir</button>
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

export default CategoriesView;
