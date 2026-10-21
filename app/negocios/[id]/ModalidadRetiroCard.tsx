'use client';

// MODALIDAD DE RETIRO (spec §13.2) — "se define en el primer instante... la define el humano, el
// sistema propone, no decide". Por eso este bloque NUNCA decide solo: registra la elección del humano.
// Guía en 2 pasos: 1) cómo se retira cada proveedor y, si lo trae un transporte, sus datos (nombre,
// RUT, precio, desde/hasta, fecha — migration-158); 2) qué hacer según lo elegido.
// Estilo según la skill ui-sin-aspecto-ia (21-oct-2026): tarjetas blancas, estados como texto con punto.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { enfocarProducto } from '@/app/compras/[negocioId]/comprasNavegacion';
import { IconLoader2 as Loader2, IconSearch as Buscar } from '@tabler/icons-react';

type Modalidad = 'INTERNA' | 'EXTERNA';
const OPCIONES: Array<{ clave: Modalidad; titulo: string; texto: string }> = [
  { clave: 'INTERNA', titulo: 'Lo buscamos nosotros', texto: 'Vamos con nuestro vehículo y equipo.' },
  { clave: 'EXTERNA', titulo: 'Lo trae un transporte', texto: 'Un fletero lo retira y lo lleva.' },
];

interface ItemRetiro { productoId: number; descripcion: string; cantidad: number; estadoLinea?: string | null }
interface ProveedorRetiro { proveedorNombre: string; proveedorDireccion: string | null; proveedorComuna: string | null; proveedorTelefono: string | null; proveedorContacto: string | null; items: ItemRetiro[] }
interface FleteroSug {
  id: number; nombre: string; categoria: 'UNICA' | 'CONSOLIDADA'; tipoCamion: string | null; capacidadCamion: string | null;
  incluyeDescarga: boolean; tienePionetas: boolean; plazoDespachoDias: number | null; nota: number | null; costoTentativo: number | null;
}
interface FleteroCatalogo { id: number; nombre: string; rut: string | null; precio: number | null; activo: boolean; quedoEnPana: boolean }
interface Transporte {
  fleteroId: number | null; nombre: string | null; rut: string | null; telefono: string | null;
  precio: number | null; precioConIva: boolean; origen: string | null; destino: string | null; fecha: string | null; nota: string | null;
}
// El formulario trabaja con texto; se convierte al guardar.
interface FormTransporte { fleteroId: string; nombre: string; rut: string; telefono: string; precio: string; precioConIva: boolean; origen: string; destino: string; fecha: string; nota: string }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fechaCorta = (f: string | null) => f ? f.split('-').reverse().join('-') : '';
const direccionDe = (p: ProveedorRetiro) => [p.proveedorDireccion, p.proveedorComuna].filter(Boolean).join(', ');
const conPunto = (color: string, label: string) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
    <span aria-hidden style={{ backgroundColor: color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />{label}
  </span>
);
const campo = 'mt-0.5 block w-full text-xs text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white';

export function ModalidadRetiroCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [porProv, setPorProv] = useState<Record<string, Modalidad>>({});
  const [transportes, setTransportes] = useState<Record<string, Transporte>>({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorRetiro[] | null>(null);
  const [zona, setZona] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [fleteros, setFleteros] = useState<FleteroSug[] | null>(null);
  // Formulario del transporte (uno abierto a la vez) y el catálogo de fleteros para elegir rápido.
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<FormTransporte | null>(null);
  const [catalogo, setCatalogo] = useState<FleteroCatalogo[] | null>(null);
  const [buscandoRut, setBuscandoRut] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setPorProv(data.porProveedor || {});
      setTransportes(data.transportes || {});
    } catch { /* no bloquea el resto de la pantalla */ }
    finally { setLoading(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);
  // Qué hay que retirar y dónde: sale de las órdenes por proveedor (mismos datos del paso «Órdenes y facturas»).
  useEffect(() => {
    fetch(`/api/compras/${negocioId}/orden-compra-obuma`).then(r => r.json())
      .then(d => setProveedores(d?.success ? (d.proveedores || []) : []))
      .catch(() => setProveedores([]));
  }, [negocioId]);

  const definir = async (proveedor: string, v: Modalidad) => {
    if (!puedeOperar || guardando) return;
    setGuardando(proveedor);
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modalidad: v, proveedor }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo definir');
      setPorProv(data.porProveedor || {});
      setTransportes(data.transportes || {});
      recargarCompartido();
      // Recién marcado «Lo trae un transporte» y sin datos: abrir el formulario de una vez.
      const p = (proveedores || []).find(x => x.proveedorNombre === proveedor);
      if (v === 'EXTERNA' && p && !data.transportes?.[proveedor]) abrirForm(p);
      if (v === 'INTERNA' && editando === proveedor) cerrarForm();
    } catch (e: any) {
      toast.error('No se pudo definir el retiro', e.message);
    } finally {
      setGuardando(null);
    }
  };

  const abrirForm = (p: ProveedorRetiro) => {
    const t = transportes[p.proveedorNombre];
    setEditando(p.proveedorNombre);
    setForm({
      fleteroId: t?.fleteroId ? String(t.fleteroId) : '', nombre: t?.nombre || '', rut: t?.rut || '', telefono: t?.telefono || '',
      precio: t?.precio != null ? String(t.precio) : '', precioConIva: t?.precioConIva ?? false,
      origen: t?.origen ?? direccionDe(p), destino: t?.destino || '', fecha: t?.fecha || '', nota: t?.nota || '',
    });
    if (catalogo == null) {
      fetch('/api/logistica/fleteros').then(r => r.json())
        .then(d => setCatalogo(d?.success ? (d.fleteros || []).filter((f: FleteroCatalogo) => f.activo && !f.quedoEnPana) : []))
        .catch(() => setCatalogo([]));
    }
  };
  const cerrarForm = () => { setEditando(null); setForm(null); };
  const cambiar = (k: keyof FormTransporte, v: string | boolean) => setForm(f => f ? { ...f, [k]: v } : f);

  const elegirDelCatalogo = (id: string) => {
    const f = (catalogo || []).find(x => String(x.id) === id);
    setForm(prev => prev ? { ...prev, fleteroId: id, ...(f ? { nombre: f.nombre, rut: f.rut || prev.rut, precio: prev.precio || (f.precio != null ? String(f.precio) : '') } : {}) } : prev);
  };

  // El nombre para la factura sale de Obuma cuando el RUT ya está registrado ahí (§13.3).
  const buscarRutEnObuma = async () => {
    if (!form?.rut.trim()) return;
    setBuscandoRut(true);
    try {
      const d = await fetch(`/api/logistica/fleteros?rutObuma=${encodeURIComponent(form.rut.trim())}`).then(r => r.json());
      if (d?.success && d.identidad) { cambiar('nombre', d.identidad.razonSocial); toast.success('Encontrado en Obuma', d.identidad.razonSocial); }
      else toast.error('Ese RUT no está en Obuma', 'Escribe el nombre a mano.');
    } catch {
      toast.error('No se pudo buscar en Obuma', '');
    } finally {
      setBuscandoRut(false);
    }
  };

  const guardarTransporte = async (proveedor: string) => {
    if (!form) return;
    if (!form.nombre.trim()) { toast.error('Falta el nombre del transporte', ''); return; }
    setGuardando(proveedor);
    try {
      const precio = Number(form.precio.replace(/[^\d]/g, ''));
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor,
          transporte: {
            fleteroId: form.fleteroId ? Number(form.fleteroId) : null, nombre: form.nombre, rut: form.rut, telefono: form.telefono,
            precio: precio > 0 ? precio : null, precioConIva: form.precioConIva, origen: form.origen, destino: form.destino,
            fecha: form.fecha || null, nota: form.nota,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setPorProv(data.porProveedor || {});
      setTransportes(data.transportes || {});
      cerrarForm();
      toast.success('Transporte guardado', proveedor);
    } catch (e: any) {
      toast.error('No se pudo guardar el transporte', e.message);
    } finally {
      setGuardando(null);
    }
  };

  const buscarFleteros = async () => {
    if (!zona.trim()) return;
    setBuscando(true);
    try {
      const res = await fetch(`/api/logistica/fleteros/sugerencia?zona=${encodeURIComponent(zona.trim())}${urgente ? '&urgente=1' : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      setFleteros(data.sugerencias || []);
    } catch (e: any) {
      toast.error('No se pudo buscar fleteros', e.message);
    } finally {
      setBuscando(false);
    }
  };

  if (loading) return <p className="text-[12.5px] text-slate-400 px-1">Cargando…</p>;

  const aRetirar = (proveedores || []).map(p => ({ ...p, items: p.items.filter(it => it.estadoLinea !== 'RECHAZADA') })).filter(p => p.items.length > 0);
  const definidos = aRetirar.filter(p => porProv[p.proveedorNombre]).length;
  const conTransporte = aRetirar.filter(p => porProv[p.proveedorNombre] === 'EXTERNA');
  const propios = aRetirar.filter(p => porProv[p.proveedorNombre] === 'INTERNA');
  const totalFletes = conTransporte.reduce((s, p) => s + (transportes[p.proveedorNombre]?.precio ?? 0), 0);

  return (
    <div className="space-y-4" data-testid="retiro-guia">
      {/* PASO 1: cada proveedor está en un lugar distinto, así que el retiro se define por proveedor */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div>
          <p className="text-[13px] font-medium text-slate-800 flex items-center gap-2 flex-wrap">
            <span className="inline-flex w-5 h-5 rounded-full bg-teal-700 text-white text-[11px] items-center justify-center">1</span>
            Cómo se retira cada proveedor
            {aRetirar.length > 0 && <span className={`text-xs font-semibold tabular-nums ${definidos === aRetirar.length ? 'text-slate-500' : 'text-amber-700'}`}>{definidos} de {aRetirar.length} definidos</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Elige para cada proveedor si lo vamos a buscar nosotros o lo trae un transporte. Si lo trae un transporte, anota quién es, su RUT, cuánto cobra y el trayecto. Puedes cambiarlo cuando quieras.</p>
        </div>
        {proveedores == null ? <p className="text-xs text-slate-400">Cargando proveedores…</p>
          : aRetirar.length === 0 ? <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Todavía no hay proveedores con productos elegidos. Aparecen aquí cuando elijas el escenario de compra en «Costeo y auditoría».</p>
          : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              {aRetirar.map(p => {
                const elegida = porProv[p.proveedorNombre];
                const t = transportes[p.proveedorNombre];
                const abierto = editando === p.proveedorNombre && form;
                const estado = elegida === 'INTERNA' ? conPunto('#0f766e', 'Lo buscamos nosotros')
                  : elegida === 'EXTERNA' ? (t ? conPunto('#059669', 'Transporte definido') : conPunto('#d97706', 'Faltan los datos del transporte'))
                  : conPunto('#d97706', 'Sin definir');
                return (
                  <div key={p.proveedorNombre} className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3" data-testid={`retiro-prov-${p.proveedorNombre}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13.5px] font-medium text-slate-900">{p.proveedorNombre}</p>
                      <div className="flex-shrink-0">{estado}</div>
                    </div>

                    <dl className="mt-2.5 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-[11px] text-slate-500">Se retira en</dt>
                      <dd className="text-slate-700">{direccionDe(p) || <span className="text-amber-700">Sin dirección: pídesela al proveedor.</span>}</dd>
                      {(p.proveedorContacto || p.proveedorTelefono) && <>
                        <dt className="text-[11px] text-slate-500">Contacto</dt>
                        <dd className="text-slate-700">{[p.proveedorContacto, p.proveedorTelefono].filter(Boolean).join(' · ')}</dd>
                      </>}
                      <dt className="text-[11px] text-slate-500">Productos</dt>
                      <dd className="text-slate-700">
                        <ul className="space-y-0.5">
                          {p.items.map(it => <li key={it.productoId}><span className="tabular-nums font-medium text-slate-900">{it.cantidad} ×</span> {it.descripcion.split(' - ')[0]}</li>)}
                        </ul>
                      </dd>
                    </dl>

                    {/* Elección: dos opciones lado a lado, la marcada en blanco con borde teal */}
                    <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label={`Retiro de ${p.proveedorNombre}`}>
                      {OPCIONES.map(o => {
                        const on = elegida === o.clave;
                        return (
                          <button key={o.clave} type="button" role="radio" aria-checked={on} title={o.texto}
                            onClick={() => definir(p.proveedorNombre, o.clave)} disabled={!puedeOperar || !!guardando} data-testid={`retiro-${o.clave}-${p.proveedorNombre}`}
                            className={`rounded-md px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 ${on ? 'bg-white shadow-sm font-semibold text-teal-800 ring-1 ring-teal-600/40' : 'font-medium text-slate-600 hover:text-slate-900'}`}>
                            {guardando === p.proveedorNombre && !editando && <Loader2 size={12} className="animate-spin text-slate-400" />}
                            {o.titulo}
                          </button>
                        );
                      })}
                    </div>

                    {/* Datos del transporte (migration-158): resumen rotulado, o el formulario */}
                    {elegida === 'EXTERNA' && (
                      <div className="mt-3 pt-3 border-t border-slate-100" data-testid={`retiro-transporte-${p.proveedorNombre}`}>
                        {abierto ? (
                          <div className="space-y-2.5">
                            <p className="text-xs font-medium text-slate-800">Datos del transporte</p>
                            {catalogo && catalogo.length > 0 && (
                              <label className="block text-[11px] text-slate-500">Elegir de los fleteros registrados (opcional)
                                <select value={form.fleteroId} onChange={e => elegirDelCatalogo(e.target.value)} className={campo}>
                                  <option value="">Otro / escribir a mano</option>
                                  {catalogo.map(f => <option key={f.id} value={f.id}>{f.nombre}{f.rut ? ` · ${f.rut}` : ''}</option>)}
                                </select>
                              </label>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <label className="text-[11px] text-slate-500">Nombre o razón social *
                                <input value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} placeholder="Ej: Transportes Pérez SpA" className={campo} />
                              </label>
                              <label className="text-[11px] text-slate-500">RUT (para su factura o pago)
                                <span className="mt-0.5 flex gap-1.5">
                                  <input value={form.rut} onChange={e => cambiar('rut', e.target.value)} placeholder="Ej: 76.123.456-7" className={`${campo} mt-0`} />
                                  <button type="button" onClick={buscarRutEnObuma} disabled={!form.rut.trim() || buscandoRut} title="Traer el nombre desde Obuma"
                                    className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-900 disabled:opacity-40 px-1.5">
                                    {buscandoRut ? <Loader2 size={12} className="animate-spin" /> : <Buscar size={12} />} Obuma
                                  </button>
                                </span>
                              </label>
                              <label className="text-[11px] text-slate-500">Precio que cobra
                                <input value={form.precio} onChange={e => cambiar('precio', e.target.value)} inputMode="numeric" placeholder="Ej: 120000" className={campo} />
                                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                                  <input type="checkbox" checked={form.precioConIva} onChange={e => cambiar('precioConIva', e.target.checked)} className="accent-teal-700" /> El precio incluye IVA
                                </span>
                              </label>
                              <label className="text-[11px] text-slate-500">Teléfono del transporte
                                <input value={form.telefono} onChange={e => cambiar('telefono', e.target.value)} placeholder="Ej: +56 9 1234 5678" className={campo} />
                              </label>
                              <label className="text-[11px] text-slate-500">Desde (dónde retira)
                                <input value={form.origen} onChange={e => cambiar('origen', e.target.value)} placeholder="Dirección del proveedor" className={campo} />
                              </label>
                              <label className="text-[11px] text-slate-500">Hasta (dónde lo deja)
                                <input value={form.destino} onChange={e => cambiar('destino', e.target.value)} placeholder="Ej: bodega Santiago o dirección del cliente" className={campo} />
                              </label>
                              <label className="text-[11px] text-slate-500">Fecha del retiro
                                <input type="date" value={form.fecha} onChange={e => cambiar('fecha', e.target.value)} className={campo} />
                              </label>
                              <label className="text-[11px] text-slate-500">Nota (opcional)
                                <input value={form.nota} onChange={e => cambiar('nota', e.target.value)} placeholder="Ej: retira en la mañana, lleva 2 pionetas" className={campo} />
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => guardarTransporte(p.proveedorNombre)} disabled={!!guardando}
                                className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                                {guardando === p.proveedorNombre && <Loader2 size={12} className="animate-spin" />} Guardar transporte
                              </button>
                              <button type="button" onClick={cerrarForm} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Cancelar</button>
                            </div>
                          </div>
                        ) : t ? (
                          <div>
                            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                              <div className="col-span-2 sm:col-span-1">
                                <dt className="text-[11px] text-slate-500">Transporte</dt>
                                <dd className="mt-0.5 text-xs font-medium text-slate-900">{t.nombre}</dd>
                              </div>
                              <div>
                                <dt className="text-[11px] text-slate-500">RUT</dt>
                                <dd className="mt-0.5 text-xs tabular-nums text-slate-700">{t.rut || <span className="text-amber-700">Falta</span>}</dd>
                              </div>
                              <div>
                                <dt className="text-[11px] text-slate-500">Precio</dt>
                                <dd className="mt-0.5 text-xs">{t.precio != null ? <><b className="tabular-nums text-slate-900">{fmtCLP(t.precio)}</b> <span className="text-slate-500">{t.precioConIva ? 'con IVA' : '+ IVA'}</span></> : <span className="text-amber-700">Falta</span>}</dd>
                              </div>
                              <div className="col-span-2 sm:col-span-3">
                                <dt className="text-[11px] text-slate-500">Trayecto</dt>
                                <dd className="mt-0.5 text-xs text-slate-700">{t.origen || '¿desde?'} <span className="text-slate-400">→</span> {t.destino || <span className="text-amber-700">¿hasta dónde?</span>}</dd>
                              </div>
                              {t.fecha && <div>
                                <dt className="text-[11px] text-slate-500">Retiro</dt>
                                <dd className="mt-0.5 text-xs tabular-nums text-slate-700">{fechaCorta(t.fecha)}</dd>
                              </div>}
                              {t.telefono && <div>
                                <dt className="text-[11px] text-slate-500">Teléfono</dt>
                                <dd className="mt-0.5 text-xs text-slate-700">{t.telefono}</dd>
                              </div>}
                              {t.nota && <div className="col-span-2 sm:col-span-3">
                                <dt className="text-[11px] text-slate-500">Nota</dt>
                                <dd className="mt-0.5 text-xs text-slate-700">{t.nota}</dd>
                              </div>}
                            </dl>
                            {puedeOperar && <button type="button" onClick={() => abrirForm(p)} className="mt-2 text-[12px] font-medium text-teal-700 hover:text-teal-900">Editar transporte</button>}
                          </div>
                        ) : puedeOperar ? (
                          <button type="button" onClick={() => abrirForm(p)}
                            className="text-[12px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg">Agregar datos del transporte</button>
                        ) : <p className="text-xs text-slate-500">Todavía no se anotan los datos del transporte.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        {!puedeOperar && definidos === 0 && aRetirar.length > 0 && <p className="text-xs text-slate-400">Todavía no se ha elegido; lo hace el encargado de Compras.</p>}
      </section>

      {/* PASO 2: qué hacer, según lo elegido por proveedor */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <p className="text-[13px] font-medium text-slate-800 flex items-center gap-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-teal-700 text-white text-[11px] items-center justify-center">2</span>
          Lo que sigue
        </p>
        {definidos === 0 && <p className="text-xs text-slate-500">Primero elige arriba cómo se retira cada proveedor y aquí te digo qué hacer con cada uno.</p>}

        {propios.length > 0 && (
          <div className="rounded-lg border border-slate-200 px-3 py-2.5">
            <p className="text-xs font-medium text-slate-800">Retiro con tu equipo <span className="font-normal text-slate-500">· {propios.map(p => p.proveedorNombre).join(', ')}</span></p>
            <ol className="mt-1.5 text-xs text-slate-700 space-y-1 list-decimal pl-5">
              <li>Llama a cada uno de estos proveedores y acuerda el día y la hora del retiro.</li>
              <li>Lleva la orden de compra (o el número) para que te entreguen lo correcto.</li>
              <li>Al retirar, revisa que la cantidad y el modelo coincidan con la lista de arriba.</li>
              <li>Si gastas en combustible, peajes o ayudantes, anótalo como gasto.</li>
            </ol>
          </div>
        )}

        {conTransporte.length > 0 && (
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 space-y-2">
            <p className="text-xs font-medium text-slate-800">Con transporte <span className="font-normal text-slate-500">· {conTransporte.length} proveedor(es){totalFletes > 0 && <> · fletes anotados: <b className="tabular-nums text-slate-800">{fmtCLP(totalFletes)}</b></>}</span></p>
            <p className="text-xs text-slate-500">¿No tienes transporte? Escribe a qué ciudad o comuna hay que llevar la mercadería y el sistema te muestra los fleteros registrados que llegan allá, del más conveniente al menos conveniente.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={zona} onChange={e => setZona(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscarFleteros(); }} placeholder="Ej: Coyhaique" data-testid="retiro-zona"
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 w-56 outline-none focus:ring-1 focus:ring-teal-600" />
              <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={urgente} onChange={e => setUrgente(e.target.checked)} className="accent-teal-700" /> Es urgente (solo carga única)</label>
              <button type="button" onClick={buscarFleteros} disabled={!zona.trim() || buscando}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {buscando ? <Loader2 size={13} className="animate-spin" /> : <Buscar size={13} />} Ver fleteros
              </button>
            </div>
            {fleteros && (fleteros.length === 0
              ? <p className="text-xs text-amber-800">No hay fleteros registrados que lleguen a «{zona}». Cotiza uno por tu cuenta y anótalo en el proveedor, arriba.</p>
              : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="retiro-fleteros">
                  {fleteros.map((f, i) => (
                    <li key={f.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-semibold tabular-nums text-slate-400 w-4">{i + 1}</span>
                      <span className="flex-1 min-w-[200px]">
                        <span className="block text-xs font-medium text-slate-900">{f.nombre} <span className="font-normal text-slate-500">· {f.categoria === 'UNICA' ? 'carga única' : 'carga consolidada'}</span></span>
                        <span className="block text-[11px] text-slate-500">{[f.tipoCamion, f.capacidadCamion, f.incluyeDescarga ? 'incluye descarga' : null, f.tienePionetas ? 'con pionetas' : null, f.plazoDespachoDias != null ? `despacha en ${f.plazoDespachoDias} d` : null, f.nota != null ? `nota ${f.nota}` : null].filter(Boolean).join(' · ') || 'Sin más datos'}</span>
                      </span>
                      <span className="text-right"><b className="block text-xs tabular-nums text-slate-900">{fmtCLP(f.costoTentativo)}</b><span className="block text-[11px] text-slate-500">tentativo</span></span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}

        {definidos > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center gap-3 flex-wrap">
            <p className="flex-1 min-w-[220px] text-xs text-slate-700"><b className="font-medium text-slate-900">Cuando se pague el flete, el combustible o algo parecido,</b> anótalo en «Gastos extra»: así queda dentro del costo real del proyecto.</p>
            <button type="button" onClick={() => enfocarProducto('gastos', null)} className="text-[12px] font-semibold text-teal-700 hover:text-teal-900">Ir a Gastos extra →</button>
          </div>
        )}
      </section>
    </div>
  );
}
