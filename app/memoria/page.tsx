'use client';

// Frente F.3 — MEMORIA HISTÓRICA: el histórico OC ↔ factura como casos de experiencia.
//
// Dos usos, en este orden a propósito:
//   1. BUSCAR: "¿ya vendimos esto?" — es lo que se consulta a diario (costeo, análisis, y para
//      responder cuando MP pide experiencia previa). Va primero porque es el 90% de las visitas.
//   2. CARGAR: dar de alta un caso con su OC, sus ítems y sus facturas (solo admin).
//
// El histórico ORIENTA, NO DECIDE: esta pantalla muestra hechos con su respaldo (qué OC, de qué
// fecha, para qué entidad) y jamás un veredicto de "conviene / no conviene". Ese juicio es del
// análisis de viabilidad.

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { StatCard } from '@/app/components/ui/StatCard';
import {
  Library, Search, Loader2, Plus, Trash2, Save, X, FileText, Receipt,
  Building2, Calendar, Package, Inbox, Info,
} from 'lucide-react';

interface Caso {
  id: number;
  oc_numero: string;
  oc_fecha: string | null;
  monto: number | null;
  moneda: string;
  entidad_nombre: string;
  entidad_rut: string | null;
  licitacion_codigo: string | null;
  categoria: string | null;
  descripcion: string | null;
  empresa_nombre: string | null;
  n_items: number;
  n_facturas: number;
  n_oc: number;
}

interface Coincidencia {
  itemId: number; descripcion: string; categoria: string | null;
  marca: string | null; modelo: string | null; unidad: string | null;
  precioUnitario: number | null; costoUnitario: number | null; proveedor: string | null;
  casoId: number; ocNumero: string; ocFecha: string | null;
  entidadNombre: string; empresaNombre: string | null;
}

interface Resumen {
  casos: number; items: number; montoTotal: number; entidades: number; conFactura: number;
  desde: string | null; hasta: string | null;
  topCategorias: { categoria: string; casos: number; monto: number }[];
  topEntidades: { entidad: string; casos: number; monto: number }[];
}

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('es-CL')}`;
const fmtFecha = (f: string | null) =>
  !f ? '—' : new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Fila vacía de ítem: se reusa al abrir el formulario y al agregar una línea.
const ITEM_VACIO = { descripcion: '', categoria: '', marca: '', modelo: '', cantidad: '', unidad: '', precioUnitario: '', proveedor: '' };

export default function MemoriaPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const confirm = useConfirm();
  const toast = useToast();

  const [casos, setCasos] = useState<Caso[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('');

  // Búsqueda de producto (la consulta protagonista)
  const [consulta, setConsulta] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [coincidencias, setCoincidencias] = useState<Coincidencia[] | null>(null);
  const [resPrecios, setResPrecios] = useState<{ veces: number; conPrecio: number; min: number; max: number; mediana: number; ultimaFecha: string | null } | null>(null);

  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    ocNumero: '', ocFecha: '', monto: '', entidadNombre: '', entidadRut: '',
    licitacionCodigo: '', categoria: '', descripcion: '',
  });
  const [items, setItems] = useState<(typeof ITEM_VACIO)[]>([{ ...ITEM_VACIO }]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/memoria${filtro ? `?texto=${encodeURIComponent(filtro)}` : ''}`);
      const d = await r.json();
      if (!r.ok) { toast.error(d?.error || 'No se pudo cargar la memoria'); return; }
      setCasos(d.casos || []);
      setResumen(d.resumen || null);
    } catch {
      toast.error('No se pudo cargar la memoria');
    } finally {
      setCargando(false);
    }
  }, [filtro, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const buscarProducto = async () => {
    const q = consulta.trim();
    if (q.length < 3) { toast.error('Escribe al menos 3 caracteres'); return; }
    setBuscando(true);
    try {
      const r = await fetch(`/api/memoria/buscar?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) { toast.error(d?.error || 'La búsqueda falló'); return; }
      setCoincidencias(d.coincidencias || []);
      setResPrecios(d.resumen || null);
    } catch {
      toast.error('La búsqueda falló');
    } finally {
      setBuscando(false);
    }
  };

  const guardar = async () => {
    if (!form.ocNumero.trim() || !form.entidadNombre.trim()) {
      toast.error('El número de OC y la entidad son obligatorios');
      return;
    }
    setGuardando(true);
    try {
      const r = await fetch('/api/memoria', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          monto: form.monto ? Number(form.monto.replace(/\D/g, '')) : null,
          items: items.filter(i => i.descripcion.trim()).map(i => ({
            descripcion: i.descripcion, categoria: i.categoria || null,
            marca: i.marca || null, modelo: i.modelo || null,
            cantidad: i.cantidad ? Number(i.cantidad) : null, unidad: i.unidad || null,
            precioUnitario: i.precioUnitario ? Number(String(i.precioUnitario).replace(/\D/g, '')) : null,
            proveedor: i.proveedor || null,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d?.error || 'No se pudo guardar'); return; }
      toast.success('Caso de experiencia guardado');
      setCreando(false);
      setForm({ ocNumero: '', ocFecha: '', monto: '', entidadNombre: '', entidadRut: '', licitacionCodigo: '', categoria: '', descripcion: '' });
      setItems([{ ...ITEM_VACIO }]);
      cargar();
    } catch {
      toast.error('No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (c: Caso) => {
    const ok = await confirm({
      titulo: 'Borrar caso de experiencia',
      mensaje: `Se eliminará la OC ${c.oc_numero} (${c.entidad_nombre}) con sus ítems y respaldos. No se puede deshacer.`,
      confirmarLabel: 'Borrar', peligro: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/memoria?id=${c.id}`, { method: 'DELETE' });
    if (!r.ok) { toast.error('No se pudo borrar'); return; }
    toast.success('Caso eliminado');
    cargar();
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-indigo-400';

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-[19px] font-bold text-slate-800 inline-flex items-center gap-2">
              <Library size={20} className="text-indigo-600" /> Memoria histórica
            </h1>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Lo que ya ejecutamos: órdenes de compra con su factura. Sirve de prueba de experiencia y de punto de partida para cotizar.
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => setCreando(v => !v)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 rounded-lg transition-colors flex-shrink-0">
              {creando ? <X size={14} /> : <Plus size={14} />} {creando ? 'Cancelar' : 'Cargar experiencia'}
            </button>
          )}
        </div>

        {/* ── Resumen ─────────────────────────────────────────────────────── */}
        {resumen && resumen.casos > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard icon={<Package size={16} />} label="Casos cargados" value={resumen.casos} color="teal"
              sub={resumen.desde ? `desde ${fmtFecha(resumen.desde)}` : undefined} />
            <StatCard icon={<Receipt size={16} />} label="Monto histórico" value={resumen.montoTotal} color="#4f46e5" formato={fmtCLP} />
            <StatCard icon={<Building2 size={16} />} label="Entidades" value={resumen.entidades} color="#0891b2" />
            <StatCard icon={<FileText size={16} />} label="Con factura" value={resumen.conFactura} color="#059669"
              sub={`de ${resumen.casos} casos`} />
          </div>
        )}

        {/* ── Buscador de producto ────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
          <p className="text-[13px] font-semibold text-slate-700 mb-2">¿Ya vendimos esto antes?</p>
          <div className="flex gap-2">
            <input value={consulta} onChange={e => setConsulta(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscarProducto(); }}
              placeholder="Ej: notebook, taladro percutor, impresora multifuncional…"
              className={inputCls} />
            <button onClick={buscarProducto} disabled={buscando}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 px-4 py-2 rounded-lg transition-colors flex-shrink-0">
              {buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
            </button>
          </div>

          {resPrecios && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                Ya lo vendimos {resPrecios.veces} vez{resPrecios.veces === 1 ? '' : 'es'}
              </span>
              <span className="text-slate-600">
                Precio típico <b>{fmtCLP(resPrecios.mediana)}</b>
                <span className="text-slate-400"> (rango {fmtCLP(resPrecios.min)} – {fmtCLP(resPrecios.max)}, {resPrecios.conPrecio} con precio)</span>
              </span>
            </div>
          )}

          {coincidencias != null && (
            coincidencias.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-slate-500">Sin experiencia previa cargada para eso.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-slate-400 text-left">
                      <th className="font-medium py-1 pr-2">Producto</th>
                      <th className="font-medium py-1 pr-2 w-[110px]">Precio unit.</th>
                      <th className="font-medium py-1 pr-2 w-[150px]">Entidad</th>
                      <th className="font-medium py-1 pr-2 w-[100px]">OC</th>
                      <th className="font-medium py-1 w-[90px]">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coincidencias.map(c => (
                      <tr key={c.itemId} className="border-t border-slate-100 text-slate-700">
                        <td className="py-1.5 pr-2">
                          <span className="block truncate max-w-[260px]" title={c.descripcion}>{c.descripcion}</span>
                          {(c.marca || c.modelo) && (
                            <span className="text-[10.5px] text-slate-400">{[c.marca, c.modelo].filter(Boolean).join(' · ')}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums font-semibold">{fmtCLP(c.precioUnitario)}</td>
                        <td className="py-1.5 pr-2 truncate max-w-[150px]" title={c.entidadNombre}>{c.entidadNombre}</td>
                        <td className="py-1.5 pr-2 font-mono text-[10.5px] text-slate-500">{c.ocNumero}</td>
                        <td className="py-1.5 text-slate-500">{fmtFecha(c.ocFecha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-slate-400 inline-flex items-start gap-1">
                  <Info size={11} className="flex-shrink-0 mt-0.5" />
                  Haberlo vendido antes no significa que esta licitación convenga: el análisis de viabilidad manda.
                </p>
              </div>
            )
          )}
        </div>

        {/* ── Alta de caso (admin) ────────────────────────────────────────── */}
        {creando && isAdmin && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 mb-5">
            <p className="text-[13px] font-semibold text-slate-700 mb-3">Nuevo caso de experiencia</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">N° de orden de compra *</span>
                <input value={form.ocNumero} onChange={e => setForm(f => ({ ...f, ocNumero: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Fecha de la OC</span>
                <input type="date" value={form.ocFecha} onChange={e => setForm(f => ({ ...f, ocFecha: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Monto total</span>
                <input inputMode="numeric" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="$" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[11px] font-semibold text-slate-600">Entidad (mandante) *</span>
                <input value={form.entidadNombre} onChange={e => setForm(f => ({ ...f, entidadNombre: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">RUT de la entidad</span>
                <input value={form.entidadRut} onChange={e => setForm(f => ({ ...f, entidadRut: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Línea de negocio</span>
                <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Licitación (si la hubo)</span>
                <input value={form.licitacionCodigo} onChange={e => setForm(f => ({ ...f, licitacionCodigo: e.target.value }))}
                  placeholder="1234-56-LE26" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">Descripción</span>
                <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
            </div>

            <p className="text-[11px] font-semibold text-slate-600 mt-4 mb-1.5">Productos de esta OC</p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <input value={it.descripcion} onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                    placeholder="Producto" className={`sm:col-span-2 ${inputCls}`} />
                  <input value={it.marca} onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, marca: e.target.value } : x))}
                    placeholder="Marca" className={inputCls} />
                  <input value={it.cantidad} inputMode="numeric" onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))}
                    placeholder="Cant." className={inputCls} />
                  <div className="flex gap-1">
                    <input value={it.precioUnitario} inputMode="numeric" onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, precioUnitario: e.target.value } : x))}
                      placeholder="P. unitario" className={inputCls} />
                    {items.length > 1 && (
                      <button onClick={() => setItems(a => a.filter((_, j) => j !== i))} title="Quitar línea"
                        className="text-slate-300 hover:text-rose-600 px-1 rounded-lg hover:bg-rose-50 transition-colors flex-shrink-0">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setItems(a => [...a, { ...ITEM_VACIO }])}
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:bg-indigo-100/60 px-2 py-1 rounded-lg transition-colors">
              <Plus size={12} /> Agregar producto
            </button>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setCreando(false)}
                className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-200/60 px-3 py-1.5 rounded-lg transition-colors">
                <X size={13} /> Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-3.5 py-1.5 rounded-lg transition-colors">
                {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar caso
              </button>
            </div>
          </div>
        )}

        {/* ── Listado de casos ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-2">
          <input value={filtro} onChange={e => setFiltro(e.target.value)}
            placeholder="Filtrar por OC, entidad o descripción…"
            className={`${inputCls} max-w-sm`} />
          <span className="text-[11.5px] text-slate-400">{casos.length} caso{casos.length === 1 ? '' : 's'}</span>
        </div>

        {cargando ? (
          <p className="text-[12.5px] text-slate-400 inline-flex items-center gap-1.5 py-6">
            <Loader2 size={13} className="animate-spin" /> Cargando…
          </p>
        ) : casos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
            <Inbox size={22} className="mx-auto text-slate-300 mb-2" />
            <p className="text-[13px] font-semibold text-slate-600">La memoria está vacía</p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {isAdmin
                ? 'Carga la primera orden de compra ejecutada para empezar a construir el histórico.'
                : 'Todavía no hay experiencia cargada.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="text-left">
                  <th className="font-medium px-3 py-2">OC</th>
                  <th className="font-medium px-3 py-2">Entidad</th>
                  <th className="font-medium px-3 py-2 w-[130px]">Línea de negocio</th>
                  <th className="font-medium px-3 py-2 text-right w-[120px]">Monto</th>
                  <th className="font-medium px-3 py-2 w-[100px]">Fecha</th>
                  <th className="font-medium px-3 py-2 w-[110px]">Respaldo</th>
                  {isAdmin && <th className="w-[40px]" />}
                </tr>
              </thead>
              <tbody>
                {casos.map(c => (
                  <tr key={c.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-[11.5px]">{c.oc_numero}</td>
                    <td className="px-3 py-2 truncate max-w-[220px]" title={c.entidad_nombre}>{c.entidad_nombre}</td>
                    <td className="px-3 py-2 text-slate-500 truncate max-w-[130px]">{c.categoria || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtCLP(c.monto)}</td>
                    <td className="px-3 py-2 text-slate-500 inline-flex items-center gap-1">
                      <Calendar size={11} className="text-slate-300" />{fmtFecha(c.oc_fecha)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-[11px]">
                        <span className={c.n_items > 0 ? 'text-slate-600' : 'text-slate-300'} title={`${c.n_items} producto(s)`}>
                          <Package size={12} className="inline" /> {c.n_items}
                        </span>
                        {/* Sin factura, el caso NO sirve como prueba de experiencia ante MP:
                            se marca en ámbar para que se note lo que falta completar. */}
                        <span className={c.n_facturas > 0 ? 'text-emerald-600' : 'text-amber-500'}
                          title={c.n_facturas > 0 ? `${c.n_facturas} factura(s)` : 'Sin factura cargada: aún no sirve como respaldo'}>
                          <Receipt size={12} className="inline" /> {c.n_facturas}
                        </span>
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2">
                        <button onClick={() => borrar(c)} title="Borrar caso"
                          className="text-slate-300 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
