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
import { IconLibrary as Library, IconSearch as Search, IconLoader2 as Loader2, IconPlus as Plus, IconTrash as Trash2, IconDeviceFloppy as Save, IconX as X, IconFileText as FileText, IconReceipt as Receipt, IconBuilding as Building2, IconCalendar as Calendar, IconPackage as Package, IconInbox as Inbox, IconInfoCircle as Info, IconBolt as Zap } from '@tabler/icons-react';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Lista } from '@/app/components/ui/kit/Aparecer';

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
  origen: string;
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

  const inputCls = 'h-9 w-full rounded-lg border border-linea bg-white px-3 text-[13px] text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
  const rotulo = 'block text-[13px] font-medium text-tinta dark:text-slate-200';

  return (
    <AppLayout>
      <div className="@container max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Memoria histórica"
          descripcion="Lo que ya ejecutamos: órdenes de compra con su factura. Sirve de prueba de experiencia y de punto de partida para cotizar."
          acciones={isAdmin ? (
            <Boton variante={creando ? 'secundario' : 'primario'} onClick={() => setCreando(v => !v)} icono={creando ? <X size={16} stroke={1.75} /> : <Plus size={16} stroke={1.75} />}>
              {creando ? 'Cancelar' : 'Cargar experiencia'}
            </Boton>
          ) : undefined}
        />

        {/* ── Resumen ─────────────────────────────────────────────────────── */}
        {resumen && resumen.casos > 0 && (
          <Lista className="grid grid-cols-2 @2xl:grid-cols-4 gap-3 mb-5">
            <Indicador rotulo="Casos cargados" valor={resumen.casos} detalle={resumen.desde ? `desde ${fmtFecha(resumen.desde)}` : undefined} />
            <Indicador rotulo="Monto histórico" valor={resumen.montoTotal} formato={fmtCLP} />
            <Indicador rotulo="Entidades" valor={resumen.entidades} />
            <Indicador rotulo="Con factura" valor={resumen.conFactura} detalle={`de ${resumen.casos} casos`} />
          </Lista>
        )}

        {/* ── Buscador de producto ────────────────────────────────────────── */}
        <div className={`${SUPERFICIE} p-5 mb-5`}>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">¿Ya vendimos esto antes?</h2>
          <div className="flex gap-2">
            <input value={consulta} onChange={e => setConsulta(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscarProducto(); }}
              placeholder="Ej: notebook, taladro percutor, impresora multifuncional…"
              className={inputCls} />
            <Boton variante="primario" onClick={buscarProducto} disabled={buscando} icono={buscando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} stroke={1.75} />}>Buscar</Boton>
          </div>

          {resPrecios && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-1 font-medium text-exito">
                Ya lo vendimos {resPrecios.veces} vez{resPrecios.veces === 1 ? '' : 'es'}
              </span>
              <span className="text-tinta-2 dark:text-slate-400">
                Precio típico <b>{fmtCLP(resPrecios.mediana)}</b>
                <span className="text-tinta-2"> (rango {fmtCLP(resPrecios.min)} – {fmtCLP(resPrecios.max)}, {resPrecios.conPrecio} con precio)</span>
              </span>
            </div>
          )}

          {coincidencias != null && (
            coincidencias.length === 0 ? (
              <p className="mt-3 text-[13px] text-tinta-2 dark:text-slate-400">Sin experiencia previa cargada para eso.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-tinta-2 dark:text-slate-400 text-left text-xs">
                      <th className="font-medium py-1 pr-2">Producto</th>
                      <th className="font-medium py-1 pr-2 w-[110px]">Precio unit.</th>
                      <th className="font-medium py-1 pr-2 w-[150px]">Entidad</th>
                      <th className="font-medium py-1 pr-2 w-[100px]">OC</th>
                      <th className="font-medium py-1 w-[90px]">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coincidencias.map(c => (
                      <tr key={c.itemId} className="border-t border-linea dark:border-slate-800 text-tinta dark:text-slate-200">
                        <td className="py-1.5 pr-2">
                          <span className="block truncate max-w-[260px]" title={c.descripcion}>{c.descripcion}</span>
                          {(c.marca || c.modelo) && (
                            <span className="text-xs text-tinta-2 dark:text-slate-400">{[c.marca, c.modelo].filter(Boolean).join(' · ')}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums font-semibold">{fmtCLP(c.precioUnitario)}</td>
                        <td className="py-1.5 pr-2 truncate max-w-[150px]" title={c.entidadNombre}>{c.entidadNombre}</td>
                        <td className="py-1.5 pr-2 font-mono text-xs text-tinta-2 dark:text-slate-400">{c.ocNumero}</td>
                        <td className="py-1.5 text-tinta-2 dark:text-slate-400">{fmtFecha(c.ocFecha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400 inline-flex items-start gap-1.5">
                  <Info size={14} stroke={1.75} className="flex-shrink-0 mt-px" />
                  Haberlo vendido antes no significa que esta licitación convenga: el análisis de viabilidad manda.
                </p>
              </div>
            )
          )}
        </div>

        {/* ── Alta de caso (admin) ────────────────────────────────────────── */}
        {creando && isAdmin && (
          <div className={`${SUPERFICIE} p-5 mb-5`}>
            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">Nuevo caso de experiencia</h2>
            <div className="grid grid-cols-1 @xl:grid-cols-3 gap-3">
              <label className="block">
                <span className={rotulo}>N° de orden de compra</span>
                <input value={form.ocNumero} onChange={e => setForm(f => ({ ...f, ocNumero: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>Fecha de la OC <span className="font-normal text-tinta-2">(opcional)</span></span>
                <input type="date" value={form.ocFecha} onChange={e => setForm(f => ({ ...f, ocFecha: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>Monto total <span className="font-normal text-tinta-2">(opcional)</span></span>
                <input inputMode="numeric" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="$" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block @xl:col-span-2">
                <span className={rotulo}>Entidad (mandante)</span>
                <input value={form.entidadNombre} onChange={e => setForm(f => ({ ...f, entidadNombre: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>RUT de la entidad <span className="font-normal text-tinta-2">(opcional)</span></span>
                <input value={form.entidadRut} onChange={e => setForm(f => ({ ...f, entidadRut: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>Línea de negocio <span className="font-normal text-tinta-2">(opcional)</span></span>
                <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>Licitación <span className="font-normal text-tinta-2">(si la hubo)</span></span>
                <input value={form.licitacionCodigo} onChange={e => setForm(f => ({ ...f, licitacionCodigo: e.target.value }))}
                  placeholder="1234-56-LE26" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className={rotulo}>Descripción <span className="font-normal text-tinta-2">(opcional)</span></span>
                <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
            </div>

            <p className="text-[13px] font-medium text-tinta dark:text-slate-200 mt-5 mb-2">Productos de esta OC</p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-2 @xl:grid-cols-5 gap-2">
                  <input value={it.descripcion} onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                    placeholder="Producto" className={`@xl:col-span-2 ${inputCls}`} />
                  <input value={it.marca} onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, marca: e.target.value } : x))}
                    placeholder="Marca" className={inputCls} />
                  <input value={it.cantidad} inputMode="numeric" onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))}
                    placeholder="Cant." className={inputCls} />
                  <div className="flex gap-1">
                    <input value={it.precioUnitario} inputMode="numeric" onChange={e => setItems(a => a.map((x, j) => j === i ? { ...x, precioUnitario: e.target.value } : x))}
                      placeholder="P. unitario" className={inputCls} />
                    {items.length > 1 && (
                      <button onClick={() => setItems(a => a.filter((_, j) => j !== i))} title="Quitar línea" aria-label="Quitar línea"
                        className="flex h-9 w-9 items-center justify-center text-slate-400 hover:text-urgente rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex-shrink-0">
                        <X size={16} stroke={1.75} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Boton variante="fantasma" tamano="sm" className="mt-2" onClick={() => setItems(a => [...a, { ...ITEM_VACIO }])} icono={<Plus size={16} stroke={1.75} />}>Agregar producto</Boton>

            <div className="flex items-center justify-end gap-2 mt-5">
              <Boton onClick={() => setCreando(false)}>Cancelar</Boton>
              <Boton variante="primario" onClick={guardar} disabled={guardando} icono={guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} stroke={1.75} />}>
                {guardando ? 'Guardando…' : 'Guardar caso'}
              </Boton>
            </div>
          </div>
        )}

        {/* ── Listado de casos ────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-3">
          <input value={filtro} aria-label="Filtrar casos" onChange={e => setFiltro(e.target.value)}
            placeholder="Filtrar por OC, entidad o descripción…"
            className={`${inputCls} max-w-sm`} />
          <span className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{casos.length} caso{casos.length === 1 ? '' : 's'}</span>
        </div>

        {cargando ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Esqueleto key={i} className="h-11 rounded-lg" />)}</div>
        ) : casos.length === 0 ? (
          <Vacio icono={<Inbox size={28} stroke={1.75} />} titulo="La memoria está vacía"
            texto={isAdmin ? 'Carga la primera orden de compra ejecutada para empezar a construir el histórico.' : 'Todavía no hay experiencia cargada.'} />
        ) : (
          <div className={`${SUPERFICIE} overflow-hidden`}>
            <table className="w-full text-[13px]">
              <thead className="text-tinta-2 dark:text-slate-400 text-xs">
                <tr className="text-left">
                  <th className="font-medium px-3 h-10">OC</th>
                  <th className="font-medium px-3 h-10">Entidad</th>
                  <th className="font-medium px-3 h-10 w-[130px]">Línea de negocio</th>
                  <th className="font-medium px-3 h-10 text-right w-[120px]">Monto</th>
                  <th className="font-medium px-3 h-10 w-[100px]">Fecha</th>
                  <th className="font-medium px-3 h-10 w-[110px]">Respaldo</th>
                  {isAdmin && <th className="w-[40px]" />}
                </tr>
              </thead>
              <tbody>
                {casos.map(c => (
                  <tr key={c.id} className="h-11 border-t border-linea dark:border-slate-800 text-tinta dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        {c.oc_numero}
                        {c.origen && c.origen !== 'MANUAL' && (
                          <span
                            title={`Cargado automático desde ${c.origen}`}
                            className="inline-flex items-center gap-0.5 text-xs font-medium text-tinta-2 font-sans">
                            <Zap size={14} stroke={1.75} /> {c.origen}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 truncate max-w-[220px]" title={c.entidad_nombre}>{c.entidad_nombre}</td>
                    <td className="px-3 py-2 text-tinta-2 dark:text-slate-400 truncate max-w-[130px]">{c.categoria || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtCLP(c.monto)}</td>
                    <td className="px-3 py-2 text-tinta-2 dark:text-slate-400 whitespace-nowrap tabular-nums">
                      {fmtFecha(c.oc_fecha)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className={c.n_items > 0 ? 'text-tinta-2 dark:text-slate-400' : 'text-slate-300'} title={`${c.n_items} producto(s)`}>
                          <Package size={14} stroke={1.75} className="inline" /> {c.n_items}
                        </span>
                        {/* Sin factura, el caso NO sirve como prueba de experiencia ante MP:
                            se marca en ámbar para que se note lo que falta completar. */}
                        <span className={c.n_facturas > 0 ? 'text-exito' : 'text-alerta'}
                          title={c.n_facturas > 0 ? `${c.n_facturas} factura(s)` : 'Sin factura cargada: aún no sirve como respaldo'}>
                          <Receipt size={14} stroke={1.75} className="inline" /> {c.n_facturas}
                        </span>
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2">
                        <button onClick={() => borrar(c)} title="Borrar caso" aria-label="Borrar caso"
                          className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-urgente rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
                          <Trash2 size={16} stroke={1.75} />
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
