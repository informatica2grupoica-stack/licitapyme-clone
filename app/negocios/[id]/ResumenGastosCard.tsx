'use client';

// RESUMEN DE GASTO (OBUMA) — pedido explícito del usuario (22-sep-2026): "nos falta un resumen en
// el módulo de compra... de cuánto gastamos, las OC creadas y las facturas realizadas". Hasta hoy
// ese número solo se veía en la ficha de la licitación (bloque "Compras (Obuma)",
// ComprasObumaBloque.tsx) — acá se trae DENTRO del módulo de Compras, en la pestaña "Compra,
// Importación y Logística" donde ya vive el resto de lo administrativo con Obuma.
//
// Las 3 cifras principales (OC creadas, compras cruzadas, facturas) leen de BASE — mismo criterio
// que el resto de la pantalla, sin llamar a Obuma en cada carga. El total del Proyecto completo
// (agrupando centros de costo hermanos, ver gastosDelProyectoPorLicitacion en obuma.ts) sigue
// siendo una consulta EN VIVO aparte, a un clic — no autoload.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconReceipt as Receipt, IconLoader2 as Loader2, IconFolderSearch as FolderSearch } from '@tabler/icons-react';

interface ResumenGastos {
  ocCreadas: { cantidad: number; totalNeto: number; proveedores: { nombre: string; folio: string | null; total: number; fecha: string }[] };
  comprasCruzadas: { cantidad: number; total: number };
  facturas: { cantidad: number; total: number };
  montoCosteado: number | null;
  variacionPct: number | null;
}
interface GastosProyecto {
  centroCostoNombre: string; relProyectoId: string | null;
  centrosDeCostoDelProyecto: { id: string; nombre: string }[];
  totalOc: number; cantidadOc: number;
}

const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ResumenGastosCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const [resumen, setResumen] = useState<ResumenGastos | null>(null);
  const [licitacionCodigo, setLicitacionCodigo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [proyecto, setProyecto] = useState<GastosProyecto | null>(null);
  const [estadoProyecto, setEstadoProyecto] = useState<'idle' | 'cargando' | 'ok' | 'sin_datos' | 'error'>('idle');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/resumen-gastos`);
      const d = await r.json();
      if (d.success) { setResumen(d.resumen); setLicitacionCodigo(d.licitacionCodigo || null); }
    } catch (e: any) {
      toast.error('No se pudo cargar el resumen de gasto', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const consultarProyecto = () => {
    if (!licitacionCodigo) return;
    setEstadoProyecto('cargando');
    fetch(`/api/obuma-compras/gastos-proyecto?codigo=${encodeURIComponent(licitacionCodigo)}`)
      .then(r => r.json())
      .then(d => {
        if (!d?.success) { setEstadoProyecto('error'); return; }
        if (!d.gastos) { setEstadoProyecto('sin_datos'); return; }
        setProyecto(d.gastos); setEstadoProyecto('ok');
      })
      .catch(() => setEstadoProyecto('error'));
  };

  if (loading) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center gap-2 text-[12px] text-zinc-400"><Loader2 size={14} className="animate-spin" /> Cargando resumen de gasto…</div>;
  }
  if (!resumen) return null;

  const gastadoReal = resumen.ocCreadas.totalNeto || resumen.comprasCruzadas.total || null;
  const sinDatos = resumen.ocCreadas.cantidad === 0 && resumen.comprasCruzadas.cantidad === 0;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <Receipt size={15} className="text-zinc-400" />
        <span className="text-[13px] font-bold text-zinc-700">Resumen de gasto (Obuma)</span>
        {gastadoReal != null && (
          <span className="ml-auto text-[13px] font-bold text-zinc-800">{fmtCLP(gastadoReal)}</span>
        )}
      </div>

      {sinDatos ? (
        <p className="px-4 py-3 text-[11.5px] text-zinc-400">
          Todavía no hay órdenes de compra ni facturas cruzadas para este negocio.
        </p>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">OC creadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.ocCreadas.totalNeto)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.ocCreadas.cantidad} orden{resumen.ocCreadas.cantidad !== 1 ? 'es' : ''} emitida{resumen.ocCreadas.cantidad !== 1 ? 's' : ''} desde Licitank</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">Compras cruzadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.comprasCruzadas.total)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.comprasCruzadas.cantidad} compra{resumen.comprasCruzadas.cantidad !== 1 ? 's' : ''} en Obuma (cron diario)</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">Facturas realizadas</p>
            <p className="text-[15px] font-bold text-zinc-800 mt-0.5">{fmtCLP(resumen.facturas.total)}</p>
            <p className="text-[11px] text-zinc-400">{resumen.facturas.cantidad} factura{resumen.facturas.cantidad !== 1 ? 's' : ''} real{resumen.facturas.cantidad !== 1 ? 'es' : ''} con XML</p>
          </div>
        </div>
      )}

      {resumen.montoCosteado != null && gastadoReal != null && (
        <p className="px-4 pb-3 text-[11.5px] text-zinc-500">
          Costeado: <b className="text-zinc-700">{fmtCLP(resumen.montoCosteado)}</b>
          {resumen.variacionPct != null && (
            <span className={resumen.variacionPct > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>
              {' '}· {resumen.variacionPct > 0 ? '+' : ''}{resumen.variacionPct}% {resumen.variacionPct > 0 ? 'sobre lo presupuestado' : 'bajo lo presupuestado'}
            </span>
          )}
        </p>
      )}

      <div className="px-4 pb-4">
        {estadoProyecto === 'idle' && licitacionCodigo && (
          <button onClick={consultarProyecto}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
            <FolderSearch size={12} /> Ver gastos del Proyecto completo en Obuma
          </button>
        )}
        {estadoProyecto === 'cargando' && (
          <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Consultando Obuma…</span>
        )}
        {estadoProyecto === 'error' && <span className="text-[11px] text-rose-500">No se pudo consultar Obuma ahora.</span>}
        {estadoProyecto === 'sin_datos' && <span className="text-[11px] text-zinc-400">Esta licitación todavía no tiene un centro de costo armado en Obuma.</span>}
        {estadoProyecto === 'ok' && proyecto && (
          <div className="text-[11.5px] text-zinc-600 bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-2">
            <p><b>{fmtCLP(proyecto.totalOc)}</b> en {proyecto.cantidadOc} orden{proyecto.cantidadOc !== 1 ? 'es' : ''} de compra del Proyecto completo
              {proyecto.centrosDeCostoDelProyecto.length > 1 && <> ({proyecto.centrosDeCostoDelProyecto.length} centros de costo)</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
