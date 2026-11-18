'use client';

// Etapas de avance propias de la empresa (migration-199). Solo el admin de la empresa las crea, edita, ordena y quita.
// Cada etapa «equivale» a una etapa base del sistema: así los avisos, los KPIs y los resultados siguen funcionando igual.
// Las ven todas las personas de la empresa en el selector de etapa del negocio y en los comentarios.
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Boton } from '@/app/components/ui/kit/Boton';
import { BASES_ETAPA, COLORES_ETAPA, MAX_ETAPAS_POR_EMPRESA, type EtapaPropia } from '@/app/lib/etapas-core';
import { ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { recargarEtapasPropias } from '@/app/lib/use-etapas-propias';

const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900';
const VACIA = { id: 0, nombre: '', color: COLORES_ETAPA[0], base: 'EN_PROCESO' };
const nombreBase = (id: string) => BASES_ETAPA.find(b => b.id === id)?.label ?? id;

export function EtapasEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId;
  const [etapas, setEtapas] = useState<EtapaPropia[]>([]);
  const [form, setForm] = useState<typeof VACIA | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/etapas').then(x => x.json()).catch(() => ({}));
    setEtapas(Array.isArray(r.etapas) ? r.etapas : []);
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  if (!aplica) return null;

  const llamar = async (metodo: 'POST' | 'PUT' | 'DELETE', cuerpo?: Record<string, unknown>, query = '') => {
    setOcupado(true);
    try {
      const r = await fetch(`/api/mi-empresa/etapas${query}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se pudo guardar', j.error || `HTTP ${r.status}`); return false; }
      await cargar(); recargarEtapasPropias();
      return true;
    } finally { setOcupado(false); }
  };
  const guardar = async () => {
    if (!form) return;
    const ok = await (form.id ? llamar('PUT', form) : llamar('POST', form));
    if (ok) { toast.success(form.id ? 'Etapa actualizada' : 'Etapa creada'); setForm(null); }
  };
  const quitar = async (e: EtapaPropia) => {
    if (!confirm(`¿Quitar la etapa «${e.nombre}»? Los negocios que están en ella pasan a «${nombreBase(e.base)}».`)) return;
    if (await llamar('DELETE', undefined, `?id=${e.id}`)) toast.success('Etapa quitada');
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Etapas de avance</h2>
      <p className="mt-0.5 text-sm text-slate-500">Crea las etapas con las que tu equipo sigue cada licitación. Cada una equivale a una etapa del sistema, para que los avisos y los resultados sigan funcionando. Tu equipo las ve al cambiar la etapa de un negocio y en los comentarios.</p>

      <div className="mt-3">
        <p className="text-[11px] text-slate-500">Etapas del sistema (siempre disponibles)</p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {ESTADOS_PIPELINE.map(e => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />{e.label.charAt(0) + e.label.slice(1).toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-500">Tus etapas {etapas.length > 0 && <span className="tabular-nums">· {etapas.length} de {MAX_ETAPAS_POR_EMPRESA}</span>}</p>
          {!form && <Boton tamano="sm" onClick={() => setForm({ ...VACIA })}>Nueva etapa</Boton>}
        </div>

        {etapas.length === 0 && !form && (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">Todavía no tienes etapas propias. Crea la primera, por ejemplo «Cotizando proveedores» o «Revisión legal».</p>
        )}

        <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
          {etapas.map((e, i) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">{e.nombre}</p>
                <p className="text-xs text-slate-500">Equivale a {nombreBase(e.base)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Boton tamano="sm" variante="fantasma" aria-label="Subir" disabled={ocupado || i === 0} onClick={() => llamar('PUT', { id: e.id, mover: -1 })}>↑</Boton>
                <Boton tamano="sm" variante="fantasma" aria-label="Bajar" disabled={ocupado || i === etapas.length - 1} onClick={() => llamar('PUT', { id: e.id, mover: 1 })}>↓</Boton>
                <Boton tamano="sm" onClick={() => setForm({ id: e.id, nombre: e.nombre, color: e.color, base: e.base })}>Editar</Boton>
                <Boton tamano="sm" variante="peligro" disabled={ocupado} onClick={() => quitar(e)}>Quitar</Boton>
              </div>
            </li>
          ))}
        </ul>

        {form && (
          <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <label className="block text-[11px] text-slate-500">Nombre de la etapa
              <input className={`${campo} mt-0.5`} maxLength={40} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej.: Cotizando proveedores" />
            </label>
            <div>
              <p className="text-[11px] text-slate-500">Color</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {COLORES_ETAPA.map(c => (
                  <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={form.color === c} onClick={() => setForm({ ...form, color: c })}
                    className={`h-6 w-6 rounded-full border-2 ${form.color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <label className="block text-[11px] text-slate-500">Equivale a la etapa del sistema
              <select className={`${campo} mt-0.5`} value={form.base} onChange={e => setForm({ ...form, base: e.target.value })}>
                {BASES_ETAPA.map(b => <option key={b.id} value={b.id}>{b.label} — {b.ayuda}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Por ejemplo, si la equivales a «Postulada», los avisos y resultados la tratan como una licitación postulada.</p>
            <div className="flex items-center gap-2">
              <Boton tamano="sm" variante="primario" disabled={ocupado || form.nombre.trim().length < 2} onClick={guardar}>{form.id ? 'Guardar cambios' : 'Crear etapa'}</Boton>
              <Boton tamano="sm" onClick={() => setForm(null)}>Cancelar</Boton>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: form.color }}>
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: form.color }} />{form.nombre.trim() || 'Vista previa'}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
