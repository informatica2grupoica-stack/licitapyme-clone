'use client';

// AUDITOR DE COMPRAS · VERIFICADOR DE COTIZACIONES (PROMPT 5 v1.2) — pantalla del paso "Costeo y Auditoría".
// Audita cada línea de la TABLA_DE_COSTEO: que el costo tenga un respaldo real (link visitado en vivo con
// captura fechada, cotización, histórico), que sea el mismo producto, unidad, IVA y sin costos ocultos, y
// ubica el proyecto frente al precio de mercado y al presupuesto. El tono es de ayuda: cada bloqueo trae su
// ruta de salida. Toda la aritmética y los bloqueos vienen calculados del servidor (auditor-compras-core.ts).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import {
  IconLoader2 as Loader2, IconShieldCheck as ShieldCheck, IconAlertTriangle as AlertTriangle, IconRefresh as RefreshCw, IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp, IconExternalLink as ExternalLink, IconCopy as Copy, IconPhoto as Photo, IconScale as Scale, IconFlag as Flag,
} from '@tabler/icons-react';

type Veredicto = 'VERIFICADO' | 'VERIFICADO_CON_ALERTAS' | 'REQUIERE_HABILITACION' | 'NO_VERIFICADO' | 'SIN_RESPALDO' | 'PENDIENTE_CRUCE_TECNICO';
interface Bloqueo { codigo: string; mensaje: string; salida: string }
interface Alerta { codigo: string; nivel: 'rojo' | 'amarillo' | 'info'; mensaje: string }
interface Opcion { opcion: string; origen: 'asistente' | 'auditor'; costo_bodega: number | null; neto_unitario: number | null; motivo_sin_normalizar: string | null; stock?: string; tipo_respaldo?: string; url?: string; despacho?: string }
interface LineaPanel {
  linea: { id: string; item: number; detalle: string; unidad: string; sku: string; cantidad: number | null; costoRegistradoNeto: number | null; links: string[]; esGastoExtra: boolean; grupo: string };
  guardada: null | {
    auditadoAt: string; modeloIA: string; pasada: string; cambiosVsAnterior?: string[];
    capturas: Array<{ id: number; url: string; estado: string; capturadoAt: string; hayImagen: boolean }>;
    modelo: { ruta?: string; ayuda?: { diagnostico?: string; causa_probable?: string; pregunta_proveedor?: string; accion_concreta?: string }; verificaciones?: { V9_proveedor_mp?: { evidencia?: string; alerta_competidor?: boolean }; V10_referencias?: { descartadas_no_mismo_producto?: Array<{ url?: string; motivo?: string }> } }; no_pude_leer?: Array<{ que?: string; donde?: string }> };
    sistema: { costeadoNeto: number | null; verificadoNeto: number | null; diffPct: number | null; diffMonto: number | null; direccion: string | null; comparador: Opcion[]; guardarrailes: string[]; dolar: { usado: number | null; fecha: string | null }; precioMercadoPublico: { neto: number | null; n: number; calidad: string } | null; refMediana: number | null };
  };
  derivada: null | { veredicto: Veredicto; bloqueos: Bloqueo[]; alertas: Alerta[]; pasaAnexosOk: boolean; impactoCostoTotalNeto: number | null; habilitacionRequerida: string; v4: { margenAntes: number | null; margenDespues: number | null; caidaPuntos: number | null } };
  justificacionAhorro: string | null; justificacionPor: string | null;
  habilitacion: null | { nivel: 'EM' | 'CA'; porNombre: string | null; motivo: string; at: string };
  auditando: boolean;
}
interface Posicion {
  presupuesto: { monto_neto: number | null; nivel: string | null; fuente: string };
  mercado_publico: { monto_neto: number | null; n_datos: number; rango_fechas: string; calidad: string; lineas_con_dato: number };
  mercado_privado: { monto_neto: number | null; n_referencias: number; lineas_con_referencias: number; costo_de_esas_lineas: number | null };
  costo_verificado: { monto_neto: number | null; lineas_pendientes: number; lineas_total: number };
  espacio_maniobra: { monto: number | null; pct_sobre_costo: number | null };
  margen: { con_precio_venta: number | null; al_presupuesto: number | null };
  alertas: Array<{ tipo: string; nivel: 'rojo' | 'amarillo' | 'info' | 'ok'; detalle: string; lineas_que_mas_aportan: number[] }>;
  orden_sano: boolean | null; lectura: string;
}
interface Panel {
  hayCostea: boolean; migracionAplicada: boolean; lineas: LineaPanel[]; posicion: Posicion | null;
  margen: { margenBase: number | null; margenFinal: number | null; caidaPuntos: number | null } | null;
  mensajesProveedor: Array<{ proveedor: string; mensaje: string; lineas: number[] }>;
  resumen: { total: number; verificadas: number; conAlertas: number; bloqueadas: number; sinAuditar: number; pasaAnexosOk: boolean };
  pasadaFinal: null | { at: string; pasa: boolean; bloqueadas: number; cambios: Array<{ item: number; detalle: string; cambios: string[] }> };
  lote: null | { tipo: 'todo' | 'final'; total: number; hechas: number; error: string | null };
}

const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const VER: Record<Veredicto, { txt: string; cls: string }> = {
  VERIFICADO: { txt: 'Verificado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  VERIFICADO_CON_ALERTAS: { txt: 'Verificado con alertas', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  REQUIERE_HABILITACION: { txt: 'Requiere habilitación', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  NO_VERIFICADO: { txt: 'No verificado', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  SIN_RESPALDO: { txt: 'Sin respaldo', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  PENDIENTE_CRUCE_TECNICO: { txt: 'Pendiente cruce técnico', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
};
const NIVEL_ALERTA = { rojo: 'text-rose-700 bg-rose-50 border-rose-100', amarillo: 'text-amber-800 bg-amber-50 border-amber-100', info: 'text-zinc-600 bg-zinc-50 border-zinc-100', ok: 'text-emerald-700 bg-emerald-50 border-emerald-100' } as const;

export function AuditorCosteoCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/auditor-costeo`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo leer el auditor.');
      setPanel(data); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);
  // Mientras hay algo auditándose (línea suelta, lote o pasada final) se refresca solo cada 4 s.
  const trabajando = !!panel && (panel.lineas.some(l => l.auditando) || (!!panel.lote && panel.lote.hechas < panel.lote.total) || (!!panel.lote && panel.lote.total === 0 && !panel.lote.error));
  useEffect(() => {
    if (!trabajando) return;
    timer.current = setTimeout(cargar, 4000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [trabajando, panel, cargar]);

  const accion = async (body: Record<string, unknown>, clave: string, okMsg?: string) => {
    setOcupado(clave);
    try {
      const res = await fetch(`/api/compras/${negocioId}/auditor-costeo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo completar la acción.');
      if (data.yaEnCurso) toast.error('Ya hay una auditoría en curso', 'Espera a que termine.');
      else if (okMsg) toast.success(okMsg);
      if (data.lineas) setPanel(data); else await cargar();
    } catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { setOcupado(null); }
  };

  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-[12.5px] text-rose-700">{error}</div>;
  if (!panel) return <div className="rounded-xl border border-zinc-200 bg-white p-4 text-[12.5px] text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando el Auditor de Compras…</div>;
  if (!panel.hayCostea) return <div className="rounded-xl border border-zinc-200 bg-white p-4 text-[12.5px] text-zinc-500">Este negocio aún no tiene un costeo guardado: el Auditor de Compras audita cada línea de la tabla de costeo.</div>;
  if (!panel.migracionAplicada) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] text-amber-800">Falta aplicar la migración 128 (<code>node scripts/aplicar-migration-128.mjs</code>).</div>;

  const r = panel.resumen; const lote = panel.lote; const pos = panel.posicion;
  const enLote = !!lote && lote.hechas < lote.total;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-teal-200 overflow-hidden">
        <div className="px-4 py-3 bg-teal-50/60 flex flex-wrap items-center gap-2 justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-teal-900"><ShieldCheck size={15} /> Auditor de Compras · Verificador de cotizaciones</p>
            <p className="text-[11px] text-teal-700/80 mt-0.5">Revisa que cada costo tenga un respaldo real, sea el mismo producto y no esconda costos. Es una ayuda: cada punto trae qué hacer.</p>
          </div>
          {puedeOperar && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => accion({ accion: 'auditar_todo' }, 'todo', 'Auditando todas las líneas…')} disabled={!!ocupado || enLote}
                className="px-3 py-1.5 text-[11.5px] font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">Auditar todas las líneas</button>
              <button onClick={() => accion({ accion: 'pasada_final' }, 'final', 'Pasada final en curso…')} disabled={!!ocupado || enLote}
                title="Vuelve a abrir todos los links, toma capturas nuevas y compara con la auditoría anterior. La hace el sistema antes de pasar a ANEXOS OK."
                className="px-3 py-1.5 text-[11.5px] font-semibold rounded-lg border border-teal-300 text-teal-800 hover:bg-teal-50 disabled:opacity-50">Pasada final (antes de ANEXOS OK)</button>
            </div>
          )}
        </div>
        {enLote && lote && (
          <div className="px-4 py-2 border-t border-teal-100 text-[11.5px] text-teal-800 flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> {lote.tipo === 'final' ? 'Pasada final' : 'Auditando'}: {lote.hechas} de {lote.total || '…'} línea(s). Cada una toma 1–3 minutos (abre los links, busca referencias y lee con IA).
          </div>
        )}
        {lote?.error && <div className="px-4 py-2 border-t border-rose-100 text-[11.5px] text-rose-700 bg-rose-50">La última corrida falló: {lote.error}</div>}
        <div className="px-4 py-2.5 border-t border-teal-100 flex flex-wrap gap-2 text-[11.5px]">
          <Chip cls="bg-emerald-50 text-emerald-700 border-emerald-200">{r.verificadas} verificada(s)</Chip>
          <Chip cls="bg-amber-50 text-amber-700 border-amber-200">{r.conAlertas} con alertas / pendientes</Chip>
          <Chip cls="bg-rose-50 text-rose-700 border-rose-200">{r.bloqueadas} bloqueada(s)</Chip>
          <Chip cls="bg-zinc-50 text-zinc-600 border-zinc-200">{r.sinAuditar} sin auditar</Chip>
          {panel.margen && <Chip cls="bg-zinc-50 text-zinc-700 border-zinc-200">Margen del proyecto: {panel.margen.margenBase ?? '—'}% costeado → {panel.margen.margenFinal ?? '—'}% con costos auditados{panel.margen.caidaPuntos ? ` (−${panel.margen.caidaPuntos} pts)` : ''}</Chip>}
          <span className={`ml-auto font-bold ${r.pasaAnexosOk ? 'text-emerald-700' : 'text-rose-600'}`}>{r.pasaAnexosOk ? '✔ Puede pasar a ANEXOS OK' : '🚫 Bloqueado para ANEXOS OK'}</span>
        </div>
        {panel.pasadaFinal && (
          <div className="px-4 py-2.5 border-t border-teal-100 text-[11.5px] text-zinc-600">
            <p className="font-semibold text-zinc-700">Última pasada final: {panel.pasadaFinal.at.slice(0, 16)} — {panel.pasadaFinal.pasa ? 'pasa' : `${panel.pasadaFinal.bloqueadas} línea(s) bloqueada(s)`}</p>
            {panel.pasadaFinal.cambios.length === 0 ? <p>Sin cambios respecto a la auditoría anterior.</p> : panel.pasadaFinal.cambios.map(c => <p key={c.item}>• Línea {c.item} ({c.detalle}): {c.cambios.join(' ')}</p>)}
          </div>
        )}
      </div>

      {pos && <PosicionPrecioCard pos={pos} puedeOperar={puedeOperar} ocupado={ocupado === 'lectura'} onLectura={() => accion({ accion: 'lectura' }, 'lectura')} />}

      <div className="space-y-2">
        {panel.lineas.map(lp => {
          const abiertaEsta = abierta === lp.linea.id;
          const v = lp.derivada?.veredicto;
          const s = lp.guardada?.sistema;
          return (
            <div key={lp.linea.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <button onClick={() => setAbierta(abiertaEsta ? null : lp.linea.id)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-zinc-50/70">
                <span className="text-[11px] font-bold text-zinc-400 w-6 shrink-0">#{lp.linea.item}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-semibold text-zinc-800 truncate">{lp.linea.detalle || '(sin detalle)'}{lp.linea.esGastoExtra && <span className="ml-1.5 text-[10px] font-bold text-zinc-400">GASTO EXTRA</span>}</span>
                  <span className="block text-[11px] text-zinc-500">{lp.linea.cantidad ?? '—'} {lp.linea.unidad} · costeado {clp(lp.linea.costoRegistradoNeto)} neto/u{s?.verificadoNeto != null ? ` · verificado ${clp(s.verificadoNeto)}` : ''}{s?.diffPct != null && Math.abs(s.diffPct) >= 0.5 ? <b className={s.diffPct > 0 ? 'text-rose-600' : 'text-emerald-600'}> ({s.diffPct > 0 ? '+' : ''}{s.diffPct}%)</b> : null}</span>
                </span>
                {lp.auditando ? <span className="flex items-center gap-1 text-[11px] text-teal-700"><Loader2 size={12} className="animate-spin" /> Auditando…</span>
                  : v ? <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${VER[v].cls}`}>{VER[v].txt}{lp.derivada!.bloqueos.length ? ` · ${lp.derivada!.bloqueos.length} bloqueo(s)` : ''}</span>
                  : <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-50 text-zinc-500 border-zinc-200">Sin auditar</span>}
                {abiertaEsta ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
              </button>
              {abiertaEsta && (
                <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-zinc-100">
                  {puedeOperar && (
                    <div className="flex justify-end">
                      <button onClick={() => accion({ accion: 'auditar', filaId: lp.linea.id }, `a-${lp.linea.id}`, 'Auditando la línea…')} disabled={!!ocupado || lp.auditando}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-teal-300 text-teal-800 hover:bg-teal-50 disabled:opacity-50"><RefreshCw size={12} /> {lp.guardada ? 'Volver a auditar esta línea' : 'Auditar esta línea'}</button>
                    </div>
                  )}
                  {!lp.guardada && <p className="text-[12px] text-zinc-500">Esta línea todavía no se audita. {lp.linea.links.length === 0 && 'Le falta el link del producto (Link 1) o una cotización cargada.'}</p>}
                  {lp.guardada && lp.derivada && <DetalleLinea lp={lp} negocioId={negocioId} puedeOperar={puedeOperar} ocupado={ocupado} textos={textos} setTextos={setTextos} accion={accion} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {panel.mensajesProveedor.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-3.5 space-y-2">
          <p className="text-[12.5px] font-bold text-zinc-800">Mensajes listos para los proveedores (uno por proveedor)</p>
          {panel.mensajesProveedor.map(m => (
            <div key={m.proveedor} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
              <div className="flex items-center justify-between"><p className="text-[11.5px] font-semibold text-zinc-700">{m.proveedor} · líneas {m.lineas.join(', ')}</p>
                <button onClick={() => { navigator.clipboard?.writeText(m.mensaje); toast.success('Mensaje copiado'); }} className="flex items-center gap-1 text-[11px] text-teal-700 font-semibold"><Copy size={12} /> Copiar</button></div>
              <pre className="mt-1 text-[11.5px] text-zinc-600 whitespace-pre-wrap font-sans">{m.mensaje}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{children}</span>;
}

function PosicionPrecioCard({ pos, puedeOperar, ocupado, onLectura }: { pos: Posicion; puedeOperar: boolean; ocupado: boolean; onLectura: () => void }) {
  const fila = (t: string, v: string, extra?: string, ok?: boolean) => (
    <div className="flex items-baseline justify-between gap-2 py-1"><span className="text-[12px] text-zinc-600">{t}</span>
      <span className="text-[12.5px] font-semibold text-zinc-800 tabular-nums">{v}{extra && <span className={`ml-2 text-[10.5px] font-normal ${ok === false ? 'text-amber-600' : 'text-zinc-400'}`}>{extra}</span>}</span></div>
  );
  const mp = pos.mercado_publico;
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-zinc-800 mb-1"><Scale size={14} /> Posición de precio del proyecto <span className="text-[10.5px] font-normal text-zinc-400">— guía, el precio lo decide una persona</span></p>
      <div className="divide-y divide-zinc-100">
        {fila('Presupuesto del organismo', clp(pos.presupuesto.monto_neto), pos.presupuesto.monto_neto ? `neto · ${pos.presupuesto.fuente}` : pos.presupuesto.fuente)}
        {fila('Precio de mercado público', mp.monto_neto != null ? clp(mp.monto_neto) : 'SIN DATOS SUFICIENTES', mp.monto_neto != null ? `${mp.n_datos} dato(s) · ${mp.rango_fechas} · ${mp.calidad === 'mismo_producto' && mp.n_datos >= 3 ? 'dato sólido' : 'dato débil'}` : undefined, mp.n_datos >= 3)}
        {fila('Precio de mercado privado', clp(pos.mercado_privado.monto_neto), pos.mercado_privado.monto_neto != null ? `mediana de ${pos.mercado_privado.n_referencias} referencia(s) en ${pos.mercado_privado.lineas_con_referencias} línea(s)` : 'sin referencias del mismo producto')}
        {fila('Nuestro costo verificado', clp(pos.costo_verificado.monto_neto), pos.costo_verificado.lineas_pendientes ? `${pos.costo_verificado.lineas_pendientes} de ${pos.costo_verificado.lineas_total} línea(s) aún sin verificar` : undefined, pos.costo_verificado.lineas_pendientes === 0)}
        {fila('Espacio de maniobra', clp(pos.espacio_maniobra.monto), pos.espacio_maniobra.pct_sobre_costo != null ? `${pos.espacio_maniobra.pct_sobre_costo}% sobre el costo` : undefined)}
        {fila('Margen con el precio de venta registrado', pos.margen.con_precio_venta != null ? `${pos.margen.con_precio_venta}%` : '—', pos.margen.al_presupuesto != null ? `vendiendo al presupuesto: ${pos.margen.al_presupuesto}%` : undefined)}
      </div>
      {pos.orden_sano != null && <p className={`mt-1.5 text-[11.5px] font-semibold ${pos.orden_sano ? 'text-emerald-700' : 'text-amber-700'}`}>{pos.orden_sano ? '✅ Orden sano: presupuesto ≥ mercado público > mercado privado ≥ nuestro costo.' : '⚠️ El orden esperado (presupuesto ≥ mercado público > mercado privado ≥ costo) no se cumple.'}</p>}
      <div className="mt-2 space-y-1">{pos.alertas.map((a, i) => <p key={i} className={`text-[11.5px] px-2 py-1 rounded border ${NIVEL_ALERTA[a.nivel]}`}>{a.nivel === 'rojo' ? '🔴 ' : a.nivel === 'amarillo' ? '🟡 ' : ''}{a.detalle}{a.lineas_que_mas_aportan.length ? ` (líneas que más aportan: ${a.lineas_que_mas_aportan.join(', ')})` : ''}</p>)}</div>
      <div className="mt-2 rounded-lg bg-zinc-50 border border-zinc-100 p-2.5">
        <div className="flex items-center justify-between"><p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Lectura</p>
          {puedeOperar && <button onClick={onLectura} disabled={ocupado} className="flex items-center gap-1 text-[11px] font-semibold text-teal-700 disabled:opacity-50">{ocupado ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {pos.lectura ? 'Volver a redactar' : 'Redactar lectura con IA'}</button>}</div>
        <p className="text-[12px] text-zinc-700 whitespace-pre-wrap mt-1">{pos.lectura || 'Aún no hay lectura. Se redacta con IA a partir de estos números (la IA no calcula ni recomienda un precio).'}</p>
      </div>
    </div>
  );
}

function DetalleLinea({ lp, negocioId, puedeOperar, ocupado, textos, setTextos, accion }: {
  lp: LineaPanel; negocioId: number; puedeOperar: boolean; ocupado: string | null; textos: Record<string, string>;
  setTextos: (f: (t: Record<string, string>) => Record<string, string>) => void; accion: (b: Record<string, unknown>, k: string, ok?: string) => Promise<void>;
}) {
  const g = lp.guardada!; const d = lp.derivada!; const id = lp.linea.id;
  const ayuda = g.modelo.ayuda;
  const necesitaJustif = d.bloqueos.some(b => b.codigo === 'V10_AHORRO');
  return (
    <div className="space-y-2.5">
      <p className="text-[10.5px] text-zinc-400">Auditada {g.auditadoAt.slice(0, 16)} · {g.modeloIA}{g.pasada === 'final' ? ' · pasada final' : ''}{g.sistema.dolar.usado ? ` · dólar usado ${g.sistema.dolar.usado} (BCCh + $10, ${g.sistema.dolar.fecha})` : ''}</p>
      {g.cambiosVsAnterior && g.cambiosVsAnterior.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-800">{g.cambiosVsAnterior.map((c, i) => <p key={i}>↻ {c}</p>)}</div>}

      {d.bloqueos.map((b, i) => (
        <div key={i} className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
          <p className="text-[12px] font-semibold text-rose-800">🔴 {b.mensaje}</p>
          <p className="text-[11.5px] text-rose-700 mt-0.5">↳ Cómo salir: {b.salida}</p>
        </div>
      ))}
      {d.v4.caidaPuntos != null && d.v4.margenAntes != null && d.bloqueos.some(b => b.codigo === 'V4_ALZA_IMPORTANTE') && <p className="text-[11.5px] text-rose-700">Margen del proyecto: {d.v4.margenAntes}% → {d.v4.margenDespues}% ({d.v4.caidaPuntos} puntos).</p>}
      {d.alertas.map((a, i) => <p key={i} className={`text-[11.5px] px-2 py-1 rounded border ${NIVEL_ALERTA[a.nivel]}`}>{a.nivel === 'rojo' ? '🔴 ' : a.nivel === 'amarillo' ? '🟡 ' : 'ℹ️ '}{a.mensaje}</p>)}

      {d.impactoCostoTotalNeto != null && d.impactoCostoTotalNeto !== 0 && <p className="text-[11.5px] text-zinc-600">Impacto si se corrige: <b>{d.impactoCostoTotalNeto > 0 ? '+' : ''}{clp(d.impactoCostoTotalNeto)}</b> en el costo total neto de la línea.</p>}

      {ayuda && (ayuda.diagnostico || ayuda.accion_concreta) && (
        <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-2.5 space-y-1 text-[12px] text-zinc-700">
          {ayuda.diagnostico && <p><b>Diagnóstico:</b> {ayuda.diagnostico}</p>}
          {ayuda.causa_probable && <p><b>Causa probable:</b> {ayuda.causa_probable}</p>}
          {ayuda.accion_concreta && <p><b>Qué hacer:</b> {ayuda.accion_concreta}</p>}
          {ayuda.pregunta_proveedor && <p><b>Pregunta al proveedor:</b> {ayuda.pregunta_proveedor}</p>}
        </div>
      )}

      {g.sistema.comparador.length > 0 && (
        <div className="overflow-x-auto">
          <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Comparador · costo neto puesto en bodega (Talagante)</p>
          <table className="w-full text-[11.5px]"><thead><tr className="text-left text-zinc-400"><th className="py-1 pr-2">#</th><th className="pr-2">Opción</th><th className="pr-2">Origen</th><th className="pr-2 text-right">Neto puesto en bodega</th><th className="pr-2">Stock</th><th>Respaldo</th></tr></thead>
            <tbody>{g.sistema.comparador.map((o, i) => (
              <tr key={i} className="border-t border-zinc-100"><td className="py-1 pr-2 text-zinc-400">{i + 1}</td>
                <td className="pr-2">{o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline inline-flex items-center gap-0.5">{o.opcion}<ExternalLink size={10} /></a> : o.opcion}</td>
                <td className="pr-2 text-zinc-500">{o.origen === 'asistente' ? 'del asistente' : 'encontrada'}</td>
                <td className="pr-2 text-right font-semibold tabular-nums">{o.costo_bodega != null ? clp(o.costo_bodega) : <span className="font-normal text-zinc-400" title={o.motivo_sin_normalizar || ''}>no comparable ({o.motivo_sin_normalizar})</span>}</td>
                <td className="pr-2 text-zinc-500">{o.stock || '—'}</td><td className="text-zinc-500">{o.tipo_respaldo || '—'}</td></tr>))}</tbody></table>
        </div>
      )}
      {g.modelo.verificaciones?.V10_referencias?.descartadas_no_mismo_producto?.length ? (
        <details className="text-[11px] text-zinc-500"><summary className="cursor-pointer">Referencias descartadas ({g.modelo.verificaciones.V10_referencias.descartadas_no_mismo_producto.length}): un un "similar" no es referenciaquot;similarun "similar" no es referenciaquot; no es referencia</summary>
          {g.modelo.verificaciones.V10_referencias.descartadas_no_mismo_producto.map((x, i) => <p key={i} className="mt-0.5">• {x.url} — {x.motivo}</p>)}</details>) : null}
      {g.modelo.verificaciones?.V9_proveedor_mp?.evidencia && <p className="text-[11px] text-zinc-500"><b>Proveedor en MercadoPública:</b> {g.modelo.verificaciones.V9_proveedor_mp.evidencia}</p>}
      {g.sistema.precioMercadoPublico?.neto != null && <p className="text-[11px] text-zinc-500"><b>Mercado público:</b> el Estado compró este producto a {clp(g.sistema.precioMercadoPublico.neto)} neto (mediana de {g.sistema.precioMercadoPublico.n} dato(s)).</p>}
      {g.sistema.guardarrailes.length > 0 && <div className="text-[11px] text-zinc-500">{g.sistema.guardarrailes.map((x, i) => <p key={i}>⚙️ {x}</p>)}</div>}

      <div className="flex flex-wrap gap-2 items-center text-[11px]">
        <span className="font-semibold text-zinc-500">Evidencia:</span>
        {g.capturas.map(c => (
          <span key={c.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-50">
            <a href={c.url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline max-w-[220px] truncate">{c.url.replace(/^https?:\/\//, '')}</a>
            <span className={c.estado === 'activo' ? 'text-emerald-600' : 'text-rose-600'}>{c.estado}</span>
            <span className="text-zinc-400">{c.capturadoAt.slice(5, 16)}</span>
            {c.hayImagen && <a href={`/api/compras/${negocioId}/auditor-costeo/captura/${c.id}`} target="_blank" rel="noreferrer" title="Ver la captura"><Photo size={12} className="text-zinc-500" /></a>}
          </span>
        ))}
        {g.capturas.length === 0 && <span className="text-zinc-400">sin links capturados</span>}
      </div>
      {(g.modelo.no_pude_leer || []).length > 0 && <p className="text-[11px] text-amber-700">No se pudo leer: {(g.modelo.no_pude_leer || []).map(x => `${x.que}${x.donde ? ` (${x.donde})` : ''}`).join('; ')}</p>}

      {puedeOperar && necesitaJustif && (
        <div className="rounded-lg border border-zinc-200 p-2.5 space-y-1.5">
          <p className="text-[11.5px] font-semibold text-zinc-700">Justifica por qué no usaste la opción más barata (plazo, garantía, respaldo formal, confiabilidad, stock, despacho…)</p>
          <textarea value={textos[`j-${id}`] || ''} onChange={e => setTextos(t => ({ ...t, [`j-${id}`]: e.target.value }))} rows={2} className="w-full text-[12px] border border-zinc-200 rounded-lg p-2" placeholder="Mínimo 15 caracteres. Queda registrado a tu nombre." />
          <button onClick={() => accion({ accion: 'justificar', filaId: id, texto: textos[`j-${id}`] || '' }, `j-${id}`, 'Justificación registrada')} disabled={!!ocupado} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-teal-600 text-white disabled:opacity-50">Guardar justificación</button>
        </div>
      )}
      {lp.justificacionAhorro && <p className="text-[11.5px] text-zinc-600"><b>Justificación ({lp.justificacionPor || '—'}):</b> {lp.justificacionAhorro}</p>}

      {lp.habilitacion
        ? <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 p-2 text-[11.5px] text-violet-800">
            <span><Flag size={12} className="inline mr-1" />Habilitada por {lp.habilitacion.porNombre || '—'} ({lp.habilitacion.nivel}, {lp.habilitacion.at}): {lp.habilitacion.motivo}</span>
            {puedeOperar && <button onClick={() => accion({ accion: 'habilitar', filaId: id, nivel: null }, `h-${id}`)} className="font-semibold underline">Quitar</button>}
          </div>
        : puedeOperar && !d.pasaAnexosOk && (
          <div className="rounded-lg border border-zinc-200 p-2.5 space-y-1.5">
            <p className="text-[11.5px] font-semibold text-zinc-700">Habilitación excepcional · el EM habilita respaldos informales o históricos; CA puede habilitar cualquier línea</p>
            <textarea value={textos[`h-${id}`] || ''} onChange={e => setTextos(t => ({ ...t, [`h-${id}`]: e.target.value }))} rows={2} className="w-full text-[12px] border border-zinc-200 rounded-lg p-2" placeholder="Motivo (mínimo 15 caracteres)" />
            <div className="flex gap-2">
              <button onClick={() => accion({ accion: 'habilitar', filaId: id, nivel: 'EM', motivo: textos[`h-${id}`] || '' }, `h-${id}`, 'Línea habilitada (EM)')} disabled={!!ocupado} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-violet-300 text-violet-800 disabled:opacity-50">Habilitar como EM</button>
              <button onClick={() => accion({ accion: 'habilitar', filaId: id, nivel: 'CA', motivo: textos[`h-${id}`] || '' }, `h-${id}`, 'Línea habilitada (CA)')} disabled={!!ocupado} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-violet-300 text-violet-800 disabled:opacity-50">Habilitar como CA</button>
            </div>
          </div>
        )}
      {!d.pasaAnexosOk && <p className="text-[11.5px] font-bold text-rose-600 flex items-center gap-1"><AlertTriangle size={12} /> Línea bloqueada para ANEXOS OK</p>}
    </div>
  );
}
