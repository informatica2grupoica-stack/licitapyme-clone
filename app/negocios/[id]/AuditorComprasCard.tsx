'use client';

// AUDITOR DE COMPRAS (spec §8) — bandeja de cotizaciones (cualquier formato, sin límite de
// proveedores), cuadro comparativo con huecos visibles, espacio de negociación detectado y los
// 4 escenarios de compra (el de "Más rápido" como principal). Es un SUGERIDOR: nunca excluye un
// proveedor por incumplimiento técnico, solo lo clasifica.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { parsearMontoCL } from '@/app/lib/numeros';
import {
  Gavel, Loader2, Plus, X, Sparkles, TrendingDown, Truck, Zap, Scale, DollarSign, CheckCircle2, Paperclip, ListChecks, Save,
} from 'lucide-react';

type Origen = 'pdf' | 'imagen' | 'whatsapp' | 'texto' | 'correo' | 'llamada';
type Cumple = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
type TipoEscenario = 'MAS_RAPIDO' | 'MINIMO_PRECIO' | 'MINIMOS_VIAJES' | 'EQUILIBRADO';

interface Cotizacion {
  id: number; proveedorNombre: string; proveedorRut: string | null; proveedorNuevo: boolean | null;
  origen: Origen; precioUnitario: number | null; precioTotal: number | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitarioClp: number | null;
  plazoEntregaTexto: string | null; homologadaAt: string | null; archivoUrl: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; cumple: Cumple; detalleDesviacion: string | null }>;
}
interface FilaCuadro { productoId: number; descripcion: string; cotizacionesPorProveedor: Array<{ proveedor: string; precioUnitario: number | null; cumple: Cumple | null }>; cubierto: boolean; puntosCriticos: string | null }
interface Producto { id: number; descripcion: string; subestado: string }
interface Negociacion { productoId: number; descripcion: string; minimo: number; maximo: number; diferencia: number; proveedorMasCaro: string }
interface DetalleProductoEscenario { productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null; plazoEntregaDias: number | null }
interface Escenario {
  tipo: TipoEscenario; costoTotal: number; diasEstimados: number | null; viajesEstimados: number; esPrincipal: boolean;
  detalle: { porProducto: DetalleProductoEscenario[]; proveedoresInvolucrados: string[] };
}

const ORIGEN_LABEL: Record<Origen, string> = { pdf: 'PDF', imagen: 'Imagen', whatsapp: 'WhatsApp', texto: 'Texto', correo: 'Correo', llamada: 'Llamada' };
const CUMPLE_STYLE: Record<Cumple, string> = {
  CUMPLE: 'text-emerald-700 bg-emerald-50 border-emerald-200', MEJORA: 'text-teal-700 bg-teal-50 border-teal-200',
  INFERIOR_NEGOCIABLE: 'text-amber-700 bg-amber-50 border-amber-200', INFERIOR_INSALVABLE: 'text-rose-700 bg-rose-50 border-rose-200',
  NO_ES_EL_PRODUCTO: 'text-zinc-400 bg-zinc-50 border-zinc-200',
};
const CUMPLE_LABEL: Record<Cumple, string> = {
  CUMPLE: 'Cumple', MEJORA: 'Mejora', INFERIOR_NEGOCIABLE: 'Inferior (negociable)', INFERIOR_INSALVABLE: 'Inferior (insalvable)', NO_ES_EL_PRODUCTO: 'No es el producto',
};
const ESCENARIO_META: Record<TipoEscenario, { label: string; icon: React.ReactNode }> = {
  MAS_RAPIDO: { label: 'Más rápido', icon: <Zap size={14} /> }, MINIMO_PRECIO: { label: 'Mínimo precio', icon: <DollarSign size={14} /> },
  MINIMOS_VIAJES: { label: 'Mínimos viajes', icon: <Truck size={14} /> }, EQUILIBRADO: { label: 'Equilibrado', icon: <Scale size={14} /> },
};
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function AuditorComprasCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cuadro, setCuadro] = useState<FilaCuadro[]>([]);
  const [negociacion, setNegociacion] = useState<Negociacion[]>([]);
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [elegidoTipo, setElegidoTipo] = useState<TipoEscenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [homologando, setHomologando] = useState<number | null>(null);
  const [eligiendo, setEligiendo] = useState<TipoEscenario | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [guardandoForm, setGuardandoForm] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [catalogoProveedores, setCatalogoProveedores] = useState<Array<{ id: number; nombreEmpresa: string; rut: string | null }>>([]);
  const [form, setForm] = useState({
    proveedorId: '', proveedorNombre: '', proveedorRut: '', origen: 'texto' as Origen, descripcionLibre: '',
    precioUnitario: '', moneda: 'CLP', plazoEntregaTexto: '', incluyeFlete: '' as '' | 'true' | 'false', vigenciaAt: '',
  });
  // Multi-ítem al crear (§8.7): opcional — si el comprador ya sabe a qué producto(s) corresponde
  // esta cotización, lo marca acá de una vez en vez de crearla y abrir "Asignar productos" después.
  const [itemsCreacion, setItemsCreacion] = useState<Record<number, { activo: boolean; precioUnitario: string; cumple: Cumple }>>({});

  const cargar = useCallback(async () => {
    try {
      const [rCot, rEsc, rProd, rProv] = await Promise.all([
        fetch(`/api/compras/${negocioId}/cotizaciones`), fetch(`/api/compras/${negocioId}/escenarios`), fetch(`/api/compras/${negocioId}/productos`),
        fetch(`/api/compras/proveedores`),
      ]);
      const [dCot, dEsc, dProd, dProv] = await Promise.all([rCot.json(), rEsc.json(), rProd.json(), rProv.json()]);
      if (dCot.success) setCotizaciones(dCot.cotizaciones || []);
      if (dEsc.success) { setCuadro(dEsc.cuadro || []); setNegociacion(dEsc.negociacion || []); setEscenarios(dEsc.escenarios || []); setElegidoTipo(dEsc.elegidoTipo || null); }
      if (dProd.success) setProductos((dProd.productos || []).filter((p: any) => p.subestado !== 'RENUNCIADO'));
      if (dProv.success) setCatalogoProveedores(dProv.proveedores || []);
    } catch (e: any) {
      toast.error('No se pudo cargar el Auditor de Compras', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const crearCotizacion = async () => {
    if (!form.proveedorNombre.trim() && !form.proveedorId && !archivo) return;
    setGuardandoForm(true);
    try {
      const items = Object.entries(itemsCreacion).filter(([, v]) => v.activo)
        .map(([productoId, v]) => ({ productoId: Number(productoId), precioUnitario: parsearMontoCL(v.precioUnitario), cumple: v.cumple }));
      // §8.3: "todos los formatos posibles" — con archivo (PDF/imagen/captura de WhatsApp) va
      // multipart; sin archivo (texto pegado, correo copiado, llamada telefónica) va JSON directo.
      let res: Response;
      if (archivo) {
        const fd = new FormData();
        fd.set('file', archivo);
        if (form.proveedorId) fd.set('proveedorId', form.proveedorId);
        fd.set('proveedorNombre', form.proveedorNombre.trim());
        if (form.proveedorRut.trim()) fd.set('proveedorRut', form.proveedorRut.trim());
        fd.set('origen', form.origen);
        if (form.descripcionLibre.trim()) fd.set('descripcionLibre', form.descripcionLibre.trim());
        if (form.precioUnitario) fd.set('precioUnitario', form.precioUnitario);
        if (form.moneda !== 'CLP') fd.set('moneda', form.moneda);
        if (form.plazoEntregaTexto.trim()) fd.set('plazoEntregaTexto', form.plazoEntregaTexto.trim());
        if (form.incluyeFlete) fd.set('incluyeFlete', form.incluyeFlete);
        if (items.length > 0) fd.set('items', JSON.stringify(items));
        res = await fetch(`/api/compras/${negocioId}/cotizaciones`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proveedorId: form.proveedorId ? Number(form.proveedorId) : null,
            proveedorNombre: form.proveedorNombre.trim(), proveedorRut: form.proveedorRut.trim() || null,
            origen: form.origen, descripcionLibre: form.descripcionLibre.trim() || null,
            precioUnitario: parsearMontoCL(form.precioUnitario),
            moneda: form.moneda,
            plazoEntregaTexto: form.plazoEntregaTexto.trim() || null,
            incluyeFlete: form.incluyeFlete ? form.incluyeFlete === 'true' : null,
            vigenciaAt: form.vigenciaAt || null,
            items: items.length > 0 ? items : undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Cotización registrada');
      setForm({ proveedorId: '', proveedorNombre: '', proveedorRut: '', origen: 'texto', descripcionLibre: '', precioUnitario: '', moneda: 'CLP', plazoEntregaTexto: '', incluyeFlete: '', vigenciaAt: '' });
      setArchivo(null);
      setItemsCreacion({});
      setFormAbierto(false);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar la cotización', e.message);
    } finally {
      setGuardandoForm(false);
    }
  };

  const homologar = async (id: number) => {
    setHomologando(id);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${id}/homologar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo homologar');
      toast.success('Cotización homologada', `${data.items} producto(s) mapeado(s).`);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo homologar', e.message);
    } finally {
      setHomologando(null);
    }
  };

  // Asignación MANUAL de productos a una cotización (§8.7) — corrige o reemplaza lo que decidió la
  // IA, o evita depender de ella cuando el comprador ya sabe con certeza a qué productos corresponde.
  const [asignandoId, setAsignandoId] = useState<number | null>(null);
  const [borradorAsignacion, setBorradorAsignacion] = useState<Record<number, { activo: boolean; precioUnitario: string; cumple: Cumple }>>({});
  const [guardandoAsignacion, setGuardandoAsignacion] = useState(false);

  const abrirAsignacion = (c: Cotizacion) => {
    setAsignandoId(c.id);
    const draft: typeof borradorAsignacion = {};
    for (const p of productos) {
      const existente = c.items.find(it => it.productoId === p.id);
      draft[p.id] = { activo: !!existente, precioUnitario: existente?.precioUnitario != null ? String(existente.precioUnitario) : (c.precioUnitario != null ? String(c.precioUnitario) : ''), cumple: existente?.cumple || 'CUMPLE' };
    }
    setBorradorAsignacion(draft);
  };

  const guardarAsignacion = async (cotizacionId: number) => {
    setGuardandoAsignacion(true);
    try {
      const items = Object.entries(borradorAsignacion).filter(([, v]) => v.activo)
        .map(([productoId, v]) => ({ productoId: Number(productoId), precioUnitario: parsearMontoCL(v.precioUnitario), cumple: v.cumple }));
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/items`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Asignación guardada');
      setAsignandoId(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar la asignación', e.message);
    } finally {
      setGuardandoAsignacion(false);
    }
  };

  const elegir = async (tipo: TipoEscenario) => {
    let justificacion: string | null = null;
    if (tipo !== 'MAS_RAPIDO') {
      justificacion = window.prompt('Este no es el escenario "Más rápido" — justifica por qué lo eliges (spec §8.10.4):');
      if (!justificacion?.trim()) return;
    }
    setEligiendo(tipo);
    try {
      const res = await fetch(`/api/compras/${negocioId}/escenarios`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, justificacion }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo elegir');
      toast.success('Escenario elegido', 'Queda registrado para la aprobación de compra.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo elegir el escenario', e.message);
    } finally {
      setEligiendo(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
          <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Gavel size={14} /> Auditor de Compras — cotizaciones</p>
          {puedeOperar && (
            <button onClick={() => setFormAbierto(v => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">
              <Plus size={13} /> Registrar cotización
            </button>
          )}
        </div>

        {formAbierto && (
          <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-zinc-50/60">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Select value={form.proveedorId} minWidth={200}
                placeholder="Elegir del catálogo…"
                onChange={v => {
                  const p = catalogoProveedores.find(x => String(x.id) === v);
                  setForm(f => ({ ...f, proveedorId: v, proveedorNombre: p?.nombreEmpresa || f.proveedorNombre, proveedorRut: p?.rut || f.proveedorRut }));
                }}
                options={catalogoProveedores.map(p => ({ value: String(p.id), label: p.nombreEmpresa }))} />
              <input value={form.proveedorNombre} onChange={e => setForm(f => ({ ...f, proveedorNombre: e.target.value, proveedorId: '' }))}
                placeholder="…o proveedor nuevo (nombre)" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.proveedorRut} onChange={e => setForm(f => ({ ...f, proveedorRut: e.target.value }))}
                placeholder="RUT (opcional)" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.origen} onChange={v => setForm(f => ({ ...f, origen: v as Origen }))}
                options={(Object.keys(ORIGEN_LABEL) as Origen[]).map(o => ({ value: o, label: ORIGEN_LABEL[o] }))} minWidth={120} />
            </div>
            <a href="/compras/proveedores" target="_blank" rel="noopener noreferrer" className="inline-block text-[10.5px] text-teal-600 hover:text-teal-700">¿No está en la lista? Agregarlo al catálogo →</a>
            <textarea rows={2} value={form.descripcionLibre} onChange={e => setForm(f => ({ ...f, descripcionLibre: e.target.value }))}
              placeholder="Qué cotizó (productos, condiciones)…" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <div className="grid grid-cols-3 gap-2">
              <input inputMode="numeric" value={form.precioUnitario} onChange={e => setForm(f => ({ ...f, precioUnitario: e.target.value }))}
                placeholder="Precio unitario" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.moneda} onChange={v => setForm(f => ({ ...f, moneda: v }))} minWidth={90}
                options={[{ value: 'CLP', label: 'CLP' }, { value: 'USD', label: 'USD' }]} />
              <input value={form.plazoEntregaTexto} onChange={e => setForm(f => ({ ...f, plazoEntregaTexto: e.target.value }))}
                placeholder="Plazo de entrega" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>
            {form.moneda !== 'CLP' && (
              <p className="text-[10.5px] text-amber-600">Se convierte a CLP con el dólar del día (fuente: mindicador.cl) al guardar — la ficha del cuadro comparativo usa el valor convertido.</p>
            )}
            <div className="grid grid-cols-2 gap-2 items-center">
              <Select value={form.incluyeFlete} onChange={v => setForm(f => ({ ...f, incluyeFlete: v as typeof f.incluyeFlete }))}
                placeholder="¿Incluye flete?" minWidth={140}
                options={[{ value: 'true', label: 'Incluye flete' }, { value: 'false', label: 'No incluye flete' }]} />
              <label className="text-[11px] font-semibold text-zinc-500">
                Vigente hasta (opcional, spec §8.12)
                <input type="date" value={form.vigenciaAt} onChange={e => setForm(f => ({ ...f, vigenciaAt: e.target.value }))}
                  className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              </label>
            </div>
            {productos.length > 0 && (
              <div className="border border-zinc-200 rounded-lg p-2.5 space-y-1.5 bg-white">
                <p className="text-[11px] font-semibold text-zinc-500">
                  ¿A qué producto(s) corresponde? (opcional, spec §8.7) — si lo sabés con certeza marcalo acá, así no hace falta "Asignar productos" después. Si no marcás nada, el agente de IA la homologa sola apenas guardes.
                </p>
                {productos.map(p => {
                  const draft = itemsCreacion[p.id] || { activo: false, precioUnitario: '', cumple: 'CUMPLE' as Cumple };
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={draft.activo} className="accent-teal-600"
                        onChange={e => setItemsCreacion(b => ({ ...b, [p.id]: { ...draft, activo: e.target.checked } }))} />
                      <span className="text-[11.5px] text-zinc-700 flex-1 min-w-0 truncate">{p.descripcion}</span>
                      {draft.activo && (
                        <>
                          <input inputMode="numeric" value={draft.precioUnitario} placeholder={`Precio unitario${form.moneda !== 'CLP' ? ` (${form.moneda})` : ''}`}
                            onChange={e => setItemsCreacion(b => ({ ...b, [p.id]: { ...draft, precioUnitario: e.target.value } }))}
                            className="w-32 text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-500" />
                          <Select value={draft.cumple} minWidth={150}
                            onChange={v => setItemsCreacion(b => ({ ...b, [p.id]: { ...draft, cumple: v as Cumple } }))}
                            options={(Object.keys(CUMPLE_LABEL) as Cumple[]).map(k => ({ value: k, label: CUMPLE_LABEL[k] }))} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <label className="block text-[11px] font-semibold text-zinc-500">
              Archivo (PDF, imagen, captura de WhatsApp — opcional, spec §8.3)
              <input type="file" accept=".pdf,image/*" onChange={e => setArchivo(e.target.files?.[0] || null)}
                className="mt-0.5 w-full text-[11.5px] text-zinc-600 file:mr-2 file:text-[11px] file:font-semibold file:text-teal-700 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2 file:py-1" />
              {archivo && <span className="text-[10.5px] text-zinc-400">{archivo.name}</span>}
            </label>
            <p className="text-[10.5px] text-zinc-400">
              El proveedor que escribas acá (si no está en el catálogo) se agrega solo con nombre y RUT — después puedes completarle correo, teléfono, categoría y cuenta bancaria en <a href="/compras/proveedores" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 font-semibold">Proveedores</a>.
              {archivo && ' Si subes un archivo, se intenta leer proveedor/precio/plazo del documento para completar lo que dejes vacío.'}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={crearCotizacion} disabled={(!form.proveedorNombre.trim() && !form.proveedorId && !archivo) || guardandoForm}
                className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardandoForm ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setFormAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          </div>
        )}

        {cotizaciones.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-zinc-400">Sin cotizaciones todavía. Óptimo: tres por producto (spec §8.11).</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {cotizaciones.map(c => (
              <div key={c.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-zinc-800">
                      {c.proveedorNombre}
                      {c.proveedorNuevo != null && (
                        <span className="ml-1.5 text-[10px] font-bold text-zinc-400">{c.proveedorNuevo ? '(nuevo)' : '(antiguo)'}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {ORIGEN_LABEL[c.origen]}
                      {c.precioUnitario != null && (
                        c.moneda !== 'CLP'
                          ? ` · ${c.moneda} ${c.precioUnitario.toLocaleString('es-CL')}${c.precioUnitarioClp != null ? ` (${fmtCLP(c.precioUnitarioClp)} al día del registro, $${c.tipoCambioUsado})` : ' — sin convertir, no entra al comparativo'}`
                          : ` · ${fmtCLP(c.precioUnitario)}`
                      )}
                      {c.plazoEntregaTexto && ` · ${c.plazoEntregaTexto}`}
                      {c.archivoUrl && (
                        <a href={c.archivoUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-teal-600 hover:text-teal-700 font-semibold">
                          <Paperclip size={10} /> Ver archivo
                        </a>
                      )}
                    </p>
                    {c.items.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.items.map(it => (
                          <span key={it.productoId} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CUMPLE_STYLE[it.cumple]}`}>
                            {productos.find(p => p.id === it.productoId)?.descripcion || `#${it.productoId}`}: {CUMPLE_LABEL[it.cumple]}{it.precioUnitario != null && ` · ${fmtCLP(it.precioUnitario)}`}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-amber-600 mt-0.5">Todavía no está asignada a ningún producto — no aparece en el cuadro comparativo.</p>
                    )}
                  </div>
                  {puedeOperar && (
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <button onClick={() => (asignandoId === c.id ? setAsignandoId(null) : abrirAsignacion(c))}
                        className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-800">
                        <ListChecks size={12} /> {asignandoId === c.id ? 'Cerrar' : 'Asignar productos'}
                      </button>
                      <button onClick={() => homologar(c.id)} disabled={homologando === c.id}
                        className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                        {homologando === c.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {c.homologadaAt ? 'Re-homologar' : 'Homologar con IA'}
                      </button>
                    </div>
                  )}
                </div>

                {/* §8.7: una cotización puede cubrir varios productos — acá se elige a mano cuáles,
                    con su propio precio y cumplimiento por producto, sin depender de que la IA
                    adivine bien desde el texto libre. Precarga lo que ya haya (de la IA o de una
                    edición anterior) y GUARDAR reemplaza esa asignación completa. */}
                {asignandoId === c.id && (
                  <div className="mt-2 border border-zinc-200 rounded-lg p-2.5 space-y-1.5 bg-zinc-50/60">
                    {productos.map(p => {
                      const draft = borradorAsignacion[p.id] || { activo: false, precioUnitario: '', cumple: 'CUMPLE' as Cumple };
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <input type="checkbox" checked={draft.activo} className="accent-teal-600"
                            onChange={e => setBorradorAsignacion(b => ({ ...b, [p.id]: { ...draft, activo: e.target.checked } }))} />
                          <span className="text-[11.5px] text-zinc-700 flex-1 min-w-0 truncate">{p.descripcion}</span>
                          {draft.activo && (
                            <>
                              <input inputMode="numeric" value={draft.precioUnitario} placeholder="Precio unitario"
                                onChange={e => setBorradorAsignacion(b => ({ ...b, [p.id]: { ...draft, precioUnitario: e.target.value } }))}
                                className="w-28 text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-500" />
                              <Select value={draft.cumple} minWidth={150}
                                onChange={v => setBorradorAsignacion(b => ({ ...b, [p.id]: { ...draft, cumple: v as Cumple } }))}
                                options={(Object.keys(CUMPLE_LABEL) as Cumple[]).map(k => ({ value: k, label: CUMPLE_LABEL[k] }))} />
                            </>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => guardarAsignacion(c.id)} disabled={guardandoAsignacion}
                        className="flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                        {guardandoAsignacion ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar asignación
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {negociacion.length > 0 && (
        <Banner variante="info">
          <span className="font-semibold flex items-center gap-1"><TrendingDown size={13} /> Espacio de negociación detectado:</span>
          <ul className="mt-1 space-y-0.5">
            {negociacion.map(n => (
              <li key={n.productoId} className="text-[12px]">
                <span className="font-semibold">{n.descripcion}</span>: {fmtCLP(n.minimo)} a {fmtCLP(n.maximo)} — negociar con {n.proveedorMasCaro} (diferencia {fmtCLP(n.diferencia)}).
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {cuadro.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">Cuadro comparativo</p>
          <div className="divide-y divide-zinc-100">
            {cuadro.map(f => (
              <div key={f.productoId} className="px-4 py-2.5">
                <p className="text-[12px] font-semibold text-zinc-800">{f.descripcion}</p>
                {!f.cubierto ? (
                  <p className="text-[11px] text-amber-600 mt-0.5">Sin ninguna cotización todavía — hueco visible.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {f.cotizacionesPorProveedor.map((p, i) => (
                      <span key={i} className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full border ${p.cumple ? CUMPLE_STYLE[p.cumple] : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                        {p.proveedor}: {fmtCLP(p.precioUnitario)}
                      </span>
                    ))}
                  </div>
                )}
                {f.puntosCriticos && (
                  <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 mt-1.5 flex items-start gap-1">
                    <Sparkles size={11} className="mt-0.5 flex-shrink-0" /> {f.puntosCriticos}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {escenarios.length > 0 && (
        <>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-zinc-400 uppercase px-0.5">Escenarios</p>
          {/* El costo de viaje de estos escenarios usa el valor fijo interno (§8.10.2) mientras no
              se sepa con certeza la zona de retiro de cada proveedor — el catálogo de fleteros
              (§13.3-§13.5) es la herramienta para consultar precio real por zona antes de decidir. */}
          <a href="/logistica/fleteros" target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Ver sugerencia de fletero por zona →</a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {escenarios.map(e => (
            <div key={e.tipo} className={`bg-white rounded-xl border p-3 ${elegidoTipo === e.tipo ? 'border-emerald-300 ring-1 ring-emerald-100' : e.esPrincipal ? 'border-teal-300 ring-1 ring-teal-100' : 'border-zinc-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-bold text-zinc-800 flex items-center gap-1.5">
                  {ESCENARIO_META[e.tipo].icon} {ESCENARIO_META[e.tipo].label}
                  {e.esPrincipal && <span className="text-[9.5px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">Principal</span>}
                </p>
                {elegidoTipo === e.tipo && (
                  <span className="flex-shrink-0 flex items-center gap-1 text-[9.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                    <CheckCircle2 size={10} /> Elegido
                  </span>
                )}
              </div>
              <p className="text-[15px] font-bold text-zinc-900 mt-1">{fmtCLP(e.costoTotal)}</p>
              <p className="text-[11px] text-zinc-400">{e.viajesEstimados} viaje(s){e.diasEstimados != null && ` · ${e.diasEstimados} día(s) máx.`}</p>

              {/* Qué te están ofreciendo de verdad en este escenario — proveedor y precio elegidos
                  por producto, no solo el total. Sin esto, "Elegir este escenario" era una caja
                  negra: un número sin decir a quién le compra ni por qué (pedido explícito del
                  usuario, 10-sep-2026). */}
              <div className="mt-2 pt-2 border-t border-zinc-100 space-y-1">
                {e.detalle.porProducto.map(p => (
                  <div key={p.productoId} className="text-[10.5px]">
                    <p className="text-zinc-600 truncate">{p.descripcion}</p>
                    {p.proveedor ? (
                      <p className="text-zinc-400">
                        <span className="font-semibold text-zinc-600">{p.proveedor}</span>
                        {p.subtotal != null && ` · ${fmtCLP(p.subtotal)}`}
                        {p.cantidad != null && ` (${p.cantidad} un.)`}
                        {p.plazoEntregaDias != null && ` · ${p.plazoEntregaDias} día(s)`}
                      </p>
                    ) : (
                      <p className="text-amber-600 font-semibold">Sin cotización — no cubierto todavía</p>
                    )}
                  </div>
                ))}
              </div>

              {puedeOperar && elegidoTipo !== e.tipo && (
                <button onClick={() => elegir(e.tipo)} disabled={eligiendo === e.tipo}
                  className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                  {eligiendo === e.tipo ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Elegir este escenario
                </button>
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
