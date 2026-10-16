'use client';

// MODALIDAD DE RETIRO (spec §13.2) — "se define en el primer instante... la define el humano, el
// sistema propone, no decide". Por eso este bloque NUNCA decide solo: registra la elección del humano.
// Guía en 3 pasos: 1) cómo se va a buscar lo comprado, 2) qué hay que retirar y dónde (por proveedor),
// 3) según la modalidad: fleteros sugeridos (externa/mixta) o checklist de retiro propio (interna).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { enfocarProducto } from '@/app/compras/[negocioId]/comprasNavegacion';
import { IconTruck as Truck, IconLoader2 as Loader2, IconCircleCheck as Check, IconMapPin as Pin, IconSearch as Buscar } from '@tabler/icons-react';

type Modalidad = 'INTERNA' | 'EXTERNA' | 'MIXTA';
const OPCIONES: Array<{ clave: Modalidad; titulo: string; texto: string }> = [
  { clave: 'INTERNA', titulo: 'Lo buscamos nosotros', texto: 'Vamos con nuestro vehículo y equipo a retirar a cada proveedor.' },
  { clave: 'EXTERNA', titulo: 'Lo trae un transporte', texto: 'Contratamos un fletero o transportista para que lo retire y lo lleve.' },
  { clave: 'MIXTA', titulo: 'Un poco de cada uno', texto: 'Algunos productos los buscamos nosotros y otros los lleva un transporte.' },
];
const MODALIDAD_LABEL: Record<Modalidad, string> = { INTERNA: 'Interna', EXTERNA: 'Externa', MIXTA: 'Mixta' };

interface ItemRetiro { productoId: number; descripcion: string; cantidad: number; estadoLinea?: string | null }
interface ProveedorRetiro { proveedorNombre: string; proveedorDireccion: string | null; proveedorComuna: string | null; proveedorTelefono: string | null; proveedorContacto: string | null; items: ItemRetiro[] }
interface FleteroSug {
  id: number; nombre: string; categoria: 'UNICA' | 'CONSOLIDADA'; tipoCamion: string | null; capacidadCamion: string | null;
  incluyeDescarga: boolean; tienePionetas: boolean; plazoDespachoDias: number | null; nota: number | null; costoTentativo: number | null;
}
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ModalidadRetiroCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [definidaPorNombre, setDefinidaPorNombre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState<Modalidad | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorRetiro[] | null>(null);
  const [zona, setZona] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [fleteros, setFleteros] = useState<FleteroSug[] | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setModalidad(data.modalidad); setDefinidaPorNombre(data.definidaPorNombre);
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

  const definir = async (v: Modalidad) => {
    if (!puedeOperar || guardando) return;
    setGuardando(v);
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modalidad: v }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo definir');
      setModalidad(data.modalidad); setDefinidaPorNombre(data.definidaPorNombre);
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo definir la modalidad', e.message);
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

  if (loading) return <p className="text-[12.5px] text-zinc-400 px-1">Cargando…</p>;

  const usaTransporte = modalidad === 'EXTERNA' || modalidad === 'MIXTA';
  const aRetirar = (proveedores || []).map(p => ({ ...p, items: p.items.filter(it => it.estadoLinea !== 'RECHAZADA') })).filter(p => p.items.length > 0);

  return (
    <div className="space-y-4" data-testid="retiro-guia">
      {/* PASO 1 */}
      <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
        <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">1</span>
          ¿Cómo se va a buscar lo que compraste?
          {modalidad && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">✔ Elegido: {MODALIDAD_LABEL[modalidad]}</span>}
        </p>
        <p className="text-[12px] text-zinc-500">Elige una opción. Es solo un registro de cómo lo van a hacer; no cuesta nada ni se puede equivocar: puedes cambiarla cuando quieras.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {OPCIONES.map(o => {
            const on = modalidad === o.clave;
            return (
              <button key={o.clave} type="button" onClick={() => definir(o.clave)} disabled={!puedeOperar || !!guardando} data-testid={`retiro-${o.clave}`}
                className={`text-left rounded-xl border-2 px-3.5 py-3 transition-colors disabled:cursor-not-allowed ${on ? 'border-teal-500 bg-teal-50' : 'border-zinc-200 bg-white hover:border-teal-300 hover:bg-zinc-50'}`}>
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-zinc-800">
                  {guardando === o.clave ? <Loader2 size={14} className="animate-spin text-zinc-400" /> : on ? <Check size={15} className="text-teal-600" /> : <Truck size={14} className="text-zinc-400" />}
                  {o.titulo}
                </span>
                <span className="block mt-1 text-[11.5px] text-zinc-500 leading-snug">{o.texto}</span>
              </button>
            );
          })}
        </div>
        {modalidad && definidaPorNombre && <p className="text-[11px] text-zinc-400">Definida por {definidaPorNombre}.</p>}
        {!puedeOperar && !modalidad && <p className="text-[11.5px] text-zinc-400">Todavía no se ha elegido; lo hace el encargado de Compras.</p>}
      </section>

      {/* PASO 2 */}
      <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
        <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">2</span>
          Qué hay que retirar y dónde
        </p>
        {proveedores == null ? <p className="text-[12px] text-zinc-400">Cargando proveedores…</p>
          : aRetirar.length === 0 ? <p className="text-[12px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">Todavía no hay proveedores con productos elegidos. Aparecen aquí cuando elijas el escenario de compra en «Costeo y auditoría».</p>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {aRetirar.map(p => (
                <div key={p.proveedorNombre} className="rounded-lg border border-zinc-200 px-3 py-2.5">
                  <p className="text-[12.5px] font-bold text-zinc-800">{p.proveedorNombre}</p>
                  <p className="text-[11.5px] text-zinc-600 flex items-start gap-1 mt-0.5">
                    <Pin size={12} className="flex-shrink-0 mt-0.5 text-zinc-400" />
                    {[p.proveedorDireccion, p.proveedorComuna].filter(Boolean).join(', ') || <span className="text-amber-700">Sin dirección registrada: pídesela al proveedor.</span>}
                  </p>
                  {(p.proveedorContacto || p.proveedorTelefono) && <p className="text-[11.5px] text-zinc-500 mt-0.5">Contacto: {[p.proveedorContacto, p.proveedorTelefono].filter(Boolean).join(' · ')}</p>}
                  <ul className="mt-1.5 text-[11.5px] text-zinc-700 space-y-0.5">
                    {p.items.map(it => <li key={it.productoId}>• {it.cantidad} × {it.descripcion.split(' - ')[0]}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* PASO 3 */}
      <section className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
        <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">3</span>
          {modalidad === 'INTERNA' ? 'Prepara el retiro con tu equipo' : usaTransporte ? 'Busca un transporte' : 'Lo que sigue'}
        </p>
        {!modalidad && <p className="text-[12px] text-zinc-500">Primero elige arriba cómo se va a buscar y aquí te digo qué hacer.</p>}

        {modalidad === 'INTERNA' && (
          <ol className="text-[12px] text-zinc-700 space-y-1 list-decimal pl-5">
            <li>Llama a cada proveedor de arriba y acuerda el día y la hora del retiro.</li>
            <li>Lleva la orden de compra (o el número) para que te entreguen lo correcto.</li>
            <li>Al retirar, revisa que la cantidad y el modelo coincidan con la lista de arriba.</li>
            <li>Si gastas en combustible, peajes o ayudantes, anótalo como gasto.</li>
          </ol>
        )}

        {usaTransporte && (
          <div className="space-y-2">
            <p className="text-[12px] text-zinc-600">{modalidad === 'MIXTA' ? 'Para los productos que llevará un transporte, ' : ''}escribe a qué ciudad o comuna hay que llevar la mercadería y el sistema te muestra los fleteros que llegan allá, del más conveniente al menos conveniente.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={zona} onChange={e => setZona(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscarFleteros(); }} placeholder="Ej: Coyhaique" data-testid="retiro-zona"
                className="text-[12.5px] border border-zinc-300 rounded-lg px-3 py-1.5 w-56 outline-none focus:ring-1 focus:ring-teal-500" />
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-600"><input type="checkbox" checked={urgente} onChange={e => setUrgente(e.target.checked)} className="accent-teal-600" /> Es urgente (solo carga única)</label>
              <button type="button" onClick={buscarFleteros} disabled={!zona.trim() || buscando}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {buscando ? <Loader2 size={13} className="animate-spin" /> : <Buscar size={13} />} Ver fleteros
              </button>
            </div>
            {fleteros && (fleteros.length === 0
              ? <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No hay fleteros registrados que lleguen a «{zona}». Cotiza uno por tu cuenta y anota el costo como gasto.</p>
              : (
                <ul className="space-y-1.5" data-testid="retiro-fleteros">
                  {fleteros.map((f, i) => (
                    <li key={f.id} className="rounded-lg border border-zinc-200 px-3 py-2 flex items-center gap-3 flex-wrap">
                      <span className="text-[11px] font-bold text-zinc-400 w-4">{i + 1}</span>
                      <span className="flex-1 min-w-[200px]">
                        <span className="block text-[12.5px] font-bold text-zinc-800">{f.nombre} <span className="text-[10.5px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full">{f.categoria === 'UNICA' ? 'Carga única' : 'Carga consolidada'}</span></span>
                        <span className="block text-[11.5px] text-zinc-500">{[f.tipoCamion, f.capacidadCamion, f.incluyeDescarga ? 'incluye descarga' : null, f.tienePionetas ? 'con pionetas' : null, f.plazoDespachoDias != null ? `despacha en ${f.plazoDespachoDias} d` : null, f.nota != null ? `nota ${f.nota}` : null].filter(Boolean).join(' · ') || 'Sin más datos'}</span>
                      </span>
                      <span className="text-[13px] font-bold text-zinc-900">{fmtCLP(f.costoTentativo)}<span className="block text-[10.5px] font-normal text-zinc-400 text-right">tentativo</span></span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}

        {modalidad && (
          <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2.5 flex items-center gap-3 flex-wrap">
            <p className="flex-1 min-w-[220px] text-[12px] text-teal-900"><b>Cuando se pague el flete, el combustible o algo parecido,</b> anótalo en «Gastos extra»: así queda dentro del costo real del proyecto.</p>
            <button type="button" onClick={() => enfocarProducto('gastos', null)} className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg">Ir a Gastos extra →</button>
          </div>
        )}
      </section>
    </div>
  );
}
