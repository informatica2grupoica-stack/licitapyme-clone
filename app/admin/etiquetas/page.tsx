'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { IconTag as Tag, IconPlus as Plus, IconTrash as Trash2, IconEdit as Edit3, IconCheck as Check, IconX as X, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Estado } from '@/app/components/ui/kit/Tarjeta';

interface Etiqueta {
  id: number;
  nombre: string;
  color: string;
  descripcion: string | null;
  activa: boolean;
}

const COLORES_PRESET = [
  '#3B82F6', '#06b6d4', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#EC4899', '#14b8a6',
  '#84CC16', '#F97316',
];

const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const CAMPO = 'h-9 w-full rounded-lg border border-linea bg-white px-3 text-sm text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const ROTULO = 'mb-1 block text-[13px] font-medium text-tinta dark:text-slate-200';
const ICONO_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60';

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
      <div className="@container p-4 sm:p-6 lg:p-8 max-w-3xl">
        <Encabezado
          titulo="Etiquetas / Líneas de negocio"
          descripcion="Define las líneas de negocio que los usuarios pueden asignar a los proyectos."
        />

        {/* Formulario nueva etiqueta */}
        <form onSubmit={agregar} className={`${SUPERFICIE} p-5 mb-5`}>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">Nueva etiqueta</h2>

          {error && <div className="mb-3"><Banner variante="error">{error}</Banner></div>}

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className={ROTULO}>Nombre</label>
              <input
                value={nueva.nombre}
                onChange={e => setNueva(p => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                placeholder="ej: EQUIPAMIENTO"
                className={`${CAMPO} font-medium`}
                maxLength={50}
              />
            </div>
            <div>
              <label className={ROTULO}>Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={nueva.color}
                  onChange={e => setNueva(p => ({ ...p, color: e.target.value }))}
                  aria-label="Elegir color"
                  className="h-9 w-9 rounded-lg border border-linea cursor-pointer p-0.5 dark:border-slate-700"
                />
                <div className="flex gap-1.5">
                  {COLORES_PRESET.slice(0, 6).map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      onClick={() => setNueva(p => ({ ...p, color: c }))}
                      style={{ backgroundColor: c }}
                      className={`h-5 w-5 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${nueva.color === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className={ROTULO}>Descripción <span className="font-normal text-tinta-2 dark:text-slate-400">(opcional)</span></label>
              <input
                value={nueva.descripcion}
                onChange={e => setNueva(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Para qué sirve esta línea"
                className={CAMPO}
              />
            </div>
            <Boton type="submit" variante="primario" disabled={agregando || !nueva.nombre.trim()}
              icono={agregando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} stroke={1.75} />}>
              {agregando ? 'Agregando…' : 'Agregar'}
            </Boton>
          </div>
        </form>

        {/* Lista de etiquetas */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Esqueleto key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : etiquetas.length === 0 ? (
          <Vacio icono={<Tag size={28} stroke={1.75} />} titulo="Aún no hay etiquetas" texto="Agrega la primera con el formulario de arriba." />
        ) : (
          <div className={`${SUPERFICIE} overflow-hidden`}>
            <div className="divide-y divide-linea dark:divide-slate-800">
              {etiquetas.map(et => (
                <div key={et.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  {editando === et.id ? (
                    /* Modo edición */
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      <input
                        value={editForm.nombre}
                        onChange={e => setEditForm(p => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                        aria-label="Nombre"
                        className={`${CAMPO} w-40 font-medium`}
                      />
                      <input
                        type="color"
                        value={editForm.color}
                        onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))}
                        aria-label="Elegir color"
                        className="h-9 w-9 rounded-lg border border-linea cursor-pointer p-0.5 dark:border-slate-700"
                      />
                      <input
                        value={editForm.descripcion}
                        onChange={e => setEditForm(p => ({ ...p, descripcion: e.target.value }))}
                        placeholder="Descripción"
                        aria-label="Descripción"
                        className={`${CAMPO} flex-1 min-w-[140px]`}
                      />
                      <Tooltip label="Guardar cambios">
                        <button onClick={() => guardarEdit(et.id)} aria-label="Guardar cambios" className={`${ICONO_BTN} text-exito hover:bg-emerald-50 dark:hover:bg-emerald-950/40`}>
                          <Check size={16} stroke={1.75} />
                        </button>
                      </Tooltip>
                      <Tooltip label="Cancelar">
                        <button onClick={() => setEditando(null)} aria-label="Cancelar" className={`${ICONO_BTN} hover:bg-slate-100 dark:hover:bg-slate-800`}>
                          <X size={16} stroke={1.75} />
                        </button>
                      </Tooltip>
                    </div>
                  ) : (
                    /* Modo visualización */
                    <>
                      <span className="min-w-[110px] text-[13px] font-medium text-tinta dark:text-slate-100">
                        <Estado color={et.color}>{et.nombre}</Estado>
                      </span>
                      <p className="flex-1 text-sm text-tinta-2 dark:text-slate-400 truncate">
                        {et.descripcion || <span className="text-tinta-3">Sin descripción</span>}
                      </p>
                      <div className="flex items-center gap-1">
                        <Tooltip label="Editar">
                          <button onClick={() => startEdit(et)} aria-label="Editar etiqueta" className={`${ICONO_BTN} hover:bg-slate-100 hover:text-marca dark:hover:bg-slate-800`}>
                            <Edit3 size={16} stroke={1.75} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Eliminar">
                          <button onClick={() => eliminar(et.id)} aria-label="Eliminar etiqueta" className={`${ICONO_BTN} hover:bg-red-50 hover:text-urgente dark:hover:bg-red-950/40`}>
                            <Trash2 size={16} stroke={1.75} />
                          </button>
                        </Tooltip>
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
