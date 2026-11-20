'use client';

// Apartado "Postuladas" — rediseño orientado al RESULTADO.
//
// Cada licitación postulada se cruza con el caché de adjudicación (poblado desde la API de
// Mercado Público) y se clasifica según el estado REAL de MP — no una etiqueta a mano:
//   · GANADA (verde)      → MP adjudicó y una de NUESTRAS empresas ganó ≥1 línea (por RUT).
//                           OJO: una licitación se adjudica a VARIOS proveedores por línea;
//                           podemos ser uno de ellos. Se muestran TODOS los ganadores y se
//                           resaltan los nuestros.
//   · PERDIDA (rojo)      → MP adjudicó a un TERCERO — competencia real que perdimos. NO
//                           incluye Desierta/Revocada/Suspendida: mezclarlas ensucia el % de
//                           efectividad (ganadas / (ganadas+perdidas)) con procesos que nunca
//                           tuvieron un ganador con el que competir.
//   · DESIERTA (piedra)   → MP cerró el proceso SIN adjudicar a nadie (sin ofertas válidas).
//   · REVOCADA (gris)     → el organismo dejó sin efecto el proceso.
//   · SUSPENDIDA (ámbar)  → el organismo lo pausó; puede retomarse.
//   · EN EVALUACIÓN (ámbar) → aún sin resultado publicado por MP.
//
// Roles: cada perfil ve SOLO sus postuladas; el admin ve TODAS y puede filtrarlas por
// perfil, empresa y resultado. El filtrado por rol lo hace /api/negocios.

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { fechaHoraParaExcel, ordenarPorFecha, hojaDeFilas } from '@/app/lib/exportar-fechas';
import { useRealtime } from '@/app/lib/use-realtime';
import { ESTADOS_PIPELINE, getEstadoPipeline, normalizarEstado } from '@/app/lib/pipeline';
import { extractTipoFromCodigo, getTipoLicitacion } from '@/app/lib/tipos-licitacion';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { ChipsOc } from '@/app/components/OcChips';
import { Select } from '@/app/components/ui/Select';
import { motion } from 'framer-motion';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { item } from '@/app/components/ui/kit/movimiento';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Encabezado, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { Banner } from '@/app/components/ui/Banner';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { IconSend as Send, IconExternalLink as ExternalLink, IconBuilding as Building2, IconCalendar as Calendar, IconLoader2 as Loader2, IconInbox as Inbox, IconFileText as FileText, IconAward as Award, IconTrophy as Trophy, IconUsers as Users, IconFileCheck as FileCheck2, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconPencil as Pencil, IconTrash as Trash2, IconArrowBackUp as Undo2, IconX as X, IconCircleX as XCircle, IconHourglass as Hourglass, IconDoorExit as DoorOpen, IconDoorEnter as DoorClosed, IconSearch as Search, IconArrowsUpDown as ArrowUpDown, IconDownload as Download, IconBan as Ban, IconBan as CircleSlash, IconPlayerPause as PauseCircle, IconTag as Tag, IconAdjustmentsHorizontal as SlidersHorizontal, IconCurrencyDollar as DollarSign } from '@tabler/icons-react';
import dayjs from 'dayjs';

const ESTADO_POSTULADA = 'POSTULADA';

// Filtro activo: texto con botón de quitar, sin pastilla de color (skill licitank-ui).
const CHIP_FILTRO = 'inline-flex items-center gap-1.5 h-7 rounded-lg border border-linea bg-white px-2 text-xs font-medium text-tinta-2 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';

// Desierta/Revocada/Suspendida son estados TERMINALES-o-pausados de Mercado Público que NO
// implican que perdimos frente a un competidor real — separarlos de 'perdida' es el punto
// central de este archivo (ver comentario de cabecera).
type Resultado = 'ganada' | 'perdida' | 'evaluacion' | 'desierta' | 'revocada' | 'suspendida';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado?: string | null;
  licitacion_tipo?: string | null;
  licitacion_region?: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  usuario_nombre?: string;
  usuario_email?: string;
  aperturada?: number;                 // 1 si el poller del portal ya detectó la apertura
  apertura_detectada_en?: string | null;
  postulada_en?: string | null;        // cuándo se postuló (migración 76); null si es anterior a ella
  etiquetas?: { id: number; nombre: string; color: string }[];  // líneas de negocio (ya viene de /api/negocios)
}
interface EmpresaOpc { id: number; razon_social: string; }
interface DocCache { documento_nombre: string; documento_url_local: string; categoria: string | null; }

interface LineaAdjudicada {
  correlativo?: number;
  producto?: string;
  descripcion?: string;
  cantidad?: number;
  unidad?: string;
  montoUnitario: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
  esNuestra?: boolean;
}
interface Adjudicacion {
  // false cuando NO hay fila real en adjudicacion_cache aún (la API igual manda una entrada
  // "placeholder" por apertura/estado MP). resultadoDeNegocio() usa esto, NO la sola presencia
  // del objeto, para decidir si confía en MP o cae al estado_pipeline propio.
  tieneCacheReal?: boolean;
  esAdjudicada: boolean;
  estado?: string | null;
  codigoEstado?: number | null;
  fechaAdjudicacion?: string | null;
  // Fecha ESTIMADA de adjudicación (planificación del organismo, de la ficha MP) — cuándo
  // se decide. Y la apertura técnica. Sirven para ordenar por "la más cercana".
  fechaEstimadaAdjudicacion?: string | null;
  fechaAperturaTecnica?: string | null;
  ganamos?: boolean;
  montoNuestro?: number | null;
  ocCodigos?: string[];   // N° de nuestras OC de esta licitación (la más reciente primero)
  adjudicacion?: {
    tipo?: number;
    numeroResolucion?: string | null;
    numeroOferentes?: number | null;
    urlActa?: string | null;
  } | null;
  lineasAdjudicadas?: LineaAdjudicada[];
  montoAdjudicadoTotal?: number | null;
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

// Orden de aparición: primero las ganadas (celebrar), luego en evaluación, luego perdidas;
// los estados sin competencia real (desierta/revocada/suspendida) van al final, son ruido
// para la gestión activa.
const ORDEN: Record<Resultado, number> = {
  ganada: 0, evaluacion: 1, perdida: 2, suspendida: 3, desierta: 4, revocada: 5,
};

// Mismo criterio por NOMBRE que refrescar-estados.ts/verificar-postuladas-mp.mts: MP usa
// códigos inconsistentes para el mismo estado (Revocada llegó con CodigoEstado 15 en un caso
// real, no 18), así que el texto (`estado`, ya expuesto por adjudicacion_cache) es la señal
// confiable, no el código numérico.
function normNombreResultado(s?: string | null): string {
  return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Clasifica una postulada según lo que dice la API de MP — el estado REAL, no la etiqueta
// interna. Desierta/Revocada/Suspendida son procesos sin un ganador con el que comparar: si
// entraran a 'perdida' inflarían la derrota y ensuciarían el % de efectividad con casos que
// nunca fueron una competencia perdida de verdad.
function resultadoDe(adj: Adjudicacion | null | undefined): Resultado {
  if (adj?.esAdjudicada && adj.ganamos) return 'ganada';
  if (adj?.esAdjudicada) return 'perdida';
  const t = normNombreResultado(adj?.estado);
  if (/desiert/.test(t)) return 'desierta';
  if (/revocad/.test(t)) return 'revocada';
  if (/suspend/.test(t)) return 'suspendida';
  return 'evaluacion';
}

// Metadatos visuales por resultado (un solo lugar → coherencia de color en toda la vista).
const META: Record<Resultado, {
  label: string; short: string; color: string; ring: string; soft: string;
  text: string; border: string; icon: typeof Trophy;
}> = {
  ganada: {
    label: 'Ganada', short: 'Ganadas', color: '#059669', ring: 'rgba(5,150,105,.35)',
    soft: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: Trophy,
  },
  perdida: {
    label: 'Perdida', short: 'Perdidas', color: '#dc2626', ring: 'rgba(220,38,38,.30)',
    soft: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: XCircle,
  },
  evaluacion: {
    label: 'En evaluación', short: 'En evaluación', color: '#d97706', ring: 'rgba(217,119,6,.30)',
    soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Hourglass,
  },
  desierta: {
    label: 'Desierta', short: 'Desiertas', color: '#78716c', ring: 'rgba(120,113,108,.30)',
    soft: 'bg-stone-50', text: 'text-stone-600', border: 'border-stone-200', icon: CircleSlash,
  },
  revocada: {
    label: 'Revocada', short: 'Revocadas', color: '#64748b', ring: 'rgba(100,116,139,.30)',
    soft: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: Ban,
  },
  suspendida: {
    label: 'Suspendida', short: 'Suspendidas', color: '#b45309', ring: 'rgba(180,83,9,.30)',
    soft: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: PauseCircle,
  },
};

// ── Resultado: texto con punto de color (skill licitank-ui, sin pastilla) ─────
function ResultadoEstado({ r }: { r: Resultado }) {
  return (
    <span className="text-xs font-medium text-tinta dark:text-slate-100">
      <Estado color={META[r].color}>{META[r].label}</Estado>
    </span>
  );
}

// ── Apertura (detectada leyendo el portal de MP) ──────────────────────────────
// "Aperturada" cuando el poller ya vio el acto de apertura; "Sin apertura" mientras no.
// El estado lo trae /api/negocios desde la tabla licitacion_apertura.
function AperturaChip({ aperturada }: { aperturada: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-tinta-2 dark:text-slate-400"
      title={aperturada
        ? 'Mercado Público ya realizó el acto de apertura de esta licitación'
        : 'Aún sin acto de apertura en Mercado Público'}>
      {aperturada
        ? <DoorOpen size={14} stroke={1.75} className="text-slate-400" />
        : <DoorClosed size={14} stroke={1.75} className="text-slate-400" />}
      {aperturada ? 'Aperturada' : 'Sin apertura'}
    </span>
  );
}

// ── FECHA DE POSTULACIÓN ──────────────────────────────────────────
// Cuándo se postuló (se sella al pasar a POSTULADA, migración 76). Las postuladas
// anteriores a la migración no tienen el dato: se muestra "—" en vez de inventar una fecha.
function FechaPostulacionChip({ iso }: { iso?: string | null }) {
  const d = iso ? dayjs(iso) : null;
  if (!d || !d.isValid()) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-tinta-2 dark:text-slate-400"
        title="No hay registro de la fecha de postulación (anterior al registro automático)">
        <Send size={14} stroke={1.75} className="text-slate-400" /> Postulada —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-tinta-2 tabular-nums dark:text-slate-400"
      title={`Se postuló el ${d.format('DD/MM/YYYY')} a las ${d.format('HH:mm')}`}>
      <Send size={14} stroke={1.75} className="text-slate-400" /> Postulada {d.format('DD/MM/YYYY')}
    </span>
  );
}

// ── FECHA DE ADJUDICACIÓN ─────────────────────────────────────────────────────
// La info que el usuario más pide en Postuladas: ¿cuándo se decide cada una? Si ya se
// adjudicó, muestra la fecha real; si sigue en evaluación, la ESTIMADA de la ficha MP con
// el "en X días" para saber de un vistazo cuál se resuelve antes. El color sube de tono a
// medida que se acerca (o si ya se pasó la fecha estimada sin resultado); siempre con texto.
function FechaAdjChip({ adj }: { adj: Adjudicacion | null }) {
  if (!adj) return null;
  const iso = adj.esAdjudicada ? adj.fechaAdjudicacion : adj.fechaEstimadaAdjudicacion;
  if (!iso) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;

  if (adj.esAdjudicada) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-tinta-2 tabular-nums dark:text-slate-400"
        title={`Fecha de adjudicación: ${d.format('DD/MM/YYYY')}`}>
        <Award size={14} stroke={1.75} className="text-slate-400" /> Adjudicada {d.format('DD/MM/YYYY')}
      </span>
    );
  }
  const dias = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  const rel = dias < 0 ? `atrasada ${-dias} d` : dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
  const tono = dias < 0 ? 'text-urgente font-medium'
    : dias <= 3 ? 'text-alerta font-medium'
    : 'text-tinta-2 dark:text-slate-400';
  return (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${tono}`}
      title={`Fecha estimada de adjudicación (ficha de Mercado Público): ${d.format('DD/MM/YYYY HH:mm')}`}>
      <Hourglass size={14} stroke={1.75} /> Se decide {d.format('DD/MM/YYYY')} · {rel}
    </span>
  );
}

// Agrupa las líneas por proveedor adjudicado → un resumen "quién ganó qué y por cuánto".
// Cruza por RUT con nuestras empresas (esNuestra ya viene calculado desde el servidor).
interface Ganador {
  rut: string | null; proveedor: string; lineas: number;
  cantidad: number; monto: number; esNuestra: boolean;
}
function agruparGanadores(lineas: LineaAdjudicada[]): Ganador[] {
  const m = new Map<string, Ganador>();
  for (const l of lineas) {
    const key = (l.rutProveedor || l.proveedor || '—').toUpperCase();
    const g = m.get(key) || {
      rut: l.rutProveedor ?? null, proveedor: l.proveedor || 'Proveedor adjudicado',
      lineas: 0, cantidad: 0, monto: 0, esNuestra: !!l.esNuestra,
    };
    g.lineas++;
    g.cantidad += Number(l.cantidad) || 0;
    g.monto += (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
    g.esNuestra = g.esNuestra || !!l.esNuestra;
    m.set(key, g);
  }
  // Nuestro primero, luego por monto descendente.
  return Array.from(m.values()).sort((a, b) =>
    (a.esNuestra === b.esNuestra ? b.monto - a.monto : a.esNuestra ? -1 : 1));
}

// ── Detalle de adjudicación (todos los ganadores por línea) ───────────────────
function BloqueAdjudicacion({ adj }: { adj: Adjudicacion }) {
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const ganamos = !!adj.ganamos;
  const acc = ganamos ? META.ganada : META.perdida;
  const ganadores = useMemo(() => agruparGanadores(lineas), [lineas]);
  // En las perdidas se muestra el detalle por línea abierto de una (para ver al ganador sin clic).
  const [abierto, setAbierto] = useState(!ganamos);

  return (
    <div className="mt-4 pt-4 border-t border-linea dark:border-slate-800">
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
        <span className="text-[13px] font-semibold text-tinta dark:text-slate-100">
          <Estado color={acc.color}>
            {ganamos ? `Ganamos ${nuestras} línea${nuestras !== 1 ? 's' : ''}` : 'Adjudicada a terceros'}
          </Estado>
        </span>
        {adj.fechaAdjudicacion && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={14} stroke={1.75} className="text-slate-400" /> {dayjs(adj.fechaAdjudicacion).format('DD/MM/YYYY')}
          </span>
        )}
        {meta?.numeroOferentes != null && (
          <span className="inline-flex items-center gap-1">
            <Users size={14} stroke={1.75} className="text-slate-400" /> {meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}
          </span>
        )}
        {meta?.numeroResolucion && <span>Res. N° {meta.numeroResolucion}</span>}
      </div>

      {/* Resumen por ganador (siempre visible): quién se adjudicó, RUT, líneas y monto */}
      {ganadores.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] text-tinta-2 dark:text-slate-400">
            {ganadores.length === 1 ? 'Adjudicado a' : `Adjudicado a ${ganadores.length} proveedores`}
          </p>
          <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
            {ganadores.map((g, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-tinta truncate dark:text-slate-100" title={g.proveedor}>
                    {g.proveedor}
                    {g.esNuestra && <span className="ml-2 text-xs font-medium text-exito">Nosotros</span>}
                  </p>
                  <p className="text-xs text-tinta-2 dark:text-slate-400">
                    {g.rut ? g.rut : 'RUT no informado'} · {g.lineas} línea{g.lineas !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-[13px] font-semibold text-tinta tabular-nums whitespace-nowrap dark:text-slate-100">{fmtCLP(g.monto)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lineas.length > 0 && (
        <>
          <Boton tamano="sm" variante="fantasma" className="mt-2 -ml-2" onClick={() => setAbierto(o => !o)} aria-expanded={abierto}
            icono={abierto ? <ChevronUp size={16} stroke={1.75} /> : <ChevronDown size={16} stroke={1.75} />}>
            {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea ({lineas.length})
          </Boton>
          {abierto && (
            <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
              {lineas.map((l, i) => {
                const totalLinea = (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
                return (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-tinta truncate dark:text-slate-100" title={l.producto || l.descripcion}>
                        {l.correlativo ? `${l.correlativo}. ` : ''}{l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                      </p>
                      <p className="text-xs text-tinta-2 truncate dark:text-slate-400"
                        title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        {l.proveedor || 'Proveedor adjudicado'}
                        {l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                        {l.esNuestra && <span className="ml-2 font-medium text-exito">Nosotros</span>}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <span className="block text-[13px] font-semibold text-tinta tabular-nums dark:text-slate-100">{fmtCLP(totalLinea)}</span>
                      {l.cantidad != null && (
                        <span className="block text-xs text-tinta-2 tabular-nums dark:text-slate-400">
                          {l.cantidad} {l.unidad || 'u'} × {fmtCLP(l.montoUnitario)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {meta?.urlActa && (
        <a href={meta.urlActa} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-marca hover:underline">
          <FileCheck2 size={16} stroke={1.75} /> Ver acta de adjudicación <ExternalLink size={14} stroke={1.75} />
        </a>
      )}
    </div>
  );
}

// ── Tarjeta de una postulada ──────────────────────────────────────────────────
function PostuladaCard({ n, adj, cargandoAdj, docsIniciales, isAdmin, empresas, onRevertida, onActualizada }: {
  n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; docsIniciales: DocCache[];
  isAdmin: boolean; empresas: EmpresaOpc[];
  onRevertida: (id: number) => void;
  onActualizada: (id: number, patch: { monto_ofertado?: number; estado_pipeline?: string; empresa_id?: number | null; empresa_nombre?: string | null }) => void;
}) {
  const [docs, setDocs] = useState<DocCache[]>(docsIniciales);
  const [expandido, setExpandido] = useState(false);
  const [editando, setEditando] = useState(false);
  const [montoEdit, setMontoEdit] = useState<string>(n.monto_ofertado ? String(n.monto_ofertado) : '');
  const [estadoEdit, setEstadoEdit] = useState<string>(n.estado_pipeline || ESTADO_POSTULADA);
  const [empresaEdit, setEmpresaEdit] = useState<string>(n.empresa_id ? String(n.empresa_id) : '');
  const [guardando, setGuardando] = useState(false);
  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  const confirmar = useConfirm();
  const toast = useToast();

  const r = resultadoDe(adj);

  // Los documentos propios llegan ya resueltos desde el padre (una sola llamada batch).
  useEffect(() => { setDocs(docsIniciales); }, [docsIniciales]);

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      const monto = parseInt(String(montoEdit).replace(/\D/g, ''), 10) || 0;
      const empresaId = empresaEdit ? Number(empresaEdit) : null;
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto_ofertado: monto, estado_pipeline: estadoEdit, empresa_id: empresaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Postulada actualizada');
      setEditando(false);
      const empresaNombre = empresas.find(e => e.id === empresaId)?.razon_social ?? null;
      onActualizada(n.id, { monto_ofertado: monto, estado_pipeline: estadoEdit, empresa_id: empresaId, empresa_nombre: empresaNombre });
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(false);
    }
  };

  const revertir = async () => {
    const ok = await confirmar({
      titulo: '¿Quitar de Postuladas?',
      mensaje: 'La licitación volverá a "En proceso" y saldrá de este apartado. No se elimina el negocio.',
      confirmarLabel: 'Quitar', peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/negocios/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: 'EN_PROCESO' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo revertir');
      toast.success('Devuelta a En proceso');
      onRevertida(n.id);
    } catch (e: any) {
      toast.error('No se pudo revertir', e?.message);
    }
  };

  const borrarDoc = async (d: DocCache) => {
    const ok = await confirmar({
      titulo: '¿Eliminar documento?',
      mensaje: `"${d.documento_nombre}" se eliminará de forma permanente.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const prev = docs;
    setDocs(ds => ds.filter(x => x !== d));
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(n.licitacion_codigo)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: d.documento_url_local, nombre: d.documento_nombre }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Documento eliminado');
    } catch (e: any) {
      setDocs(prev);
      toast.error('No se pudo eliminar', e?.message);
    }
  };

  // Métrica del resultado (solo se muestra si ya se adjudicó).
  const metricaResultado = r === 'ganada'
    ? { label: 'Ganamos', valor: fmtCLP(adj?.montoNuestro) }
    : { label: 'Adjudicado (total)', valor: fmtCLP(adj?.montoAdjudicadoTotal) };

  const cancelarEdicion = () => {
    setEditando(false);
    setMontoEdit(n.monto_ofertado ? String(n.monto_ofertado) : '');
    setEstadoEdit(n.estado_pipeline || ESTADO_POSTULADA);
    setEmpresaEdit(n.empresa_id ? String(n.empresa_id) : '');
  };

  return (
    <motion.div variants={item}
      className="group bg-white border border-linea rounded-xl shadow-tarjeta transition-shadow duration-150 ease-lk hover:shadow-tarjeta-hover dark:bg-slate-900 dark:border-slate-800">
      {/* ── FILA COMPACTA (siempre visible; clic para expandir) ─────────────── */}
      <div role="button" tabIndex={0} aria-expanded={expandido}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60"
        onClick={() => setExpandido(e => !e)}
        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpandido(v => !v); } }}>
        <ChevronDown size={16} stroke={1.75} className={`flex-shrink-0 text-slate-400 transition-transform ${expandido ? 'rotate-180' : ''}`} />

        {/* Identidad: código + título; debajo el resultado y quién la lleva */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-tinta-2 flex-shrink-0 dark:text-slate-400">{n.licitacion_codigo}</span>
            <h3 className="text-sm font-semibold text-tinta truncate dark:text-slate-100">{n.licitacion_nombre || 'Sin nombre'}</h3>
            {r === 'ganada' && <ChipsOc codigos={adj?.ocCodigos} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-2 dark:text-slate-400">
            {!cargandoAdj && <ResultadoEstado r={r} />}
            {n.licitacion_organismo && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <Building2 size={14} stroke={1.75} className="flex-shrink-0 text-slate-400" />
                <span className="truncate max-w-[260px]">{n.licitacion_organismo}</span>
              </span>
            )}
            {isAdmin && (n.usuario_nombre || n.usuario_email) && (
              <span className="inline-flex items-center gap-1.5 min-w-0" title={n.usuario_nombre || n.usuario_email}>
                <span style={{ background: perfilCol }} className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white">
                  {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                </span>
                <span className="truncate max-w-[160px]">{n.usuario_nombre || n.usuario_email}</span>
              </span>
            )}
            {n.aperturada ? <AperturaChip aperturada /> : null}
          </div>
        </div>

        {/* Fechas (lo que se ordena): cuándo se decide y cuándo se postuló */}
        <div className="hidden @2xl:flex flex-col items-end gap-1 flex-shrink-0">
          {!cargandoAdj && <FechaAdjChip adj={adj} />}
          <FechaPostulacionChip iso={n.postulada_en} />
        </div>

        {/* Monto ofertado (columna fija, separada por una línea) */}
        <div className="hidden @4xl:block flex-shrink-0 w-[132px] border-l border-linea pl-4 text-right dark:border-slate-800">
          <p className="text-[11px] text-tinta-2 dark:text-slate-400">Ofertamos</p>
          <p className="text-sm font-semibold text-tinta tabular-nums truncate dark:text-slate-100">{fmtCLP(n.monto_ofertado)}</p>
        </div>

        {/* Acciones (no propagan el clic de expandir) */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {isAdmin && (
            <>
              <button onClick={() => { setEditando(true); setExpandido(true); }} title="Editar monto y estado" aria-label="Editar monto y estado"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-tinta opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
                <Pencil size={16} stroke={1.75} />
              </button>
              <button onClick={revertir} title="Quitar de Postuladas (vuelve a En proceso)" aria-label="Quitar de Postuladas"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-urgente opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-red-950/40">
                <Undo2 size={16} stroke={1.75} />
              </button>
            </>
          )}
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}`}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-marca transition-colors hover:bg-marca-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
            Ver <ExternalLink size={14} stroke={1.75} />
          </Link>
        </div>
      </div>

      {/* Con poco ancho, las fechas no caben en la fila → se muestran bajo el título */}
      <div className="@2xl:hidden flex items-center gap-x-4 gap-y-1 flex-wrap px-4 pb-3 -mt-1">
        {!cargandoAdj && <FechaAdjChip adj={adj} />}
        <FechaPostulacionChip iso={n.postulada_en} />
      </div>

      {/* ── DETALLE (acordeón) ──────────────────────────────────────────────── */}
      {expandido && (
      <div className="px-4 pb-4 pt-3 border-t border-linea dark:border-slate-800">
        <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 ${adj?.esAdjudicada ? '@xl:grid-cols-4' : '@xl:grid-cols-3'}`}>
          <Dato rotulo="Empresa con la que se postuló">{n.empresa_nombre || undefined}</Dato>
          <Dato rotulo="Presupuesto real">{n.licitacion_monto ? fmtCLP(n.licitacion_monto) : undefined}</Dato>
          <Dato rotulo="Postulamos con">{n.monto_ofertado ? fmtCLP(n.monto_ofertado) : undefined}</Dato>
          {adj?.esAdjudicada && <Dato rotulo={metricaResultado.label}>{cargandoAdj ? '…' : metricaResultado.valor}</Dato>}
        </dl>

        {/* Oferta frente al presupuesto: la barra se llena; roja si nos pasamos */}
        {(() => {
          if (!n.licitacion_monto || !n.monto_ofertado) return null;
          const pct = Math.round((n.monto_ofertado / n.licitacion_monto) * 100);
          return (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-3 text-xs text-tinta-2 dark:text-slate-400">
                <span>Oferta frente al presupuesto</span>
                <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">
                  {pct} %{pct > 100 ? ' · sobre el presupuesto' : ` · ahorra ${100 - pct} %`}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`La oferta es el ${pct} % del presupuesto`}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: pct > 100 ? '#dc2626' : '#0f766e' }} />
              </div>
            </div>
          );
        })()}

        {editando && (
          <div className="mt-4 pt-4 border-t border-linea dark:border-slate-800">
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
              <label className="block">
                <span className="text-[13px] font-medium text-tinta dark:text-slate-100">Monto ofertado</span>
                <input type="text" inputMode="numeric" value={montoEdit}
                  onChange={e => setMontoEdit(e.target.value)} placeholder="$"
                  className="mt-1 h-9 w-full rounded-lg border border-linea bg-white px-3 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-tinta dark:text-slate-100">Estado</span>
                <div className="mt-1"><Select value={estadoEdit} onChange={setEstadoEdit}
                  options={ESTADOS_PIPELINE.map(e => ({ value: e.id, label: e.label }))} /></div>
              </label>
              <label className="block @xl:col-span-2">
                <span className="text-[13px] font-medium text-tinta dark:text-slate-100">Empresa con la que se postuló <span className="font-normal text-tinta-3">(opcional)</span></span>
                <div className="mt-1"><Select value={empresaEdit} onChange={setEmpresaEdit}
                  placeholder="— Sin especificar —"
                  options={[{ value: '', label: '— Sin especificar —' }, ...empresas.map(e => ({ value: String(e.id), label: e.razon_social }))]} /></div>
              </label>
            </div>
            <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400">Si cambias el estado a uno distinto de <b className="font-semibold">Postulada</b>, saldrá de este apartado.</p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Boton onClick={cancelarEdicion}>Cancelar</Boton>
              <Boton variante="primario" onClick={guardarEdicion} disabled={guardando}
                icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </Boton>
            </div>
          </div>
        )}

        {/* Detalle de adjudicación (ganada o perdida) */}
        {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} />}

        {/* En evaluación: estado según MP */}
        {!cargandoAdj && !adj?.esAdjudicada && (
          <p className="mt-3 text-[13px] text-tinta-2 dark:text-slate-400">
            <Estado color={META.evaluacion.color}>Sin resultado aún{adj?.estado ? ` · MP: ${adj.estado}` : ''}</Estado>
          </p>
        )}

        {/* F.2 — la competencia se revisa en la ficha de la licitación, no acá: esta fila es un
            resumen del negocio y meterle la tabla de oferentes con sus anexos la volvía ilegible.
            Acá solo queda el acceso, cuando ya hubo apertura. */}
        {!!n.aperturada && (
          <Link href={`/licitacion/${encodeURIComponent(n.licitacion_codigo)}?seccion=competencia`}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
            <Users size={16} stroke={1.75} className="text-slate-400" /> Ver ofertas de la competencia
          </Link>
        )}

        {docs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-linea dark:border-slate-800">
            <p className="text-[13px] font-medium text-tinta dark:text-slate-100">Documentos propios <span className="text-xs font-semibold tabular-nums text-tinta-2">{docs.length}</span></p>
            <ul className="mt-1.5 divide-y divide-linea dark:divide-slate-800">
              {docs.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <a href={d.documento_url_local} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-tinta hover:text-marca dark:text-slate-100">
                    <FileText size={16} stroke={1.75} className="flex-shrink-0 text-slate-400" />
                    <span className="truncate">{d.documento_nombre}</span>
                  </a>
                  <button onClick={() => borrarDoc(d)} title="Eliminar documento" aria-label={`Eliminar ${d.documento_nombre}`}
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-red-950/40">
                    <Trash2 size={16} stroke={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      )}
    </motion.div>
  );
}


// ── Torta: cómo se reparten las postuladas según el resultado en Mercado Público ─────────────
// Cada tajada es un resultado; el centro dice la efectividad (ganadas sobre ganadas + perdidas). La leyenda
// dice cuántas son y qué % del total, y al hacer clic filtra la lista (igual que las pestañas).
function DonaResultados({ conteo, total, exito, elegido, onElegir }: {
  conteo: Record<Resultado, number>; total: number; exito: number | null;
  elegido: Resultado | ''; onElegir: (r: Resultado | '') => void;
}) {
  const R = 52, C = 2 * Math.PI * R;
  const orden: Resultado[] = ['ganada', 'evaluacion', 'perdida', 'suspendida', 'desierta', 'revocada'];
  const visibles = orden.filter(r => conteo[r] > 0);
  let acumulado = 0;
  const tajadas = visibles.map(r => {
    const largo = total ? (conteo[r] / total) * C : 0;
    const t = { r, largo, desde: acumulado };
    acumulado += largo;
    return t;
  });
  return (
    <div className="rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Resultado de las {total} postuladas</h2>
      <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">Cómo terminó cada oferta en Mercado Público</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="relative h-[132px] w-[132px] flex-shrink-0">
          <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" role="img"
            aria-label={`Reparto de ${total} postuladas por resultado`}>
            <circle cx="66" cy="66" r={R} fill="none" strokeWidth="16" className="stroke-slate-100 dark:stroke-slate-800" />
            {tajadas.map(t => (
              <circle key={t.r} cx="66" cy="66" r={R} fill="none" strokeWidth="16"
                stroke={META[t.r].color}
                strokeDasharray={`${Math.max(t.largo - (tajadas.length > 1 ? 1.5 : 0), 0)} ${C}`}
                strokeDashoffset={-t.desde}
                opacity={elegido && elegido !== t.r ? 0.25 : 1}
                className="transition-opacity duration-150">
                <title>{`${META[t.r].short}: ${conteo[t.r]}`}</title>
              </circle>
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-tinta dark:text-slate-50">
              {exito != null ? `${exito} %` : '—'}
            </span>
            <span className="mt-1 text-[11px] leading-tight text-tinta-2 dark:text-slate-400">de efectividad</span>
          </div>
        </div>
        <ul className="min-w-[180px] flex-1 space-y-0.5">
          {visibles.map(r => (
            <li key={r}>
              <button type="button" onClick={() => onElegir(elegido === r ? '' : r)} aria-pressed={elegido === r}
                title={elegido === r ? 'Quitar filtro' : `Ver solo las ${META[r].short.toLowerCase()}`}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800 ${elegido === r ? 'bg-slate-50 dark:bg-slate-800' : ''}`}>
                <span aria-hidden style={{ backgroundColor: META[r].color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
                <span className="flex-1 text-tinta dark:text-slate-100">{META[r].short}</span>
                <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{conteo[r]}</span>
                <span className="w-10 text-right text-xs tabular-nums text-tinta-2 dark:text-slate-400">{Math.round((conteo[r] / total) * 100)} %</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 border-t border-linea pt-2.5 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
        Efectividad = ganadas ÷ (ganadas + perdidas). Desiertas, revocadas y suspendidas no cuentan: nunca tuvieron un ganador con quien competir.
      </p>
    </div>
  );
}

export default function PostuladasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const toast = useToast();

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [empresasOpc, setEmpresasOpc] = useState<EmpresaOpc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState<string>('');
  // Filtros de SELECCIÓN MÚLTIPLE (mismo patrón que Analizadas/Descartadas/Historial):
  // AND entre filtros, OR dentro de cada uno; vacío = sin filtrar por esa dimensión.
  const [perfilesSel, setPerfilesSel] = useState<string[]>([]);
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');
  // Filtro por estado de MP (Publicada/Cerrada/Adjudicada/Revocada/Desierta…) + "Aperturadas".
  const [estadosMpSel, setEstadosMpSel] = useState<string[]>([]);
  // Filtros adicionales (mismo patrón multi-select AND-entre-dimensiones que arriba).
  const [tiposSel, setTiposSel] = useState<string[]>([]);
  const [etiquetasSel, setEtiquetasSel] = useState<string[]>([]);
  const [cierreDesde, setCierreDesde] = useState('');
  const [cierreHasta, setCierreHasta] = useState('');
  const [montoMin, setMontoMin] = useState('');
  const [montoMax, setMontoMax] = useState('');
  // Panel de filtros secundarios colapsable (mismo patrón que /negocios): los tabs de
  // Resultado y el buscador quedan siempre visibles; el resto se guarda para no saturar.
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  // Ordenamiento de las tarjetas y carga incremental (las adjudicaciones hacen pesada cada tarjeta).
  const [orden, setOrden] = useState<'adjudicacion' | 'resultado' | 'cierre' | 'monto'>('adjudicacion');
  const [maxVisibles, setMaxVisibles] = useState(24);
  const [exportando, setExportando] = useState(false);

  // Estado de cada postulada (adjudicación + apertura). Se resuelve TODO en el servidor en
  // una sola llamada (/api/postuladas/estado) → los totales aparecen juntos, sin animación
  // "una por una". adjMap por código; la apertura se refleja en cada negocio (n.aperturada).
  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [estadoCargado, setEstadoCargado] = useState(false);
  // Documentos propios de TODAS las postuladas en UNA sola llamada (evita el N+1 de un
  // fetch por tarjeta). Mapa código → docs (solo categoría DOCUMENTOS_PROPIOS).
  const [docsPropiosMap, setDocsPropiosMap] = useState<Record<string, DocCache[]>>({});

  // Tiempo real: cada evento del SSE (alguien postuló, cambió una etapa, o el cron trajo
  // adjudicaciones/aperturas desde MP) sube `version` y re-dispara toda la cadena de carga:
  // negocios → estado (adjudicación + apertura) → refresco de aperturas.
  const [version, setVersion] = useState(0);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/negocios', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        // Universo = TODO lo que pasó por postulación. Incluye las que siguen en POSTULADA,
        // las marcadas POSIBLE_ADJ, y las ya resueltas/promovidas (ADJUDICADA/PERDIDA) — así
        // Postuladas es el superconjunto real y sus ganadas/perdidas CUADRAN con /adjudicadas
        // (que muestra solo ese subconjunto). El resultado se clasifica por el cache de MP.
        setNegocios(todas.filter(n => ['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA'].includes(n.estado_pipeline || '')));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setCargando(false);
      }
    })();
  }, [version]);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => {
      if (d.success) setEmpresasOpc(d.empresas || []);
    }).catch(() => {});
  }, []);

  // Documentos propios de todas las postuladas en UNA sola petición batch.
  useEffect(() => {
    const codigos = negocios.map(n => n.licitacion_codigo).filter(Boolean);
    if (codigos.length === 0) return;
    let cancelado = false;
    fetch('/api/documentos/cache/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigos, categoria: 'DOCUMENTOS_PROPIOS' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelado && d?.docs) setDocsPropiosMap(d.docs); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [negocios]);

  // Cruce con MP en UNA sola llamada al servidor (adjudicación cache-first + apertura).
  useEffect(() => {
    if (negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/estado', { cache: 'no-store' });
        const d = await r.json();
        if (cancelado) return;
        if (d?.estados) {
          setAdjMap(d.estados);
          // Reflejar el estado de apertura en cada tarjeta (chip Aperturada / Sin apertura).
          setNegocios(prev => prev.map(n => ({ ...n, aperturada: d.estados[n.licitacion_codigo]?.aperturada ? 1 : 0 })));
        }
      } catch { /* si falla, se muestran los negocios sin cruce */ }
      finally { if (!cancelado) setEstadoCargado(true); }
    })();
    return () => { cancelado = true; };
  }, [negocios.length, version]);

  // NOTA (sep-2026, auditoría de tiempo real): antes había acá un segundo refresco que rascaba el
  // portal de MP en vivo apenas se abría esta pantalla, para detectar aperturas antes que el cron.
  // Se sacó a propósito — el dueño pidió que NINGUNA consulta a MP dependa de abrir una pantalla,
  // solo el cron de 5 min (/api/cron/aperturas, vía scheduler.mjs). El chip "Aperturada" sigue
  // viniendo de `/api/postuladas/estado` (arriba), que ya lee la tabla `licitacion_apertura` que
  // ese cron mantiene al día.

  // Perfiles presentes (filtro admin).
  const perfiles = useMemo(() => {
    const m = new Map<string, { email: string; nombre: string; total: number }>();
    for (const n of negocios) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { email, nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++; m.set(email, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Empresas presentes (filtro).
  const empresasFiltro = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; total: number }>();
    for (const n of negocios) {
      if (!n.empresa_id) continue;
      const id = String(n.empresa_id);
      const e = m.get(id) || { id, nombre: n.empresa_nombre || `Empresa ${id}`, total: 0 };
      e.total++; m.set(id, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Tipo de licitación (LE/LP/LR/CO…) presente, derivado del código — mismo helper que /negocios.
  const tiposFiltro = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of negocios) {
      const t = n.licitacion_tipo || extractTipoFromCodigo(n.licitacion_codigo || '');
      if (t) m.set(t, (m.get(t) || 0) + 1);
    }
    return Array.from(m.entries())
      .map(([codigo, total]) => ({ codigo, total, label: getTipoLicitacion(codigo)?.label || codigo }))
      .sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Líneas de negocio (etiquetas) presentes — mismo dato que ya trae /api/negocios por fila.
  const etiquetasFiltro = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; color: string; total: number }>();
    for (const n of negocios) {
      for (const et of n.etiquetas || []) {
        const id = String(et.id);
        const e = m.get(id) || { id, nombre: et.nombre, color: et.color, total: 0 };
        e.total++; m.set(id, e);
      }
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Filtro por búsqueda (nombre / código / organismo) + perfil + empresa + tipo + línea de
  // negocio + rango de cierre + rango de monto. Base para tabs y KPIs, así el buscador y los
  // filtros acotan TODO (conteos incluidos), no solo la lista visible.
  const base = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const min = montoMin.trim() ? Number(montoMin) : null;
    const max = montoMax.trim() ? Number(montoMax) : null;
    const desde = cierreDesde ? dayjs(cierreDesde).startOf('day').valueOf() : null;
    const hasta = cierreHasta ? dayjs(cierreHasta).endOf('day').valueOf() : null;
    return negocios
      .filter(n => !q
        || (n.licitacion_nombre || '').toLowerCase().includes(q)
        || (n.licitacion_codigo || '').toLowerCase().includes(q)
        || (n.licitacion_organismo || '').toLowerCase().includes(q))
      .filter(n => perfilesSel.length === 0 || perfilesSel.includes(n.usuario_email || n.usuario_nombre || '—'))
      .filter(n => empresasSel.length === 0 || empresasSel.includes(String(n.empresa_id || '')))
      .filter(n => tiposSel.length === 0 || tiposSel.includes(n.licitacion_tipo || extractTipoFromCodigo(n.licitacion_codigo || '')))
      .filter(n => etiquetasSel.length === 0 || (n.etiquetas || []).some(e => etiquetasSel.includes(String(e.id))))
      .filter(n => {
        if (min == null && max == null) return true;
        const monto = n.licitacion_monto;
        if (monto == null) return false;
        return (min == null || monto >= min) && (max == null || monto <= max);
      })
      .filter(n => {
        if (desde == null && hasta == null) return true;
        if (!n.licitacion_cierre) return false;
        const t = dayjs(n.licitacion_cierre).valueOf();
        return (desde == null || t >= desde) && (hasta == null || t <= hasta);
      });
  }, [negocios, busqueda, perfilesSel, empresasSel, tiposSel, etiquetasSel, montoMin, montoMax, cierreDesde, cierreHasta]);

  // Cuenta cuántas DIMENSIONES de filtro están activas (para el badge del botón "Filtros" y
  // para decidir si mostrar "Limpiar" y los chips) — no es "todas" de resultadoSel, ese vive
  // en los tabs, no en el panel.
  const filtrosActivosCount = [
    busqueda, perfilesSel.length, empresasSel.length, tiposSel.length, etiquetasSel.length,
    estadosMpSel.length, cierreDesde || cierreHasta, montoMin || montoMax,
  ].filter(Boolean).length;

  const limpiarFiltros = useCallback(() => {
    setBusqueda(''); setPerfilesSel([]); setEmpresasSel([]); setTiposSel([]); setEtiquetasSel([]);
    setEstadosMpSel([]); setCierreDesde(''); setCierreHasta(''); setMontoMin(''); setMontoMax('');
  }, []);

  const resultadoDeNegocio = useCallback(
    (n: Negocio): Resultado => {
      const a = adjMap[n.licitacion_codigo];
      // Fix 24-jul-2026: antes era `if (a)`, y la API SIEMPRE manda una entrada por código
      // (con esAdjudicada=false de placeholder) → el fallback de abajo nunca se alcanzaba.
      if (a?.tieneCacheReal) return resultadoDe(a);
      // Sin cache aún: si ya quedó resuelta por estado, respétalo (coincide con /adjudicadas
      // durante la carga y si MP no respondiera).
      const estado = normalizarEstado(n.estado_pipeline);
      if (estado === 'ADJUDICADA') return 'ganada';
      if (estado === 'PERDIDA') return 'perdida';
      return 'evaluacion';
    },
    [adjMap],
  );

  // Estado de MP por postulada (texto tal cual lo entrega la API vía cache). Fallback si aún
  // no hay dato en cache: usa el estado guardado en la licitación.
  const estadoMpDe = useCallback(
    (n: Negocio): string => adjMap[n.licitacion_codigo]?.estado || n.licitacion_estado || 'Sin dato',
    [adjMap],
  );

  const APERTURADAS = '__APERTURADAS__';

  // Lista de estados MP presentes (con conteo) + entrada especial "Aperturadas".
  const estadosMp = useMemo(() => {
    const m = new Map<string, number>();
    let aperturadas = 0;
    for (const n of base) {
      m.set(estadoMpDe(n), (m.get(estadoMpDe(n)) || 0) + 1);
      if (n.aperturada) aperturadas++;
    }
    const lista = Array.from(m.entries())
      .map(([estado, total]) => ({ id: estado, label: estado, total }))
      .sort((a, b) => b.total - a.total);
    if (aperturadas > 0) lista.unshift({ id: APERTURADAS, label: 'Aperturadas', total: aperturadas });
    return lista;
  }, [base, estadoMpDe]);

  // Conteo por resultado (sobre la base filtrada por perfil/empresa).
  const conteo = useMemo(() => {
    const c: Record<Resultado, number> = { ganada: 0, perdida: 0, evaluacion: 0, desierta: 0, revocada: 0, suspendida: 0 };
    for (const n of base) c[resultadoDeNegocio(n)]++;
    return c;
  }, [base, resultadoDeNegocio]);

  // Fecha en que se DECIDE una postulada (ms): si ya se adjudicó, la fecha real; si sigue en
  // evaluación, la ESTIMADA de la ficha MP. null si no hay ninguna.
  const fechaDecisionDe = useCallback((n: Negocio): number | null => {
    const adj = adjMap[n.licitacion_codigo];
    const iso = adj?.esAdjudicada ? adj?.fechaAdjudicacion : adj?.fechaEstimadaAdjudicacion;
    const t = iso ? dayjs(iso).valueOf() : NaN;
    return Number.isFinite(t) ? t : null;
  }, [adjMap]);
  // Peso de grupo para el orden "adjudicación", pensado para "las más cercanas / lo que viene":
  //   0 = pendiente que se decide A FUTURO (lo próximo — arriba, de lo más pronto a lo más lejano)
  //   1 = pendiente ATRASADA (fecha estimada ya pasó sin resultado — la más reciente primero)
  //   2 = pendiente SIN fecha en la ficha
  //   3 = ya resuelta (ganada/perdida) — al final, la más reciente primero
  const pesoDecision = useCallback((n: Negocio, fecha: number | null): number => {
    // Resuelta = cualquier cosa que ya no está "en evaluación" (ganada/perdida, pero también
    // desierta/revocada/suspendida: no van a moverse, no tiene sentido tratarlas como pendientes).
    if (resultadoDeNegocio(n) !== 'evaluacion') return 3;
    if (fecha == null) return 2;
    return fecha >= dayjs().startOf('day').valueOf() ? 0 : 1;
  }, [resultadoDeNegocio]);

  const visibles = useMemo(() => {
    return base
      .filter(n => !resultadoSel || resultadoDeNegocio(n) === resultadoSel)
      .filter(n => estadosMpSel.length === 0
        || estadosMpSel.some(sel => sel === APERTURADAS ? !!n.aperturada : estadoMpDe(n) === sel))
      .sort((a, b) => {
        if (orden === 'adjudicacion') {
          // Fecha en que se DECIDE cada una (estimada de la ficha; si ya se adjudicó, la real).
          // Orden: primero las que aún no se deciden, de la más CERCANA a la más lejana; las
          // que ya se resolvieron o no traen fecha van al final.
          const fa = fechaDecisionDe(a), fb = fechaDecisionDe(b);
          const pa = pesoDecision(a, fa), pb = pesoDecision(b, fb);
          if (pa !== pb) return pa - pb;
          if (fa && fb && fa !== fb) {
            // Futuro (0): lo más pronto primero. Atrasadas (1) y resueltas (3): lo más reciente primero.
            return pa === 0 ? fa - fb : fb - fa;
          }
          return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
        }
        if (orden === 'cierre') return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
        if (orden === 'monto') return (b.monto_ofertado || b.licitacion_monto || 0) - (a.monto_ofertado || a.licitacion_monto || 0);
        const da = ORDEN[resultadoDeNegocio(a)] - ORDEN[resultadoDeNegocio(b)];
        if (da !== 0) return da;
        return dayjs(b.licitacion_cierre || 0).valueOf() - dayjs(a.licitacion_cierre || 0).valueOf();
      });
  }, [base, resultadoSel, resultadoDeNegocio, estadosMpSel, estadoMpDe, orden, adjMap]);

  // Al cambiar cualquier filtro se reinicia la carga incremental de tarjetas.
  useEffect(() => { setMaxVisibles(24); }, [busqueda, perfilesSel, empresasSel, estadosMpSel, resultadoSel, orden]);

  // KPIs.
  const stats = useMemo(() => {
    let montoGanado = 0;
    for (const n of base) {
      const a = adjMap[n.licitacion_codigo];
      if (a?.ganamos && a.montoNuestro) montoGanado += a.montoNuestro;
    }
    const resueltasTotal = conteo.ganada + conteo.perdida;
    return {
      total: base.length,
      ...conteo,
      montoGanado,
      exito: resueltasTotal ? Math.round((conteo.ganada / resueltasTotal) * 100) : null,
    };
  }, [base, conteo, adjMap]);

  // ── Exportar Excel ──────────────────────────────────────────────────────────
  // Exporta `visibles`: la MISMA vista de la pantalla (búsqueda + perfil + empresa + estado MP +
  // resultado, en el orden elegido), una fila por postulada. Trae todo lo que la página sabe de
  // cada licitación, incluida la APERTURA (detectada por el poller del portal, no por la API) y
  // el detalle del acta de adjudicación.
  const exportarExcel = async () => {
    if (exportando) return;
    if (visibles.length === 0) {
      toast.error('No hay postuladas para exportar', 'Ajusta o limpia los filtros e inténtalo de nuevo.');
      return;
    }
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      // Fecha (dd-mm-aaaa, fecha real de Excel) y hora SEPARADAS, para que Excel agrupe y ordene
      // por día — ver app/lib/exportar-fechas.ts. `fecha()` devuelve solo el día; `hora()` solo la hora.
      const fecha = (v: string | null | undefined) => fechaHoraParaExcel(v).fecha;
      const hora  = (v: string | null | undefined) => fechaHoraParaExcel(v).hora;
      const RESULTADO_LABEL: Record<Resultado, string> = {
        ganada: 'Ganada', perdida: 'Perdida', evaluacion: 'En evaluación',
        desierta: 'Desierta', revocada: 'Revocada', suspendida: 'Suspendida',
      };

      // Agrupadas por día de cierre (pedido del usuario 18-ago-2026). Se ordena ANTES de armar las
      // filas porque las fechas del Excel son fechas reales (no texto ordenable).
      const ordenadas = ordenarPorFecha(visibles,
        n => fechaHoraParaExcel(n.licitacion_cierre).iso, n => fechaHoraParaExcel(n.licitacion_cierre).hora);
      const filas = ordenadas.map(n => {
        const a = adjMap[n.licitacion_codigo];
        const lineas = a?.lineasAdjudicadas || [];
        const nuestras = lineas.filter(l => l.esNuestra);
        // Proveedores adjudicados, sin repetir (una licitación se adjudica por línea y el mismo
        // proveedor puede llevarse varias).
        const adjudicatarios = Array.from(new Set(lineas.map(l => l.proveedor).filter(Boolean))) as string[];
        const decision = fechaDecisionDe(n);
        return {
          'Código':             n.licitacion_codigo,
          'Nombre':             n.licitacion_nombre || '',
          'Organismo':          n.licitacion_organismo || '',
          'Tipo':               extractTipoFromCodigo(n.licitacion_codigo || '') || '',
          'Región':             n.licitacion_region || '',
          // Estado tal cual lo entrega MP (Publicada / Cerrada / Desierta / Adjudicada / Revocada…)
          'Estado MP':          estadoMpDe(n),
          'Resultado':          RESULTADO_LABEL[resultadoDeNegocio(n)],
          'Aperturada':         n.aperturada ? 'Sí' : 'No',
          'Apertura detectada (fecha)': fecha(n.apertura_detectada_en),
          'Apertura detectada (hora)': hora(n.apertura_detectada_en),
          'Apertura técnica (ficha)': fecha(a?.fechaAperturaTecnica),
          'Estado gestión':     getEstadoPipeline(n.estado_pipeline || '')?.label || n.estado_pipeline || '',
          'Postulada (fecha)':  fecha(n.postulada_en),
          'Postulada (hora)':   hora(n.postulada_en),
          'Cierre (fecha)': fecha(n.licitacion_cierre),
          'Cierre (hora)': hora(n.licitacion_cierre),
          // Cuándo se decide: la fecha real del acta si ya se adjudicó, si no la estimada de la ficha.
          'Se decide':          fecha(a?.esAdjudicada ? a?.fechaAdjudicacion : a?.fechaEstimadaAdjudicacion),
          'Fecha adjudicación': fecha(a?.fechaAdjudicacion),
          'Días para decidir':  decision != null && !a?.esAdjudicada ? dayjs(decision).diff(dayjs().startOf('day'), 'day') : '',
          'Presupuesto MP':     n.licitacion_monto ?? '',
          'Monto ofertado':     n.monto_ofertado ?? '',
          'Monto adjudicado a nosotros': a?.montoNuestro ?? '',
          'Monto adjudicado total':      a?.montoAdjudicadoTotal ?? '',
          'Líneas adjudicadas':          lineas.length || '',
          'Líneas ganadas por nosotros': nuestras.length || '',
          'Adjudicatarios':     adjudicatarios.join(', '),
          'N° oferentes':       a?.adjudicacion?.numeroOferentes ?? '',
          'N° resolución':      a?.adjudicacion?.numeroResolucion || '',
          'Empresa':            n.empresa_nombre || '',
          'Perfil':             n.usuario_nombre || n.usuario_email || '',
          'N° OC':              (a?.ocCodigos || []).join(', '),
          'Link OC':            (a?.ocCodigos || []).map(c => `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(c)}`).join(' | '),
          'Docs propios':       (docsPropiosMap[n.licitacion_codigo] || []).length || '',
          'URL acta':           a?.adjudicacion?.urlActa || '',
          'URL':                `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(n.licitacion_codigo)}`,
        };
      });

      const ws = hojaDeFilas(XLSX, filas);
      // Anchos en el MISMO orden que las claves de arriba.
      ws['!cols'] = [
        { wch: 18 }, { wch: 48 }, { wch: 30 }, { wch: 8 },  { wch: 22 },  // código…región
        { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 18 }, { wch: 20 },  // estado MP…apertura técnica
        { wch: 16 }, { wch: 18 }, { wch: 12 },                            // gestión, postulada (fecha/hora)
        { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 16 },                // cierre, fechas de decisión
        { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 22 },               // montos
        { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 18 },  // líneas, adjudicatarios
        { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 60 }, { wch: 12 }, { wch: 60 }, { wch: 60 },  // empresa, perfil, OC, docs, URLs
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Postuladas');
      XLSX.writeFile(wb, `postuladas-${dayjs().format('DD-MM-YYYY')}.xlsx`);
      toast.success(
        `Exportadas ${filas.length} postulada${filas.length !== 1 ? 's' : ''}`,
        'Se descargó el Excel con los filtros actuales.',
      );
    } catch (e) {
      console.error('[postuladas] exportar Excel falló:', e);
      toast.error('No se pudo exportar el Excel', String((e as any)?.message || e));
    } finally {
      setExportando(false);
    }
  };

  // Desierta/Revocada/Suspendida solo aparecen como tab cuando hay al menos una — no tiene
  // sentido mostrar un filtro vacío que nadie va a usar en un perfil/empresa donde nunca pasó.
  const TABS: { id: Resultado | ''; label: string; count: number; color: string }[] = [
    { id: '', label: 'Todas', count: base.length, color: '#334155' },
    { id: 'ganada', label: 'Ganadas', count: conteo.ganada, color: META.ganada.color },
    { id: 'evaluacion', label: 'En evaluación', count: conteo.evaluacion, color: META.evaluacion.color },
    { id: 'perdida', label: 'Perdidas', count: conteo.perdida, color: META.perdida.color },
    ...(conteo.suspendida > 0 ? [{ id: 'suspendida' as Resultado, label: 'Suspendidas', count: conteo.suspendida, color: META.suspendida.color }] : []),
    ...(conteo.desierta > 0 ? [{ id: 'desierta' as Resultado, label: 'Desiertas', count: conteo.desierta, color: META.desierta.color }] : []),
    ...(conteo.revocada > 0 ? [{ id: 'revocada' as Resultado, label: 'Revocadas', count: conteo.revocada, color: META.revocada.color }] : []),
  ];

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Postuladas' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Postuladas"
          descripcion={cargando
            ? 'Cargando…'
            : `${base.length} oferta${base.length !== 1 ? 's' : ''} presentada${base.length !== 1 ? 's' : ''}${!estadoCargado && base.length > 0 ? ' · resolviendo resultados…' : ''}`}
          acciones={
            <>
              <Boton onClick={exportarExcel} disabled={exportando || cargando || visibles.length === 0}
                title="Exportar a Excel las postuladas con los filtros actuales (incluye apertura y adjudicación)"
                icono={exportando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} stroke={1.75} />}>
                {exportando ? 'Exportando…' : 'Exportar'}
              </Boton>
              {/* Buscador por nombre / ID de licitación (acota pestañas, KPIs y lista). */}
              <div className="relative w-64 @2xl:w-80">
                <Search size={16} stroke={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o ID…"
                  aria-label="Buscar por nombre o ID de licitación"
                  className="h-9 w-full rounded-lg border border-linea bg-white pl-9 pr-8 text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {busqueda && (
                  <button onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" title="Limpiar búsqueda"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800">
                    <X size={14} stroke={1.75} />
                  </button>
                )}
              </div>
            </>
          }
        />

        {/* Resumen: torta con el reparto + indicadores clave */}
        {!cargando && estadoCargado && !error && base.length > 0 && (
          <div className="mb-6 grid gap-3 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <DonaResultados conteo={conteo} total={base.length} exito={stats.exito}
              elegido={resultadoSel} onElegir={setResultadoSel} />
            <Lista className="grid grid-cols-2 gap-3">
              <Indicador rotulo="Ganadas" valor={stats.ganada}
                detalle={stats.exito != null ? `${stats.exito} % de efectividad` : 'Resultados en curso'} />
              {/* "Adjudicadas a terceros" a propósito: Desierta/Revocada/Suspendida NO cuentan aquí. */}
              <Indicador rotulo="Perdidas" valor={stats.perdida} detalle="Adjudicadas a terceros" />
              <Indicador rotulo="En evaluación" valor={stats.evaluacion} detalle="Aún sin resultado" />
              <Indicador rotulo="Monto ganado" valor={stats.montoGanado || 0} formato={fmtCLP} detalle="Lo adjudicado a nosotros" />
            </Lista>
          </div>
        )}

        {/* Barra de control: tabs de resultado + filtros multi-select + orden (una sola tarjeta) */}
        {!cargando && !error && base.length + negocios.length > 0 && (
          <div className="mb-5 rounded-xl border border-linea bg-white p-3 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
            {/* Resultado: pestañas con contador */}
            {estadoCargado && (
              <div className="mb-3 overflow-x-auto">
                <Pestanas id="postuladas-resultado" valor={resultadoSel} onCambio={setResultadoSel}
                  opciones={TABS.map(t => ({ valor: t.id, etiqueta: t.label, contador: t.count }))} />
              </div>
            )}

            {/* Filtros y orden (el panel detallado se guarda) */}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-linea dark:border-slate-800">
              <Boton tamano="sm" onClick={() => setFiltrosOpen(v => !v)} aria-expanded={filtrosOpen}
                className={filtrosOpen ? 'border-marca/50 text-marca' : ''}
                icono={<SlidersHorizontal size={16} stroke={1.75} />}>
                Filtros
                {filtrosActivosCount > 0 && <span className="text-xs font-semibold tabular-nums text-marca">{filtrosActivosCount}</span>}
                <ChevronDown size={14} stroke={1.75} className={`transition-transform ${filtrosOpen ? 'rotate-180' : ''}`} />
              </Boton>
              {filtrosActivosCount > 0 && (
                <Boton tamano="sm" variante="fantasma" onClick={limpiarFiltros} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
              )}
              <div className="inline-flex items-center gap-2 ml-auto">
                <span className="inline-flex items-center gap-1 text-[11px] text-tinta-2 dark:text-slate-400">
                  <ArrowUpDown size={14} stroke={1.75} className="text-slate-400" /> Ordenar por
                </span>
                <Select value={orden} onChange={v => setOrden(v as typeof orden)}
                  options={[
                    { value: 'adjudicacion', label: 'Adjudicación más cercana' },
                    { value: 'resultado', label: 'Resultado' },
                    { value: 'cierre', label: 'Cierre reciente' },
                    { value: 'monto', label: 'Monto (mayor)' },
                  ]} />
              </div>
            </div>

            {/* Panel de filtros — colapsable, agrupado por QUIÉN / QUÉ / CUÁNDO-CUÁNTO */}
            {filtrosOpen && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                {(isAdmin && perfiles.length > 1) || empresasFiltro.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-tinta-2 w-full @xl:w-auto dark:text-slate-400">Quién</span>
                    {isAdmin && perfiles.length > 1 && (
                      <MultiSelect label="Perfil" icon={<Users size={13} />} selected={perfilesSel} onChange={setPerfilesSel}
                        options={perfiles.map(p => ({ value: p.email, label: p.nombre, color: colorUsuario(p.email), count: p.total }))} />
                    )}
                    {empresasFiltro.length > 1 && (
                      <MultiSelect label="Empresa" icon={<Building2 size={13} />} selected={empresasSel} onChange={setEmpresasSel} minWidth={260}
                        options={empresasFiltro.map(e => ({ value: e.id, label: e.nombre, count: e.total }))} />
                    )}
                  </div>
                ) : null}

                {(tiposFiltro.length > 1 || etiquetasFiltro.length > 1 || estadosMp.length > 1) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-tinta-2 w-full @xl:w-auto dark:text-slate-400">Qué</span>
                    {tiposFiltro.length > 1 && (
                      <MultiSelect label="Tipo" icon={<FileCheck2 size={13} />} selected={tiposSel} onChange={setTiposSel}
                        options={tiposFiltro.map(t => ({ value: t.codigo, label: `${t.codigo} · ${t.label}`, count: t.total }))} />
                    )}
                    {etiquetasFiltro.length > 1 && (
                      <MultiSelect label="Línea de negocio" icon={<Tag size={13} />} selected={etiquetasSel} onChange={setEtiquetasSel} minWidth={230}
                        options={etiquetasFiltro.map(e => ({ value: e.id, label: e.nombre, color: e.color, count: e.total }))} />
                    )}
                    {estadosMp.length > 1 && (
                      <MultiSelect label="Estado MP" icon={<FileText size={13} />} selected={estadosMpSel} onChange={setEstadosMpSel} minWidth={230}
                        options={estadosMp.map(e => ({
                          value: e.id, label: e.label, count: e.total,
                          color: e.id === APERTURADAS ? '#0284c7' : undefined,
                        }))} />
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-tinta-2 w-full @xl:w-auto dark:text-slate-400">Cuándo / cuánto</span>
                  <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5">
                    <Calendar size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-slate-500">Cierre</span>
                    <input type="date" value={cierreDesde} onChange={e => setCierreDesde(e.target.value)}
                      max={cierreHasta || undefined}
                      className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Cierre desde" />
                    <span className="text-slate-300">–</span>
                    <input type="date" value={cierreHasta} onChange={e => setCierreHasta(e.target.value)}
                      min={cierreDesde || undefined}
                      className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Cierre hasta" />
                    {(cierreDesde || cierreHasta) && (
                      <button onClick={() => { setCierreDesde(''); setCierreHasta(''); }}
                        title="Quitar rango de fecha" className="text-slate-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5">
                    <DollarSign size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-slate-500">Monto</span>
                    <input type="number" inputMode="numeric" value={montoMin} onChange={e => setMontoMin(e.target.value)}
                      placeholder="mín" className="text-[12px] text-slate-700 bg-transparent outline-none w-[90px] placeholder:text-slate-300" title="Monto mínimo" />
                    <span className="text-slate-300">–</span>
                    <input type="number" inputMode="numeric" value={montoMax} onChange={e => setMontoMax(e.target.value)}
                      placeholder="máx" className="text-[12px] text-slate-700 bg-transparent outline-none w-[90px] placeholder:text-slate-300" title="Monto máximo" />
                    {(montoMin || montoMax) && (
                      <button onClick={() => { setMontoMin(''); setMontoMax(''); }}
                        title="Quitar rango de monto" className="text-slate-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Filtros activos: se quitan con un clic */}
            {filtrosActivosCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-linea dark:border-slate-800">
                <span className="text-xs text-tinta-2 dark:text-slate-400">Filtrando por</span>
                {busqueda && (
                  <button onClick={() => setBusqueda('')} className={CHIP_FILTRO}>
                    <Search size={12} stroke={1.75} className="text-slate-400" /> “{busqueda}” <X size={12} stroke={1.75} className="text-slate-400" />
                  </button>
                )}
                {perfilesSel.map(p => {
                  const per = perfiles.find(x => x.email === p);
                  return (
                    <button key={p} onClick={() => setPerfilesSel(a => a.filter(x => x !== p))} className={CHIP_FILTRO}>
                      <span aria-hidden style={{ backgroundColor: colorUsuario(p) }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                      {per?.nombre || p} <X size={12} stroke={1.75} className="text-slate-400" />
                    </button>
                  );
                })}
                {empresasSel.map(id => (
                  <button key={id} onClick={() => setEmpresasSel(a => a.filter(x => x !== id))} className={`${CHIP_FILTRO} max-w-[220px]`}>
                    <span className="truncate">{empresasFiltro.find(e => e.id === id)?.nombre || `Empresa ${id}`}</span> <X size={12} stroke={1.75} className="flex-shrink-0 text-slate-400" />
                  </button>
                ))}
                {tiposSel.map(t => (
                  <button key={t} onClick={() => setTiposSel(a => a.filter(x => x !== t))} className={CHIP_FILTRO}>
                    {t} <X size={12} stroke={1.75} className="text-slate-400" />
                  </button>
                ))}
                {etiquetasSel.map(id => {
                  const et = etiquetasFiltro.find(x => x.id === id);
                  return (
                    <button key={id} onClick={() => setEtiquetasSel(a => a.filter(x => x !== id))} className={CHIP_FILTRO}>
                      <span aria-hidden style={{ backgroundColor: et?.color || '#0f766e' }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                      {et?.nombre || id} <X size={12} stroke={1.75} className="text-slate-400" />
                    </button>
                  );
                })}
                {estadosMpSel.map(id => (
                  <button key={id} onClick={() => setEstadosMpSel(a => a.filter(x => x !== id))} className={CHIP_FILTRO}>
                    {id === APERTURADAS ? 'Aperturadas' : id} <X size={12} stroke={1.75} className="text-slate-400" />
                  </button>
                ))}
                {(cierreDesde || cierreHasta) && (
                  <button onClick={() => { setCierreDesde(''); setCierreHasta(''); }} className={CHIP_FILTRO}>
                    Cierre {cierreDesde || '…'} – {cierreHasta || '…'} <X size={12} stroke={1.75} className="text-slate-400" />
                  </button>
                )}
                {(montoMin || montoMax) && (
                  <button onClick={() => { setMontoMin(''); setMontoMax(''); }} className={CHIP_FILTRO}>
                    Monto {montoMin ? fmtCLP(Number(montoMin)) : '…'} – {montoMax ? fmtCLP(Number(montoMax)) : '…'} <X size={12} stroke={1.75} className="text-slate-400" />
                  </button>
                )}
                <button onClick={limpiarFiltros}
                  className="ml-1 text-xs font-medium text-tinta-2 underline hover:text-urgente dark:text-slate-400">
                  Limpiar todo
                </button>
              </div>
            )}
          </div>
        )}

        {cargando ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <TarjetaCargando key={i} />)}</div>
        ) : error ? (
          <Banner variante="error">{error}</Banner>
        ) : visibles.length === 0 ? (
          <Vacio icono={<Inbox size={32} stroke={1.5} />}
            titulo={negocios.length === 0 ? 'Todavía no hay licitaciones postuladas' : 'Nada en este filtro'}
            texto={negocios.length === 0
              ? 'Cuando marques una licitación como Postulada en su estado, aparecerá aquí.'
              : busqueda ? 'Prueba con otro nombre o ID de licitación.' : 'Prueba con otro resultado, perfil o empresa.'}
            accion={filtrosActivosCount > 0 ? <Boton tamano="sm" onClick={limpiarFiltros}>Limpiar filtros</Boton> : undefined} />
        ) : (
          <>
            <Lista className="flex flex-col gap-2">
              {visibles.slice(0, maxVisibles).map(n => (
                <PostuladaCard key={n.id} n={n}
                  adj={adjMap[n.licitacion_codigo] ?? null}
                  cargandoAdj={!estadoCargado}
                  docsIniciales={docsPropiosMap[n.licitacion_codigo] || []}
                  isAdmin={!!isAdmin} empresas={empresasOpc}
                  onRevertida={id => setNegocios(prev => prev.filter(x => x.id !== id))}
                  onActualizada={(id, patch) => setNegocios(prev =>
                    patch.estado_pipeline && patch.estado_pipeline !== ESTADO_POSTULADA
                      ? prev.filter(x => x.id !== id)
                      : prev.map(x => x.id === id ? { ...x, ...patch } : x)
                  )}
                />
              ))}
            </Lista>
            {visibles.length > maxVisibles && (
              <div className="flex justify-center mt-5">
                <Boton onClick={() => setMaxVisibles(m => m + 24)} icono={<ChevronDown size={16} stroke={1.75} />}>
                  Mostrar más ({visibles.length - maxVisibles} restantes)
                </Boton>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
