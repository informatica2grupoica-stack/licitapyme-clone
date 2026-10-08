'use client';

// OBUMA — UN SOLO LUGAR para lo que se crea en Obuma durante una compra: proveedor → SKU → orden de compra.
// Antes el proveedor vivía dentro de la orden de compra (Compra y logística) y el SKU dentro de «Aprobación y SKU»;
// ahora se crean desde acá, y los demás pasos solo muestran el estado y un botón «Ir a crear…» que trae a esta pestaña.
// Todo lo que escribe en Obuma sigue siendo una acción explícita de la persona (nunca automático).
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { AprobacionesCompraCard } from './AprobacionesCompraCard';
import { RepartoAdminCard } from './RepartoAdminCard';
import { CrearProveedorObumaModal, type FormProveedor } from './CrearProveedorObumaModal';
import { consumirAccionPendiente } from '@/app/compras/[negocioId]/comprasNavegacion';
import {
  IconCircleCheck as Check, IconCircle as Pendiente, IconLoader2 as Loader2, IconSearch as Search, IconPlus as Plus,
  IconBuildingStore as Proveedor, IconTag as Tag, IconFileText as Oc, IconShieldCheck as Shield,
} from '@tabler/icons-react';

type EstadoProv = 'cargando' | 'existe' | 'no_existe' | 'sin_rut' | 'error';
interface ProvCompra { nombre: string; rut: string | null; estado: EstadoProv; ocCreada: boolean }
interface Sugerido { id: number; nombreEmpresa: string; rut: string | null; obumaProveedorId: string | null }

function Fila({ ok, titulo, detalle, children }: { ok: boolean; titulo: string; detalle: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className={`mt-0.5 flex-shrink-0 ${ok ? 'text-emerald-600' : 'text-zinc-300'}`}>{ok ? <Check size={20} /> : <Pendiente size={20} />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-zinc-900">{titulo}</p>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">{detalle}</p>
        {children}
      </div>
    </div>
  );
}

export function ObumaHubCard({ negocioId, puedeOperar, esAdministracion }: { negocioId: number; puedeOperar: boolean; esAdministracion: boolean }) {
  const toast = useToast();
  const [aprob, setAprob] = useState<{ compra: boolean; margen: boolean } | null>(null);
  const [provs, setProvs] = useState<ProvCompra[] | null>(null);
  const [skus, setSkus] = useState<{ con: number; total: number } | null>(null);
  // SKU que ya existen en Obuma (creados por fuera) y todavía no están enlazados a los productos.
  const [skusPorEnlazar, setSkusPorEnlazar] = useState<{ productoId: number; descripcion: string; codigoComercial: string; ocFolio: string; yaEnlazado: boolean }[]>([]);
  const [enlazando, setEnlazando] = useState(false);
  const [version, setVersion] = useState(0);
  const [ocs, setOcs] = useState<{ emitidas: number; total: number } | null>(null);
  const [modal, setModal] = useState<Partial<FormProveedor> | null>(null);

  // buscador de proveedor (nombre o RUT) contra el catálogo (espejo de Obuma) + verificación en vivo por RUT
  const [q, setQ] = useState('');
  const [sugeridos, setSugeridos] = useState<Sugerido[]>([]);
  const [rutEstado, setRutEstado] = useState<{ estado: 'idle' | 'cargando' | 'existe' | 'no_existe' | 'invalido'; razon?: string }>({ estado: 'idle' });

  const verificarRut = async (rut: string): Promise<EstadoProv> => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/orden-compra-obuma/proveedor?rut=${encodeURIComponent(rut)}`).then(x => x.json());
      return r.success ? (r.existe ? 'existe' : 'no_existe') : 'error';
    } catch { return 'error'; }
  };

  const cargar = useCallback(async () => {
    try {
      const [rA, rO, rS, rP] = await Promise.all([
        fetch(`/api/compras/${negocioId}/aprobaciones`).then(r => r.json()).catch(() => null),
        fetch(`/api/compras/${negocioId}/orden-compra-obuma`).then(r => r.json()).catch(() => null),
        fetch(`/api/compras/${negocioId}/sku?detectar=1`).then(r => r.json()).catch(() => null),
        fetch(`/api/compras/${negocioId}/productos`).then(r => r.json()).catch(() => null),
      ]);
      const aprobado = (x: any) => !!x && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(x.estado);
      setAprob({ compra: aprobado(rA?.compra), margen: aprobado(rA?.margen) });

      const vigentes = (rP?.productos || []).filter((p: any) => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
      const conSku = (rS?.skus || []).filter((s: any) => s.obumaProductoId && vigentes.some((p: any) => p.id === s.productoId));
      setSkus({ con: conSku.length, total: vigentes.length });
      setSkusPorEnlazar((rS?.existentesObuma || []).filter((d: any) => !d.yaEnlazado));

      const lista: Array<{ proveedorNombre: string; proveedorRut: string | null; yaCreada: unknown; ocRealObuma?: unknown }> = rO?.proveedores || [];
      setOcs({ emitidas: lista.filter(p => p.yaCreada || p.ocRealObuma).length, total: lista.length });
      setProvs(lista.map(p => ({ nombre: p.proveedorNombre, rut: p.proveedorRut, estado: p.proveedorRut ? 'cargando' : 'sin_rut', ocCreada: !!(p.yaCreada || p.ocRealObuma) })));
      lista.forEach(async (p, i) => {
        if (!p.proveedorRut) return;
        const estado = await verificarRut(p.proveedorRut);
        setProvs(prev => prev ? prev.map((x, j) => (j === i ? { ...x, estado } : x)) : prev);
      });
    } catch (e: any) {
      toast.error('No se pudo cargar el estado de Obuma', e.message);
    }
  }, [negocioId]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  // «Ir a crear proveedor» desde otro paso (compra directa): llega con RUT/nombre ya cargados.
  useEffect(() => {
    const p = consumirAccionPendiente();
    if (p?.accion === 'crear-proveedor') setModal({ rut: p.rut || '', razonSocial: p.nombre || '' });
  }, []);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setSugeridos([]); return; }
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/compras/proveedores?q=${encodeURIComponent(t)}`).then(x => x.json());
        if (r.success) setSugeridos((r.proveedores || []).slice(0, 6));
      } catch { setSugeridos([]); }
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const comprobarRutBuscado = async () => {
    const rut = q.trim();
    if (!/^[\d.\s]{7,12}-?[\dkK]$/.test(rut)) { setRutEstado({ estado: 'idle' }); return; }
    setRutEstado({ estado: 'cargando' });
    const e = await verificarRut(rut);
    setRutEstado({ estado: e === 'existe' ? 'existe' : e === 'no_existe' ? 'no_existe' : 'invalido' });
  };

  const enlazarSkus = async () => {
    setEnlazando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/sku`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'enlazar-obuma' }) }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      toast.success('SKU reconocidos', `${r.enlazados} producto(s) enlazados con su SKU de Obuma.`);
      await cargar();
      setVersion(v => v + 1);
    } catch (e: any) { toast.error('No se pudieron enlazar los SKU', e.message); }
    finally { setEnlazando(false); }
  };

  const provsOk = provs ? provs.filter(p => p.estado === 'existe').length : 0;
  const faltanProvs = (provs || []).filter(p => p.estado === 'no_existe' || p.estado === 'sin_rut');
  const aprobado = !!aprob?.compra && !!aprob?.margen;

  return (
    <div className="space-y-4" data-testid="obuma-hub">
      {/* 1. Qué falta */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <p className="px-4 py-2.5 text-[11.5px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5"><Shield size={13} /> Listo para comprar en Obuma</p>
        <div className="divide-y divide-zinc-100">
          <Fila ok={aprobado} titulo="Compra y margen aprobados"
            detalle={aprob == null ? 'Revisando…' : aprobado ? 'Las dos aprobaciones están listas: se puede emitir dinero real en Obuma.' : `Falta aprobar ${[!aprob.compra && 'la compra', !aprob.margen && 'el margen'].filter(Boolean).join(' y ')} (paso «Aprobación y SKU»). Sin eso no se pueden crear SKU ni órdenes de compra.`} />
          <Fila ok={!!provs && provs.length > 0 && provsOk === provs.length} titulo="Proveedores creados en Obuma"
            detalle={provs == null ? 'Revisando…' : provs.length === 0 ? 'Todavía no hay una forma de comprar elegida (paso «Costeo y auditoría»).' : `${provsOk} de ${provs.length} ya existen en Obuma.`}>
            {faltanProvs.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {faltanProvs.map(p => (
                  <li key={p.nombre} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                    <span className="font-semibold text-zinc-800">{p.nombre}</span>
                    <span className="text-amber-700">{p.estado === 'sin_rut' ? 'sin RUT' : 'no existe en Obuma'}</span>
                    {puedeOperar && <button onClick={() => setModal({ rut: p.rut || '', razonSocial: p.nombre })} className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">Crear proveedor</button>}
                  </li>
                ))}
              </ul>
            )}
          </Fila>
          <Fila ok={!!skus && skus.total > 0 && skus.con === skus.total} titulo="SKU de cada producto"
            detalle={skus == null ? 'Revisando…' : `${skus.con} de ${skus.total} productos tienen su SKU creado en Obuma.`}>
            {skusPorEnlazar.length > 0 && (
              <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2" data-testid="hub-sku-por-enlazar">
                <p className="text-[12.5px] font-semibold text-sky-900">{skusPorEnlazar.length} producto(s) ya tienen SKU en Obuma (se trabajó por fuera de Licitank) y aún no están reconocidos aquí.</p>
                <ul className="mt-1 space-y-0.5">
                  {skusPorEnlazar.map(d => (
                    <li key={d.productoId} className="text-[12px] text-sky-900/80 truncate">{d.descripcion.split(' - ')[0]} → SKU <b>{d.codigoComercial}</b> <span className="text-sky-700/70">· OC {d.ocFolio}</span></li>
                  ))}
                </ul>
                {puedeOperar && (
                  <button onClick={enlazarSkus} disabled={enlazando} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-sky-800 hover:text-sky-950 disabled:opacity-50">
                    {enlazando ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Reconocer estos SKU (no crea nada en Obuma)
                  </button>
                )}
              </div>
            )}
          </Fila>
          <Fila ok={!!ocs && ocs.total > 0 && ocs.emitidas === ocs.total} titulo="Órdenes de compra emitidas"
            detalle={ocs == null ? 'Revisando…' : ocs.total === 0 ? 'Sin proveedores todavía.' : `${ocs.emitidas} de ${ocs.total} órdenes emitidas (una por proveedor).`} />
        </div>
      </div>

      {/* 2. Proveedor */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5">
          <Proveedor size={14} className="text-zinc-400" />
          <p className="text-[11.5px] font-bold text-zinc-500 uppercase">1 · Proveedor</p>
          {puedeOperar && <button onClick={() => setModal({})} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800"><Plus size={13} /> Crear proveedor en Obuma</button>}
        </div>
        <div className="p-4 space-y-2">
          <p className="text-[12.5px] text-zinc-500">Busca por nombre o RUT para ver si ya existe antes de crearlo (también sirve para una compra directa).</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => { setQ(e.target.value); setRutEstado({ estado: 'idle' }); }} onBlur={comprobarRutBuscado} placeholder="Nombre o RUT del proveedor"
                className="w-full text-[13px] border border-zinc-200 rounded-lg pl-8 pr-2.5 py-2 outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
          {rutEstado.estado === 'cargando' && <p className="text-[12px] text-zinc-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Consultando Obuma…</p>}
          {rutEstado.estado === 'existe' && <p className="text-[12.5px] font-semibold text-emerald-700">✓ Ese RUT ya existe en Obuma.</p>}
          {rutEstado.estado === 'no_existe' && (
            <p className="text-[12.5px] font-semibold text-amber-700">Ese RUT no existe en Obuma. {puedeOperar && <button onClick={() => setModal({ rut: q.trim() })} className="underline text-indigo-600">Crear proveedor con este RUT</button>}</p>
          )}
          {sugeridos.length > 0 && (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100" data-testid="hub-sugeridos">
              {sugeridos.map(x => (
                <li key={x.id} className="px-3 py-1.5 text-[12.5px] flex items-center justify-between gap-2">
                  <span><b className="text-zinc-800">{x.nombreEmpresa}</b> <span className="text-zinc-400">· {x.rut || 'sin RUT'}</span></span>
                  <span className={x.obumaProveedorId ? 'text-emerald-700 font-semibold' : 'text-zinc-400'}>{x.obumaProveedorId ? 'En Obuma' : 'Solo en el catálogo'}</span>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 3 && sugeridos.length === 0 && rutEstado.estado === 'idle' && <p className="text-[12px] text-zinc-400">Sin coincidencias en el catálogo.</p>}
        </div>
      </div>

      {/* 3. SKU */}
      <div>
        <p className="text-[11.5px] font-bold text-zinc-500 uppercase mb-2 flex items-center gap-1.5 px-0.5"><Tag size={13} /> 2 · SKU de los productos</p>
        <AprobacionesCompraCard key={`sku-${version}`} negocioId={negocioId} puedeOperar={puedeOperar} parte="sku" />
      </div>

      {/* 4. Órdenes de compra */}
      <div>
        <p className="text-[11.5px] font-bold text-zinc-500 uppercase mb-2 flex items-center gap-1.5 px-0.5"><Oc size={13} /> 3 · Órdenes de compra a proveedores</p>
        <RepartoAdminCard key={`oc-${version}`} negocioId={negocioId} puedeOperar={puedeOperar || esAdministracion} parte="oc" />
      </div>

      {modal && (
        <CrearProveedorObumaModal negocioId={negocioId} inicial={modal} onCerrar={() => setModal(null)}
          onCreado={() => { setModal(null); cargar(); }} />
      )}
    </div>
  );
}
