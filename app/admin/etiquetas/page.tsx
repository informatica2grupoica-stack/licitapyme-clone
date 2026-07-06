'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { Tag, Plus, Trash2, Edit3, Check, X, Loader2, AlertCircle } from 'lucide-react';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';

interface Etiqueta {
  id: number;
  nombre: string;
  color: string;
  descripcion: string | null;
  activa: boolean;
}

const COLORES_PRESET = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#EC4899', '#6366F1',
  '#84CC16', '#F97316',
];

export default function EtiquetasAdminPage() {
  const [etiquetas, setEtiquetas]   = useState<Etiqueta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [nueva, setNueva]           = useState({ nombre: '', color: '#3B82F6', descripcion: '' });
  const [agregando, setAgregando]   = useState(false);
  const [editando, setEditando]     = useState<number | null>(null);
  const [editForm, setEditForm]     = useState({ nombre: '', color: '', descripcion: '' });
  const confirmar = useConfirm();
  const toast = useToast();

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/etiquetas');
      const data = await res.json();
      if (data.success) setEtiquetas(data.etiquetas || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const agregar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nueva.nombre.trim()) return;
    setAgregando(true);
    setError(null);
    try {
      const res = await fetch('/api/etiquetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nueva),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setNueva({ nombre: '', color: '#3B82F6', descripcion: '' });
      toast.success('Etiqueta creada');
      await cargar();
    } catch { setError('Error de conexión'); }
    finally { setAgregando(false); }
  };

  const guardarEdit = async (id: number) => {
    try {
      const res = await fetch('/api/etiquetas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      });
      if (!res.ok) throw new Error();
      setEditando(null);
      toast.success('Etiqueta actualizada');
      await cargar();
    } catch { toast.error('No se pudo actualizar la etiqueta'); }
  };

  const eliminar = async (id: number) => {
    const ok = await confirmar({
      titulo: '¿Eliminar esta etiqueta?',
      mensaje: 'Se quitará de todos los negocios que la usan.',
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/etiquetas?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setEtiquetas(prev => prev.filter(e => e.id !== id));
      toast.info('Etiqueta eliminada');
    } catch { toast.error('No se pudo eliminar la etiqueta'); }
  };

  const startEdit = (et: Etiqueta) => {
    setEditando(et.id);
    setEditForm({ nombre: et.nombre, color: et.color, descripcion: et.descripcion || '' });
  };

  return (
    <AppLayout breadcrumb={[
      { label: 'Admin', href: '/admin/usuarios' },
      { label: 'Etiquetas / Líneas de negocio' },
    ]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Tag size={24} className="text-blue-600" />
            Etiquetas / Líneas de negocio
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Define las líneas de negocio que los usuarios pueden asignar a los proyectos
          </p>
        </div>

        {/* Formulario nueva etiqueta */}
        <form onSubmit={agregar} className="bg-white border border-gray-100 rounded-xl p-5 mb-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Nueva etiqueta</h2>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm mb-3">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
              <input
                value={nueva.nombre}
                onChange={e => setNueva(p => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                placeholder="ej: EQUIPAMIENTO"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none uppercase font-semibold"
                maxLength={50}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Color</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={nueva.color}
                  onChange={e => setNueva(p => ({ ...p, color: e.target.value }))}
                  className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                />
                <div className="flex gap-1">
                  {COLORES_PRESET.slice(0, 6).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNueva(p => ({ ...p, color: c }))}
                      style={{ backgroundColor: c }}
                      className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${nueva.color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-gray-500 mb-1 block">Descripción (opcional)</label>
              <input
                value={nueva.descripcion}
                onChange={e => setNueva(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Descripción..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={agregando || !nueva.nombre.trim()}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            >
              {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Agregar
            </button>
          </div>
        </form>

        {/* Lista de etiquetas */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : etiquetas.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <Tag size={28} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No hay etiquetas. Agrega la primera.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50">
              {etiquetas.map(et => (
                <div key={et.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  {editando === et.id ? (
                    /* Modo edición */
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      <input
                        value={editForm.nombre}
                        onChange={e => setEditForm(p => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                        className="px-2 py-1.5 border border-blue-300 rounded-lg text-sm font-semibold w-36 outline-none focus:ring-2 focus:ring-blue-400 uppercase"
                      />
                      <input
                        type="color"
                        value={editForm.color}
                        onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))}
                        className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                      />
                      <input
                        value={editForm.descripcion}
                        onChange={e => setEditForm(p => ({ ...p, descripcion: e.target.value }))}
                        placeholder="Descripción..."
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button onClick={() => guardarEdit(et.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg">
                        <Check size={15} />
                      </button>
                      <button onClick={() => setEditando(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    /* Modo visualización */
                    <>
                      <span
                        style={{ backgroundColor: et.color + '20', color: et.color, borderColor: et.color + '50' }}
                        className="text-xs px-3 py-1 rounded-full font-bold border min-w-[80px] text-center"
                      >
                        {et.nombre}
                      </span>
                      <div
                        style={{ backgroundColor: et.color }}
                        className="w-4 h-4 rounded-full flex-shrink-0"
                      />
                      <p className="flex-1 text-sm text-gray-500 truncate">
                        {et.descripcion || <span className="italic text-gray-300">Sin descripción</span>}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(et)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => eliminar(et.id)}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
