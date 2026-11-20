'use client';

// Apartado "Adjudicadas" — el RESULTADO ya resuelto de las postuladas.
//
// Cuando MP publica el resultado, el cron auto-promueve la postulada a ADJUDICADA (ganamos
// ≥1 línea con una de nuestras empresas) o PERDIDA (se adjudicó a terceros). Aquí viven esas
// licitaciones ya cerradas, con dos pestañas: Ganadas | Perdidas. Los datos de adjudicación
// (líneas, acta, montos) se traen de MP vía /api/licitacion-adjudicacion (cache final).
//
// Roles: cada perfil ve SOLO lo suyo; el admin ve todo y filtra por perfil/empresa. El
// filtrado por rol lo hace /api/negocios.
//
// UI: dos vistas conmutables (LISTA por defecto — filas expandibles con el detalle de la
// adjudicación — y TARJETAS), buscador de texto, filtros multi-select (perfil/empresa),
// orden configurable y paginación en el cliente.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { normalizarEstado } from '@/app/lib/pipeline';
import { useRealtime } from '@/app/lib/use-realtime';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { motion } from 'framer-motion';
import { item } from '@/app/components/ui/kit/movimiento';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Tarjeta, Datos, Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Dona } from '@/app/components/ui/kit/Dona';
import { Encabezado, Esqueleto, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { IconTrophy as Trophy, IconCircleX as XCircle, IconExternalLink as ExternalLink, IconBuilding as Building2, IconInbox as Inbox, IconUsers as Users, IconFileCheck as FileCheck2, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconSearch as Search, IconX as X, IconArrowsUpDown as ArrowUpDown, IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight, IconDownload as Download, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';
import { ChipsOc } from '@/app/components/OcChips';
import { getEstadoPipeline } from '@/app/lib/pipeline';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';
import { fechaHoraParaExcel, hojaDeFilas } from '@/app/lib/exportar-fechas';
import dayjs from 'dayjs';

type Resultado = 'ganada' | 'perdida';
type Vista = 'lista' | 'tarjetas';
type Orden = 'recientes' | 'antiguas' | 'monto_ganado' | 'presupuesto' | 'nombre';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  estado_pipeline: string | null;
  monto_ofertado?: number;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  usuario_nombre?: string;
  usuario_email?: string;
  licitacion_estado?: string | null;
  licitacion_region?: string | null;
  created_at?: string | null;
  postulada_en?: string | null;
  aperturada?: number;
  apertura_detectada_en?: string | null;
}
interface LineaAdjudicada {
  correlativo?: number; producto?: string; descripcion?: string; cantidad?: number;
  montoUnitario: number | null; rutProveedor: string | null; proveedor: string | null; esNuestra?: boolean;
}
interface Adjudicacion {
  esAdjudicada: boolean; estado?: string | null; fechaAdjudicacion?: string | null; fechaOcLlegada?: string | null; fechaOcAceptada?: string | null; ocCodigos?: string[]; ganamos?: boolean; montoNuestro?: number | null;
  adjudicacion?: { numeroResolucion?: string | null; numeroOferentes?: number | null; urlActa?: string | null } | null;
  lineasAdjudicadas?: LineaAdjudicada[]; montoAdjudicadoTotal?: number | null;
}

function fmtCLP(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}
// Fecha defensiva: zero-dates de MySQL o basura no deben pintar "Invalid Date".
// Formato de la casa: «12 nov» (año solo si no es el actual: «12 nov 2025»).
function fmtFecha(s: string | null | undefined) {
  if (!s) return '—';
  const d = dayjs(s);
  if (!d.isValid()) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', ...(d.year() === dayjs().year() ? {} : { year: 'numeric' }) })
    .format(d.toDate()).replace('.', '');
}
// Ficha pública de la OC en Mercado Público — solo para la columna «Link OC» del Excel (en pantalla la OC se ve en el visor).
const urlOc = (codigo: string) => `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(codigo)}`;

const tsDe = (s: string | null | undefined) => { const d = dayjs(s ?? ''); return d.isValid() ? d.valueOf() : 0; };

const META: Record<Resultado, { label: string; short: string; color: string; icon: typeof Trophy }> = {
  ganada:  { label: 'Ganada',  short: 'Ganadas',  color: '#059669', icon: Trophy },
  perdida: { label: 'Perdida', short: 'Perdidas', color: '#dc2626', icon: XCircle },
};

// Serie de colores para las empresas (paleta licitank-ui, sin índigo/violeta). El verde va al final para
// no confundirse con «ganada».
const SERIE_EMPRESAS = ['#0d9488', '#475569', '#d97706', '#0891b2', '#ea580c', '#db2777', '#78716c', '#16a34a'];
const SIN_EMPRESA = '__sin_empresa';
const OTROS = '__otros';

// Clave de un proveedor adjudicado: RUT sin puntos ni espacios; si MP no trae RUT, el nombre en mayúsculas.
function claveProveedor(l: LineaAdjudicada): string {
  const rut = (l.rutProveedor || '').replace(/[.\s]/g, '').toUpperCase();
  return rut || (l.proveedor || '').trim().toUpperCase();
}

// Montos grandes en bloques: «$551,5 MM»; bajo un millón, el monto completo.
function fmtMM(n: number) {
  if (Math.abs(n) < 1_000_000) return fmtCLP(n);
  return `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MM`;
}

const OPCIONES_ORDEN:{ value: Orden; label: string }[] = [
  { value: 'recientes', label: 'Más recientes' },
  { value: 'antiguas', label: 'Más antiguas' },
  { value: 'monto_ganado', label: 'Monto del resultado' },
  { value: 'presupuesto', label: 'Presupuesto' },
  { value: 'nombre', label: 'Nombre A-Z' },
];

// Resultado real: si el cache de MP trae el dato COMPLETO (esAdjudicada + ganamos calculado),
// manda ese. Si viene parcial o aún no cargó, cae al estado ya promovido por el cron.
function resultadoDe(n: Negocio, adj?: Adjudicacion | null): Resultado {
  if (adj?.esAdjudicada && typeof adj.ganamos === 'boolean') return adj.ganamos ? 'ganada' : 'perdida';
  return normalizarEstado(n.estado_pipeline) === 'PERDIDA' ? 'perdida' : 'ganada';
}

// Monto que mostramos como "resultado": lo ganado por nosotros o el total adjudicado a terceros.
function montoResultado(n: Negocio, adj: Adjudicacion | null, r: Resultado): number | null {
  if (r === 'ganada') return adj?.montoNuestro ?? n.monto_ofertado ?? null;
  return adj?.montoAdjudicadoTotal ?? null;
}

// ── Detalle de adjudicación (líneas + acta) ───────────────────────────────────
// Va separado con border-t dentro de la tarjeta/fila: nada de caja teñida dentro de otra caja.
function BloqueAdjudicacion({ adj, ganamos, defaultAbierto = false }: { adj: Adjudicacion; ganamos: boolean; defaultAbierto?: boolean }) {
  const [abierto, setAbierto] = useState(defaultAbierto);
  const meta = adj.adjudicacion;
  const lineas = adj.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const acc = ganamos ? META.ganada : META.perdida;
  return (
    <div className="mt-3 pt-3 border-t border-linea dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-2 dark:text-slate-400">
        <span className="font-medium text-tinta dark:text-slate-100">
          <Estado color={acc.color}>
            {ganamos ? (nuestras > 0 ? `Ganamos ${nuestras} de ${lineas.length} línea${lineas.length !== 1 ? 's' : ''}` : 'Ganada') : 'Adjudicada a terceros'}
          </Estado>
        </span>
        {adj.fechaAdjudicacion && <span>Adjudicada el {fmtFecha(adj.fechaAdjudicacion)}</span>}
        {meta?.numeroOferentes != null && <span>{meta.numeroOferentes} oferente{meta.numeroOferentes !== 1 ? 's' : ''}</span>}
        {meta?.numeroResolucion && <span>Res. N° {meta.numeroResolucion}</span>}
        {meta?.urlActa && (
          <a href={meta.urlActa} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-medium text-marca hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 rounded">
            <FileCheck2 size={14} stroke={1.75} /> Ver acta <ExternalLink size={12} stroke={1.75} />
          </a>
        )}
      </div>

      {lineas.length > 0 && (
        <>
          <button type="button" onClick={e => { e.stopPropagation(); setAbierto(o => !o); }} aria-expanded={abierto}
            className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-tinta-2 hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:text-slate-400 dark:hover:text-slate-200">
            {abierto ? <ChevronUp size={14} stroke={1.75} /> : <ChevronDown size={14} stroke={1.75} />}
            {abierto ? 'Ocultar' : 'Ver'} adjudicación por línea
            <span className="font-semibold tabular-nums">{lineas.length}</span>
          </button>
          <div className="colapsable" data-abierto={abierto ? '1' : '0'}>
            <div className="colapsable-inner">
              <ul className="mt-1.5 divide-y divide-linea dark:divide-slate-800">
                {lineas.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[13px] text-tinta truncate dark:text-slate-100" title={l.producto || l.descripcion}>
                        {l.producto || l.descripcion || `Línea ${l.correlativo ?? i + 1}`}
                      </p>
                      <p className="mt-0.5 text-xs text-tinta-2 truncate dark:text-slate-400" title={`${l.proveedor || ''} ${l.rutProveedor || ''}`}>
                        {l.esNuestra
                          ? <span className="font-medium text-exito"><Estado color={META.ganada.color}>Nosotros</Estado></span>
                          : null}
                        {l.esNuestra ? ' · ' : ''}{l.proveedor || 'Proveedor adjudicado'}{l.rutProveedor ? ` · ${l.rutProveedor}` : ''}
                      </p>
                    </div>
                    <span className="text-[13px] font-semibold tabular-nums text-tinta whitespace-nowrap dark:text-slate-100">{fmtCLP(l.montoUnitario)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Avatar del perfil (solo el admin lo ve). Con `soloAvatar` muestra las iniciales y el nombre va en el tooltip.
function ChipPerfil({ n, soloAvatar = false }: { n: Negocio; soloAvatar?: boolean }) {
  if (!n.usuario_nombre && !n.usuario_email) return null;
  const col = colorUsuario(n.usuario_email || n.usuario_nombre || '');
  const nombre = n.usuario_nombre || n.usuario_email;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tinta-2 min-w-0 dark:text-slate-400" title={soloAvatar ? nombre : n.usuario_email}>
      <span style={{ background: col }} aria-hidden
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-semibold flex-shrink-0">
        {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
      </span>
      {soloAvatar ? <span className="sr-only">{nombre}</span> : <span className="truncate">{nombre}</span>}
    </span>
  );
}

// Enlace solo-ícono a la ficha de la licitación.
function VerLicitacion({ codigo }: { codigo: string }) {
  return (
    <Link href={`/licitacion/${encodeURIComponent(codigo)}`}
      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      title="Ver licitación" aria-label={`Ver licitación ${codigo}`}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-tinta transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800 dark:hover:text-slate-100">
      <ExternalLink size={16} stroke={1.75} />
    </Link>
  );
}

// ── Vista TARJETA ─────────────────────────────────────────────────────────────
function Card({ n, adj, cargandoAdj, isAdmin }: { n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; isAdmin: boolean }) {
  const r = resultadoDe(n, adj);
  const m = META[r];
  const monto = montoResultado(n, adj, r);

  return (
    <Tarjeta layout>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono text-tinta-2 dark:text-slate-400">{n.licitacion_codigo}</span>
            <span className="font-medium text-tinta dark:text-slate-100"><Estado color={m.color}>{m.label}</Estado></span>
            {r === 'ganada' && <ChipsOc codigos={adj?.ocCodigos} />}
            {isAdmin && <ChipPerfil n={n} />}
          </div>
          <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-tinta line-clamp-2 dark:text-slate-50" title={n.licitacion_nombre}>
            {n.licitacion_nombre || 'Sin nombre'}
          </h3>
          <p className="mt-1 text-xs text-tinta-2 truncate dark:text-slate-400">
            {[n.licitacion_organismo, n.empresa_nombre].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <VerLicitacion codigo={n.licitacion_codigo} />
      </div>

      <Datos columnas={3}>
        <Dato rotulo="Presupuesto real">{fmtCLP(n.licitacion_monto)}</Dato>
        <Dato rotulo="Postulamos con">{fmtCLP(n.monto_ofertado)}</Dato>
        <Dato rotulo={r === 'ganada' ? 'Ganamos' : 'Adjudicado (total)'}>{cargandoAdj ? '…' : fmtCLP(monto)}</Dato>
      </Datos>

      {adj?.esAdjudicada
        ? <BloqueAdjudicacion adj={adj} ganamos={r === 'ganada'} />
        : !cargandoAdj && (
            <p className="mt-3 pt-3 border-t border-linea text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
              Sin detalle de adjudicación en Mercado Público
            </p>
          )}
    </Tarjeta>
  );
}

// ── Vista LISTA (fila expandible) ─────────────────────────────────────────────
// Columnas por ancho del PANEL (@container), no de la pantalla: en un notebook de 1366 px con el menú
// al contenido le quedan ~1060 px, así que la tabla se arma desde @5xl (1024 px). Las fechas de la OC
// van bajo su número (antes eran 2 columnas más y no cabían). Templates completos: Tailwind los extrae
// estáticamente; para no-admin la columna Perfil no existe.
const GRID_ADMIN = '@5xl:grid-cols-[minmax(0,1fr)_28px_140px_120px_88px_168px_80px_64px]';
const GRID_USER  = '@5xl:grid-cols-[minmax(0,1fr)_140px_120px_88px_168px_80px_64px]';

function Fila({ n, adj, cargandoAdj, isAdmin }: { n: Negocio; adj: Adjudicacion | null; cargandoAdj: boolean; isAdmin: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const r = resultadoDe(n, adj);
  const m = META[r];
  const monto = montoResultado(n, adj, r);
  const lineas = adj?.lineasAdjudicadas || [];
  const nuestras = lineas.filter(l => l.esNuestra).length;
  const expandible = !!adj?.esAdjudicada;
  const fechaAdj = adj?.esAdjudicada && adj.fechaAdjudicacion ? fmtFecha(adj.fechaAdjudicacion) : '—';
  const fechasOc = [
    adj?.fechaOcLlegada ? `llegó ${fmtFecha(adj.fechaOcLlegada)}` : '',
    adj?.fechaOcAceptada ? `aceptada ${fmtFecha(adj.fechaOcAceptada)}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <motion.div variants={item} layout="position"
      className={`rounded-xl border border-linea bg-white shadow-tarjeta transition-shadow duration-150 ease-lk dark:border-slate-800 dark:bg-slate-900 ${expandible ? 'hover:shadow-tarjeta-hover' : ''}`}>
      <div
        role={expandible ? 'button' : undefined}
        tabIndex={expandible ? 0 : undefined}
        aria-expanded={expandible ? abierta : undefined}
        aria-label={expandible ? `Detalle de ${n.licitacion_codigo}` : undefined}
        onClick={() => expandible && setAbierta(o => !o)}
        onKeyDown={e => {
          // Solo cuando el evento nace en la FILA: si viene de un link/botón interno
          // (p.ej. Enter sobre "Ver"), se respeta la acción del elemento.
          if (e.target !== e.currentTarget) return;
          if (expandible && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAbierta(o => !o); }
        }}
        className={`grid grid-cols-[1fr_auto] ${isAdmin ? GRID_ADMIN : GRID_USER} items-center gap-x-3 gap-y-1.5 rounded-xl px-4 py-3
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${expandible ? 'cursor-pointer' : ''}`}>

        {/* Código + resultado + nombre + organismo */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono text-tinta-2 dark:text-slate-400">{n.licitacion_codigo}</span>
            <span className="font-medium text-tinta dark:text-slate-100"><Estado color={m.color}>{m.label}</Estado></span>
            {r === 'ganada' && nuestras > 0 && (
              <span className="text-tinta-2 dark:text-slate-400">
                <span className="font-semibold tabular-nums">{nuestras}</span> de {lineas.length} línea{lineas.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] font-semibold text-tinta truncate dark:text-slate-50" title={n.licitacion_nombre}>{n.licitacion_nombre || 'Sin nombre'}</p>
          <p className="text-xs text-tinta-2 truncate dark:text-slate-400">{n.licitacion_organismo || '—'}</p>
        </div>

        {/* Perfil (solo admin) */}
        {isAdmin && <div className="hidden @5xl:block"><ChipPerfil n={n} soloAvatar /></div>}

        {/* Empresa */}
        <div className="hidden @5xl:block min-w-0 text-[13px] text-tinta truncate dark:text-slate-200" title={n.empresa_nombre || undefined}>
          {n.empresa_nombre || <span className="text-tinta-3">—</span>}
        </div>

        {/* Monto del resultado (dice de quién es: en las perdidas es plata de terceros) */}
        <div className="hidden @5xl:block text-right">
          <p className="text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-50">{cargandoAdj ? '…' : fmtCLP(monto)}</p>
          <p className="text-[11px] text-tinta-2 dark:text-slate-400">{r === 'ganada' ? 'ganamos' : 'a terceros'}</p>
        </div>

        {/* Fecha de adjudicación (la que ordena la lista) */}
        <div className={`hidden @5xl:block text-right text-[13px] tabular-nums ${fechaAdj === '—' ? 'text-tinta-3' : 'text-tinta dark:text-slate-200'}`}>{fechaAdj}</div>

        {/* OC: número (abre el PDF) y, debajo, cuándo llegó y cuándo se aceptó */}
        <div className="hidden @5xl:flex flex-col items-end gap-0.5 min-w-0">
          {r === 'ganada' && adj?.ocCodigos?.length
            ? <ChipsOc codigos={adj.ocCodigos} />
            : <span className="text-[13px] text-tinta-3">—</span>}
          {fechasOc && <span className="text-[11px] text-tinta-2 tabular-nums truncate max-w-full dark:text-slate-400" title={fechasOc}>{fechasOc}</span>}
        </div>

        {/* Cierre */}
        <div className="hidden @5xl:block text-right text-[13px] tabular-nums text-tinta-2 dark:text-slate-400">{fmtFecha(n.licitacion_cierre)}</div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-0.5 row-start-1 col-start-2 @5xl:row-auto @5xl:col-auto">
          <VerLicitacion codigo={n.licitacion_codigo} />
          {expandible && (
            <span aria-hidden className="inline-flex items-center justify-center w-6 h-8 text-slate-400">
              <ChevronDown size={16} stroke={1.75} className={`transition-transform duration-150 ${abierta ? 'rotate-180' : ''}`} />
            </span>
          )}
        </div>

        {/* Resumen compacto cuando el panel es angosto: cada dato con su rótulo */}
        <div className="@5xl:hidden col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-2 dark:text-slate-400">
          {isAdmin && <ChipPerfil n={n} />}
          {n.empresa_nombre && <span className="truncate max-w-[220px]">{n.empresa_nombre}</span>}
          <span>
            {r === 'ganada' ? 'Ganamos ' : 'Adjudicado '}
            <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{cargandoAdj ? '…' : fmtCLP(monto)}</span>
          </span>
          {fechaAdj !== '—' && <span>Adjudicada {fechaAdj}</span>}
          {r === 'ganada' && <ChipsOc codigos={adj?.ocCodigos} />}
          {fechasOc && <span>OC {fechasOc}</span>}
          {n.licitacion_cierre && <span>Cierre {fmtFecha(n.licitacion_cierre)}</span>}
        </div>
      </div>

      {/* Detalle expandido — con transición de altura (grid 0fr→1fr) */}
      {expandible && (
        <div className="colapsable" data-abierto={abierta ? '1' : '0'}>
          <div className="colapsable-inner">
            <div className="px-4 pb-3.5 border-t border-linea dark:border-slate-800">
              <dl className="mt-3 grid grid-cols-3 gap-x-4 max-w-xl">
                <Dato rotulo="Presupuesto real">{fmtCLP(n.licitacion_monto)}</Dato>
                <Dato rotulo="Postulamos con">{fmtCLP(n.monto_ofertado)}</Dato>
                <Dato rotulo={r === 'ganada' ? 'Ganamos' : 'Adjudicado (total)'}>{fmtCLP(monto)}</Dato>
              </dl>
              {adj?.esAdjudicada && <BloqueAdjudicacion adj={adj} ganamos={r === 'ganada'} defaultAbierto />}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Por empresa propia ────────────────────────────────────────────────────────
// Responde «¿con cuál de nuestras empresas ganamos y con cuál perdimos?». Dos tortas (ganadas y perdidas, cada
// una con su total al centro y la leyenda con cantidad y %) y la efectividad de cada empresa (ganadas sobre sus
// resueltas). Tocar una empresa en cualquiera de los tres bloques filtra toda la pantalla; volver a tocarla lo quita.
type FilaEmpresa = { clave: string; etiqueta: string; ganadas: number; perdidas: number; monto: number; color: string };

function PorEmpresa({ filas, elegida, onElegir }: { filas: FilaEmpresa[]; elegida: string; onElegir: (clave: string) => void }) {
  const totG = filas.reduce((s, f) => s + f.ganadas, 0);
  const totP = filas.reduce((s, f) => s + f.perdidas, 0);
  const nombreElegida = filas.find(f => f.clave === elegida)?.etiqueta;
  const tarjeta = 'rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900';
  const torta = (titulo: string, texto: string, campo: 'ganadas' | 'perdidas', total: number) => (
    <div className={tarjeta}>
      <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">{titulo}</h3>
      <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">{texto}</p>
      {total > 0 ? (
        <Dona tajadas={filas.map(f => ({ clave: f.clave, etiqueta: f.etiqueta, valor: f[campo], color: f.color }))}
          centroValor={String(total)} centroTexto={campo} elegido={elegida} onElegir={onElegir}
          descripcion={`${total} ${campo} repartidas por empresa: ${filas.filter(f => f[campo] > 0).map(f => `${f.etiqueta} ${f[campo]}`).join(', ')}`} />
      ) : (
        <p className="py-6 text-center text-[13px] text-tinta-2 dark:text-slate-400">No hay {campo} con estos filtros.</p>
      )}
    </div>
  );

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Por empresa</h2>
        {nombreElegida && (
          <Boton tamano="sm" variante="secundario" onClick={() => onElegir('')} icono={<X size={16} stroke={1.75} />}
            aria-label={`Quitar el filtro por ${nombreElegida}`}>
            Viendo solo {nombreElegida}
          </Boton>
        )}
      </div>
      <div className="grid gap-3 @4xl:grid-cols-2">
        {torta('Ganadas por empresa', 'Con cuál de nuestras empresas ganamos.', 'ganadas', totG)}
        {torta('Perdidas por empresa', 'Con cuál de nuestras empresas perdimos (adjudicadas a terceros).', 'perdidas', totP)}
      </div>
      <div className={`${tarjeta} mt-3`}>
          <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">¿Qué tan seguido gana cada empresa?</h3>
          <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">
            Efectividad = ganadas ÷ (ganadas + perdidas). Solo cuentan las licitaciones que ya tienen resultado en Mercado Público.
          </p>
          <ul className="grid gap-x-4 gap-y-2 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {filas.map(f => {
              const resueltas = f.ganadas + f.perdidas;
              const pct = resueltas ? Math.round((f.ganadas / resueltas) * 100) : 0;
              const pctG = resueltas ? (f.ganadas / resueltas) * 100 : 0;
              const filtrable = f.clave !== SIN_EMPRESA;
              const activa = elegida === f.clave;
              const atenuada = !!elegida && !activa;
              const contenido = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 pt-0.5 text-[13px] font-medium text-tinta dark:text-slate-100">
                      <span aria-hidden style={{ backgroundColor: f.color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
                      <span className="truncate" title={f.etiqueta}>{f.etiqueta}</span>
                    </span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block text-[22px] font-semibold leading-none tracking-tight tabular-nums text-tinta dark:text-slate-50">{pct} %</span>
                      <span className="mt-1 block text-[11px] text-tinta-2 dark:text-slate-400">de efectividad</span>
                    </span>
                  </div>
                  {/* Barra partida: verde lo ganado, rojo lo perdido (mismos colores que arriba). */}
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img"
                    aria-label={`${f.ganadas} ganadas y ${f.perdidas} perdidas`}>
                    <div className="h-full transition-[width] duration-300 ease-lk" style={{ width: `${pctG}%`, backgroundColor: META.ganada.color }} />
                    <div className="h-full transition-[width] duration-300 ease-lk" style={{ width: `${100 - pctG}%`, backgroundColor: META.perdida.color }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-xs tabular-nums text-tinta-2 dark:text-slate-400">
                    <Estado color={META.ganada.color}><span><span className="font-semibold text-tinta dark:text-slate-100">{f.ganadas}</span> ganadas</span></Estado>
                    <Estado color={META.perdida.color}><span><span className="font-semibold text-tinta dark:text-slate-100">{f.perdidas}</span> perdidas</span></Estado>
                  </div>
                  <p className="mt-1.5 text-xs text-tinta-2 dark:text-slate-400">
                    {resueltas} con resultado{f.monto > 0 ? <> · ganó <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtCLP(f.monto)}</span></> : ''}
                  </p>
                </>
              );
              const base = `block w-full rounded-lg px-2 py-2 text-left transition-[background-color,opacity] duration-150 ${activa ? 'bg-slate-50 dark:bg-slate-800' : ''} ${atenuada ? 'opacity-40' : ''}`;
              return (
                <li key={f.clave}>
                  {filtrable ? (
                    <button type="button" onClick={() => onElegir(activa ? '' : f.clave)} aria-pressed={activa}
                      title={activa ? 'Quitar filtro' : `Ver solo ${f.etiqueta}`}
                      className={`${base} hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800`}>
                      {contenido}
                    </button>
                  ) : (
                    <div className={base} title="Negocios sin empresa asignada: no se pueden filtrar">{contenido}</div>
                  )}
                </li>
              );
            })}
          </ul>
      </div>
    </section>
  );
}

// ── ¿A quién le perdimos? ─────────────────────────────────────────────────────
// Torta: cómo se reparte la plata de nuestras perdidas entre los competidores (las 6 que más se llevaron + «Otros»;
// es un reparto exacto: suma el total adjudicado a terceros). Lista: quién nos ganó más veces (licitaciones donde
// se adjudicó al menos una línea). Tocar un competidor en cualquiera de los dos filtra la pantalla a esas perdidas.
type LicitacionPerdida = { codigo: string; nombre: string; empresa: string | null; fecha: string | null; lineas: number; lineasTotal: number; monto: number };
type Competidor = { clave: string; nombre: string; rut: string | null; licitaciones: number; monto: number; detalle: LicitacionPerdida[] };
const SERIE_COMPETIDORES = ['#0d9488', '#475569', '#d97706', '#0891b2', '#ea580c', '#db2777'];

// Una fila del ranking: al abrirla muestra contra qué empresa nuestra ganó ese competidor y en qué licitaciones
// (con cuántas líneas y cuánto se llevó en cada una). El botón del pie filtra la lista de la pantalla a esas perdidas.
function FilaCompetidor({ c, color, elegido, onElegir }: {
  c: Competidor; color: string; elegido: string; onElegir: (clave: string) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const activo = elegido === c.clave;
  const porEmpresa = [...c.detalle.reduce((m, d) => m.set(d.empresa || 'Sin empresa', (m.get(d.empresa || 'Sin empresa') || 0) + 1), new Map<string, number>())]
    .sort((x, y) => y[1] - x[1]);
  return (
    <li className={`transition-opacity duration-150 ${elegido && !activo ? 'opacity-40' : ''}`}>
      <button type="button" onClick={() => setAbierta(v => !v)} aria-expanded={abierta}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800
          ${activo || abierta ? 'bg-slate-50 dark:bg-slate-800' : ''}`}>
        <span aria-hidden style={{ backgroundColor: color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-tinta dark:text-slate-100" title={c.nombre}>{c.nombre}</span>
          {c.rut && <span className="block text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">RUT {c.rut}</span>}
        </span>
        <span className="flex-shrink-0 text-right">
          <span className="block text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-50">
            {c.licitaciones} {c.licitaciones !== 1 ? 'licitaciones' : 'licitación'}
          </span>
          <span className="block text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">se llevó {fmtMM(c.monto)}</span>
        </span>
        <ChevronDown size={16} stroke={1.75} aria-hidden className={`flex-shrink-0 text-slate-400 transition-transform duration-150 ${abierta ? 'rotate-180' : ''}`} />
      </button>

      <div className="colapsable" data-abierto={abierta ? '1' : '0'}>
        <div className="colapsable-inner">
          <div className="px-2 pb-3 pt-1">
            {/* Contra cuál de nuestras empresas */}
            <p className="text-[11px] text-tinta-2 dark:text-slate-400">Nos ganó cuando postulamos con</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-tinta dark:text-slate-100">
              {porEmpresa.map(([emp, n]) => (
                <span key={emp}>{emp} <span className="font-semibold tabular-nums">{n}</span></span>
              ))}
            </div>

            {/* En qué licitaciones */}
            <p className="mt-3 text-[11px] text-tinta-2 dark:text-slate-400">En estas licitaciones</p>
            <ul className="mt-1 divide-y divide-linea dark:divide-slate-800">
              {c.detalle.map(d => (
                <li key={d.codigo} className="flex items-start justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <Link href={`/licitacion/${encodeURIComponent(d.codigo)}`}
                      className="block truncate text-[13px] font-medium text-tinta hover:text-marca hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 rounded dark:text-slate-100"
                      title={d.nombre}>
                      {d.nombre}
                    </Link>
                    <p className="text-xs text-tinta-2 truncate dark:text-slate-400">
                      <span className="font-mono">{d.codigo}</span>
                      {d.empresa ? ` · postulamos con ${d.empresa}` : ' · sin empresa asignada'}
                      {d.fecha ? ` · adjudicada ${fmtFecha(d.fecha)}` : ''}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-50">{fmtCLP(d.monto)}</p>
                    <p className="text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">
                      {d.lineas === d.lineasTotal ? 'toda la licitación' : `${d.lineas} de ${d.lineasTotal} líneas`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-2">
              <Boton tamano="sm" variante={activo ? 'secundario' : 'fantasma'} onClick={() => onElegir(activo ? '' : c.clave)}
                icono={activo ? <X size={16} stroke={1.75} /> : <Search size={16} stroke={1.75} />}>
                {activo ? 'Quitar el filtro de la lista' : `Ver estas ${c.licitaciones} en la lista de abajo`}
              </Boton>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function APerdimos({ lista, perdidas, sinDetalle, elegido, onElegir }: {
  lista: Competidor[]; perdidas: number; sinDetalle: number; elegido: string; onElegir: (clave: string) => void;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const porMonto = [...lista].sort((a, b) => b.monto - a.monto);
  const top = porMonto.slice(0, 6);
  const resto = porMonto.slice(6);
  const color = new Map(top.map((c, i) => [c.clave, SERIE_COMPETIDORES[i]]));
  const totalMonto = lista.reduce((s, c) => s + c.monto, 0);
  const tajadas = [
    ...top.map(c => ({ clave: c.clave, etiqueta: c.nombre, valor: c.monto, color: color.get(c.clave)! })),
    ...(resto.length ? [{ clave: OTROS, etiqueta: `Otros ${resto.length} competidores`, valor: resto.reduce((s, c) => s + c.monto, 0), color: '#94a3b8' }] : []),
  ];
  const pctTop = totalMonto ? Math.round((top.reduce((s, c) => s + c.monto, 0) / totalMonto) * 100) : 0;
  // Centro sin decimales: «$7.119 MM» cabe en una línea dentro del anillo.
  const centro = totalMonto >= 1_000_000 ? `$${Math.round(totalMonto / 1_000_000).toLocaleString('es-CL')} MM` : fmtCLP(totalMonto);
  // Si el elegido ya no aparece (otro filtro lo dejó fuera), el botón para quitarlo sigue visible.
  const elegidoNombre = elegido ? (lista.find(c => c.clave === elegido)?.nombre ?? elegido) : '';
  const LIMITE = 8;
  const visibles = verTodos ? lista : lista.slice(0, LIMITE);
  const tarjeta = 'rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900';

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Competidores que nos ganaron</h2>
          <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">
            En las {perdidas} licitaciones que perdimos, qué empresas se quedaron con el contrato. Dato del acta de adjudicación de Mercado Público.
            {sinDetalle > 0 && ` ${sinDetalle} no traen el detalle por línea y no entran aquí.`}
          </p>
        </div>
        {elegidoNombre && (
          <Boton tamano="sm" onClick={() => onElegir('')} icono={<X size={16} stroke={1.75} />} aria-label={`Quitar el filtro por ${elegidoNombre}`}>
            Viendo lo que nos ganó {elegidoNombre.length > 28 ? `${elegidoNombre.slice(0, 28)}…` : elegidoNombre}
          </Boton>
        )}
      </div>
      <div className="grid gap-3 @4xl:grid-cols-2">
        <div className={tarjeta}>
          <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Cuánta plata se llevaron</h3>
          <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">
            Monto adjudicado a cada competidor en nuestras perdidas (precio × cantidad de sus líneas).
          </p>
          <Dona tajadas={tajadas} formato={fmtMM} centroValor={centro} centroTexto="a terceros"
            elegido={!elegido ? '' : color.has(elegido) ? elegido : OTROS} onElegir={c => { if (c !== OTROS) onElegir(c); }}
            descripcion={`${fmtMM(totalMonto)} adjudicados a competidores: ${tajadas.map(t => `${t.etiqueta} ${fmtMM(t.valor)}`).join(', ')}`} />
          {/* La lectura del gráfico en una frase: sin esto, una torta con «Otros» grande no se entiende. */}
          <p className="mt-3 border-t border-linea pt-2.5 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
            Nos ganaron <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{lista.length}</span> competidores distintos.
            {resto.length > 0
              ? <> Los {top.length} que más se llevaron suman el <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{pctTop} %</span>; el resto está muy repartido.</>
              : null}
          </p>
        </div>

        <div className={tarjeta}>
          <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Quién nos ganó más veces</h3>
          <p className="mt-0.5 mb-2 text-xs text-tinta-2 dark:text-slate-400">
            Cuántas de nuestras licitaciones perdidas se llevó cada competidor (completas o algunas líneas). Ábrelo para ver
            contra cuál de nuestras empresas nos ganó y en qué licitaciones.
          </p>
          <ul className="divide-y divide-linea dark:divide-slate-800">
            {visibles.map(c => (
              <FilaCompetidor key={c.clave} c={c} color={color.get(c.clave) || '#94a3b8'}
                elegido={elegido} onElegir={onElegir} />
            ))}
          </ul>
          {lista.length > LIMITE && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-linea pt-2 text-xs text-tinta-2 dark:border-slate-800 dark:text-slate-400">
              <span className="tabular-nums">{visibles.length} de {lista.length} competidores</span>
              <Boton tamano="sm" variante="fantasma" onClick={() => setVerTodos(v => !v)}
                icono={<ChevronDown size={16} stroke={1.75} className={`transition-transform ${verTodos ? 'rotate-180' : ''}`} />}>
                {verTodos ? 'Ver menos' : `Ver los ${lista.length}`}
              </Boton>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// Carga: bloques con la forma de lo que viene (KPIs + barra + filas). Sin giradores.
function Cargando({ vista }: { vista: Vista }) {
  const filas = Array.from({ length: 6 });
  return (
    <>
      <div className="mb-6 grid gap-3 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
          <Esqueleto className="h-4 w-48" />
          <div className="mt-3 flex items-center gap-6">
            <Esqueleto className="h-[132px] w-[132px] rounded-full" />
            <div className="flex-1 space-y-2"><Esqueleto className="h-4" /><Esqueleto className="h-4" /></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900 ${i === 2 ? 'col-span-2' : ''}`}>
              <Esqueleto className="h-3 w-20" /><Esqueleto className="mt-3 h-7 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 rounded-xl border border-linea bg-white p-3 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
        <Esqueleto className="h-8 w-72" />
        <Esqueleto className="mt-3 h-8 w-full max-w-md" />
      </div>
      {vista === 'tarjetas' ? (
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
          {filas.map((_, i) => <TarjetaCargando key={i} />)}
        </div>
      ) : (
        <div className="space-y-2">
          {filas.map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-linea bg-white px-4 py-3 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
              <div className="flex-1"><Esqueleto className="h-3 w-36" /><Esqueleto className="mt-2 h-4 w-2/3" /></div>
              <Esqueleto className="hidden @5xl:block h-4 w-24" />
              <Esqueleto className="hidden @5xl:block h-4 w-20" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Paginación ────────────────────────────────────────────────────────────────
// Números con elipsis: 1 … (p-1) p (p+1) … N. Siempre visibles primera y última.
function numerosPagina(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, total - 1, total, actual - 1, actual, actual + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('…');
    out.push(nums[i]);
  }
  return out;
}

function Paginacion({ pagina, totalPaginas, total, desde, hasta, porPagina, onPagina, onPorPagina }: {
  pagina: number; totalPaginas: number; total: number; desde: number; hasta: number; porPagina: number;
  onPagina: (p: number) => void; onPorPagina: (n: number) => void;
}) {
  if (total === 0) return null;
  const btn = 'inline-flex items-center justify-center h-8 rounded-lg text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60';
  const neutro = 'border border-linea text-tinta-2 hover:bg-slate-50 hover:text-tinta dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
  return (
    <div className="flex flex-col @xl:flex-row items-center justify-between gap-3 mt-5">
      <div className="flex items-center gap-3 text-xs text-tinta-2 dark:text-slate-400">
        <span className="tabular-nums"><span className="font-semibold text-tinta dark:text-slate-100">{desde}–{hasta}</span> de <span className="font-semibold text-tinta dark:text-slate-100">{total}</span></span>
        <span className="inline-flex items-center gap-1.5">
          Por página
          <Select value={String(porPagina)} onChange={v => onPorPagina(Number(v))} minWidth={70}
            options={[10, 25, 50].map(nv => ({ value: String(nv), label: String(nv) }))} />
        </span>
      </div>
      {totalPaginas > 1 && (
        <nav className="flex items-center gap-1" aria-label="Paginación">
          <button onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"
            className={`${btn} ${neutro} w-8 disabled:opacity-40 disabled:pointer-events-none`}>
            <ChevronLeft size={16} stroke={1.75} />
          </button>
          {numerosPagina(pagina, totalPaginas).map((p, i) => p === '…'
            ? <span key={`e${i}`} className="w-8 text-center text-xs text-tinta-3">…</span>
            : (
              <button key={p} onClick={() => onPagina(p)} aria-current={p === pagina ? 'page' : undefined}
                className={`${btn} min-w-[32px] px-1 tabular-nums ${p === pagina ? 'bg-marca text-white hover:bg-marca-fuerte' : neutro}`}>
                {p}
              </button>
            ))}
          <button onClick={() => onPagina(pagina + 1)} disabled={pagina >= totalPaginas} aria-label="Página siguiente"
            className={`${btn} ${neutro} w-8 disabled:opacity-40 disabled:pointer-events-none`}>
            <ChevronRight size={16} stroke={1.75} />
          </button>
        </nav>
      )}
    </div>
  );
}

export default function AdjudicadasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCruce, setErrorCruce] = useState(false);
  const toast = useToast();
  const [exportando, setExportando] = useState(false);

  // ── Estado de la UI (vista, buscador, filtros, orden, paginación) ──────────
  const [vista, setVista] = useState<Vista>('lista');
  const [q, setQ] = useState('');
  const [fPerfil, setFPerfil] = useState<string[]>([]);
  const [fEmpresa, setFEmpresa] = useState<string[]>([]);
  const [resultadoSel, setResultadoSel] = useState<Resultado | ''>('');
  const [fCompetidor, setFCompetidor] = useState(''); // clave del proveedor (RUT) que nos ganó
  const [orden, setOrden] = useState<Orden>('recientes');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const listaRef = useRef<HTMLDivElement>(null);

  // Preferencia de vista persistida (por navegador). En efecto y con try/catch:
  // el acceso a localStorage puede LANZAR con almacenamiento bloqueado.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('adjudicadas_vista');
      if (v === 'lista' || v === 'tarjetas') setVista(v);
    } catch { /* almacenamiento bloqueado */ }
  }, []);
  const cambiarVista = (v: Vista) => { setVista(v); try { window.localStorage.setItem('adjudicadas_vista', v); } catch { /* privado */ } };

  const [adjMap, setAdjMap] = useState<Record<string, Adjudicacion | null>>({});
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());
  // El cruce con el cache llega en 1 llamada. Hasta que esté, no pintamos conteos (evita el
  // salto de "solo promovidas" → total). Así el resultado aparece completo de una.
  const [cruceListo, setCruceListo] = useState(false);
  const [cruceVersion, setCruceVersion] = useState(0); // para el botón Reintentar

  // Tiempo real: el cron de 2h refresca el cache de adjudicación desde MP y publica un
  // evento; también llega cuando alguien mueve una postulada. Sube `version` → recarga.
  const [version, setVersion] = useState(0);
  useRealtime(useCallback(() => setVersion(v => v + 1), []));

  useEffect(() => {
    let cancelado = false; // una respuesta vieja no debe pisar a la nueva
    (async () => {
      try {
        const res = await fetch('/api/negocios', { cache: 'no-store' });
        const data = await res.json();
        if (cancelado) return;
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
        const todas: Negocio[] = data.negocios || [];
        // Universo amplio: además de las ya promovidas (ADJUDICADA/PERDIDA), incluimos las que
        // siguen en POSTULADA pero MP ya adjudicó. El gate `esResuelta` (por cache) deja solo las
        // realmente resueltas → el resultado real aparece aquí sin esperar la promoción del cron.
        const univ = todas.filter(n => n.licitacion_codigo && ['ADJUDICADA', 'PERDIDA', 'POSTULADA', 'POSIBLE_ADJ'].includes(n.estado_pipeline || ''));
        // Dedup defensivo por código (bug conocido de filas duplicadas al reasignar):
        // se conserva la fila más reciente (id mayor) por licitación.
        const porCodigo = new Map<string, Negocio>();
        for (const n of univ) {
          const prev = porCodigo.get(n.licitacion_codigo);
          if (!prev || n.id > prev.id) porCodigo.set(n.licitacion_codigo, n);
        }
        setNegocios([...porCodigo.values()]);
        setError(null); // un fallo transitorio anterior no debe quedar pegado
        if (porCodigo.size === 0) setCruceListo(true); // nada que cruzar
      } catch (e: any) {
        if (cancelado) return;
        setError(String(e?.message ?? e));
        setCruceListo(true); // sin esto el error quedaba oculto tras el skeleton eterno
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [version]);

  // Cruce con la adjudicación en UNA sola llamada al servidor (SOLO cache de la BD, sin tocar
  // MP): el resultado aparece de una, sin ir subiendo progresivamente y sin recargar cada vez.
  // El refresco lo hace el cron cada 2h cuando MP publica un cambio de estado.
  useEffect(() => {
    if (negocios.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/postuladas/estado', { cache: 'no-store' });
        const d = await r.json();
        if (cancelado) return;
        if (d?.estados) { setAdjMap(d.estados); setErrorCruce(false); }
        else setErrorCruce(true);
      } catch {
        // sin cruce → cae a la clasificación por estado, pero se AVISA (banner con reintentar)
        if (!cancelado) setErrorCruce(true);
      } finally {
        if (!cancelado) {
          setResueltos(new Set(negocios.map(n => n.licitacion_codigo).filter(Boolean)));
          setCruceListo(true);
        }
      }
    })();
    return () => { cancelado = true; };
  }, [negocios, cruceVersion]);

  // Gate de "resuelta": manda el cache de adjudicación (esAdjudicada); si aún no cargó, el estado
  // ya promovido. Solo las resueltas se muestran en Adjudicadas.
  const esResuelta = useCallback((n: Negocio) => {
    const a = adjMap[n.licitacion_codigo];
    if (a) return a.esAdjudicada;
    const estado = normalizarEstado(n.estado_pipeline);
    return estado === 'ADJUDICADA' || estado === 'PERDIDA';
  }, [adjMap]);
  const resueltas = useMemo(() => negocios.filter(esResuelta), [negocios, esResuelta]);

  // Última licitación GANADA (independiente de filtros/paginación): se recalcula sola cada
  // vez que llega un resultado nuevo — "fija hasta que salga otra" sin necesitar estado propio.
  const ultimaGanada = useMemo(() => {
    let mejor: { n: Negocio; ts: number } | null = null;
    for (const n of resueltas) {
      if (resultadoDe(n, adjMap[n.licitacion_codigo]) !== 'ganada') continue;
      const ts = tsDe(adjMap[n.licitacion_codigo]?.fechaAdjudicacion || n.licitacion_cierre);
      if (!mejor || ts > mejor.ts) mejor = { n, ts };
    }
    return mejor?.n ?? null;
  }, [resueltas, adjMap]);

  // Última licitación PERDIDA. Solo cuenta una pérdida REAL (adjudicada a un tercero, con acta
  // de MP) — Desierta/Revocada también caen en "perdida" para las estadísticas, pero su
  // fecha_adjudicacion en el caché es basura (MP no adjudicó a nadie, ese campo trae otra fecha
  // sin relación), así que quedarían "ganando" el badge con una fecha que no significa nada.
  const ultimaPerdida = useMemo(() => {
    let mejor: { n: Negocio; ts: number } | null = null;
    for (const n of resueltas) {
      const adj = adjMap[n.licitacion_codigo];
      if (resultadoDe(n, adj) !== 'perdida' || !adj?.esAdjudicada) continue;
      const ts = tsDe(adj?.fechaAdjudicacion || n.licitacion_cierre);
      if (!mejor || ts > mejor.ts) mejor = { n, ts };
    }
    return mejor?.n ?? null;
  }, [resueltas, adjMap]);

  // ── Opciones de filtros con conteo (solo lo presente en los datos) ──────────
  const opcionesPerfil = useMemo(() => {
    const m = new Map<string, { nombre: string; total: number }>();
    for (const n of resueltas) {
      const email = n.usuario_email || n.usuario_nombre || '—';
      const e = m.get(email) || { nombre: n.usuario_nombre || n.usuario_email || '—', total: 0 };
      e.total++; m.set(email, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
      .map(([email, v]) => ({ value: email, label: v.nombre, color: colorUsuario(email), count: v.total }));
  }, [resueltas]);

  const opcionesEmpresa = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of resueltas) if (n.empresa_nombre) m.set(n.empresa_nombre, (m.get(n.empresa_nombre) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: v, count: c }));
  }, [resueltas]);

  // Filtros FANTASMA: si tras un refetch una selección ya no existe entre las opciones,
  // se poda sola (si no, seguiría filtrando sin que haya control visible que lo muestre).
  useEffect(() => {
    const vals = new Set(opcionesPerfil.map(o => o.value));
    setFPerfil(p => p.every(v => vals.has(v)) ? p : p.filter(v => vals.has(v)));
  }, [opcionesPerfil]);
  useEffect(() => {
    const vals = new Set(opcionesEmpresa.map(o => o.value));
    setFEmpresa(p => p.every(v => vals.has(v)) ? p : p.filter(v => vals.has(v)));
  }, [opcionesEmpresa]);

  // ── Cadena de filtrado: perfil/empresa/búsqueda → base (para KPIs y tabs) ───
  // Cada bloque gráfico se calcula SIN su propio filtro (las tortas por empresa sin el de empresa; la de
  // competidores sin el de competidor): al elegir una opción las demás siguen visibles (atenuadas) para
  // poder cambiar de una a otra. La lista y los KPIs usan `base`, con todos los filtros.
  const baseComun = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return resueltas.filter(n =>
      (fPerfil.length === 0 || fPerfil.includes(n.usuario_email || n.usuario_nombre || '—')) &&
      (!texto
        || (n.licitacion_nombre || '').toLowerCase().includes(texto)
        || (n.licitacion_codigo || '').toLowerCase().includes(texto)
        || (n.licitacion_organismo || '').toLowerCase().includes(texto)
        || (n.empresa_nombre || '').toLowerCase().includes(texto)
        // El perfil solo es un campo visible (y por tanto buscable) para el admin.
        || (isAdmin && ((n.usuario_nombre || '').toLowerCase().includes(texto)
          || (n.usuario_email || '').toLowerCase().includes(texto)))));
  }, [resueltas, fPerfil, q, isAdmin]);
  const pasaEmpresa = useCallback(
    (n: Negocio) => fEmpresa.length === 0 || (!!n.empresa_nombre && fEmpresa.includes(n.empresa_nombre)), [fEmpresa]);
  // Competidor elegido: solo las PERDIDAS donde ese proveedor se adjudicó al menos una línea.
  const pasaCompetidor = useCallback((n: Negocio) => {
    if (!fCompetidor) return true;
    const a = adjMap[n.licitacion_codigo];
    return resultadoDe(n, a) === 'perdida' && (a?.lineasAdjudicadas || []).some(l => !l.esNuestra && claveProveedor(l) === fCompetidor);
  }, [fCompetidor, adjMap]);
  const baseSinCompetidor = useMemo(() => baseComun.filter(pasaEmpresa), [baseComun, pasaEmpresa]);
  const base = useMemo(() => baseComun.filter(n => pasaEmpresa(n) && pasaCompetidor(n)), [baseComun, pasaEmpresa, pasaCompetidor]);

  // ── ¿A quién le perdimos? ────────────────────────────────────────────────────
  // Desde las líneas del acta de cada PERDIDA: quién se adjudicó cada línea (por RUT; si falta, por nombre).
  // Monto de una línea = precio unitario × cantidad adjudicada (mismo cálculo que el total adjudicado del
  // acta, app/lib/adjudicacion.ts). Una licitación por líneas puede tener varios ganadores: por eso las
  // licitaciones por competidor pueden sumar más que las perdidas.
  const competidores = useMemo(() => {
    const m = new Map<string, { clave: string; nombres: Map<string, number>; rut: string | null; detalle: Map<string, LicitacionPerdida>; monto: number }>();
    let perdidas = 0, sinDetalle = 0;
    for (const n of baseSinCompetidor) {
      const a = adjMap[n.licitacion_codigo];
      if (resultadoDe(n, a) !== 'perdida') continue;
      perdidas++;
      const lineas = (a?.lineasAdjudicadas || []).filter(l => !l.esNuestra && claveProveedor(l));
      if (!a?.esAdjudicada || lineas.length === 0) { sinDetalle++; continue; }
      for (const l of lineas) {
        const clave = claveProveedor(l);
        const e = m.get(clave) || { clave, nombres: new Map(), rut: l.rutProveedor, detalle: new Map(), monto: 0 };
        const nombre = (l.proveedor || l.rutProveedor || 'Proveedor').trim();
        e.nombres.set(nombre, (e.nombres.get(nombre) || 0) + 1);
        const montoLinea = (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
        // Por licitación: qué empresa nuestra postuló, cuántas líneas y cuánto se llevó ese competidor.
        const d = e.detalle.get(n.licitacion_codigo) || {
          codigo: n.licitacion_codigo, nombre: n.licitacion_nombre || n.licitacion_codigo, empresa: n.empresa_nombre || null,
          fecha: a.fechaAdjudicacion || null, lineas: 0, lineasTotal: (a.lineasAdjudicadas || []).length, monto: 0,
        };
        d.lineas++; d.monto += montoLinea;
        e.detalle.set(n.licitacion_codigo, d);
        e.monto += montoLinea;
        m.set(clave, e);
      }
    }
    const lista = [...m.values()].map(e => ({
      clave: e.clave, rut: e.rut, licitaciones: e.detalle.size, monto: e.monto,
      detalle: [...e.detalle.values()].sort((x, y) => tsDe(y.fecha) - tsDe(x.fecha)),
      // El nombre que más se repite para ese RUT (MP a veces lo escribe distinto).
      nombre: [...e.nombres.entries()].sort((x, y) => y[1] - x[1])[0][0],
    })).sort((x, y) => y.licitaciones - x.licitaciones || y.monto - x.monto);
    return { lista, perdidas, sinDetalle };
  }, [baseSinCompetidor, adjMap]);

  // ── Por empresa propia: con cuál de nuestras empresas ganamos / perdimos ─────
  // Mismo criterio que los KPIs (resultadoDe + montoNuestro de las ganadas). Color fijo por empresa
  // (la misma en las dos tortas y en la efectividad); «Sin empresa» en gris y no filtra.
  const porEmpresa = useMemo(() => {
    const m = new Map<string, { clave: string; etiqueta: string; ganadas: number; perdidas: number; monto: number }>();
    for (const n of baseComun) {
      const a = adjMap[n.licitacion_codigo];
      const clave = n.empresa_nombre || SIN_EMPRESA;
      const e = m.get(clave) || { clave, etiqueta: n.empresa_nombre || 'Sin empresa', ganadas: 0, perdidas: 0, monto: 0 };
      if (resultadoDe(n, a) === 'ganada') { e.ganadas++; if (a?.ganamos && a.montoNuestro) e.monto += a.montoNuestro; }
      else e.perdidas++;
      m.set(clave, e);
    }
    const filas = [...m.values()].sort((x, y) =>
      (x.clave === SIN_EMPRESA ? 1 : 0) - (y.clave === SIN_EMPRESA ? 1 : 0) || (y.ganadas + y.perdidas) - (x.ganadas + x.perdidas));
    let i = 0;
    return filas.map(f => ({ ...f, color: f.clave === SIN_EMPRESA ? '#94a3b8' : SERIE_EMPRESAS[i++ % SERIE_EMPRESAS.length] }));
  }, [baseComun, adjMap]);
  const empresaElegida = fEmpresa.length === 1 ? fEmpresa[0] : '';
  const elegirEmpresa = (clave: string) => { if (clave !== SIN_EMPRESA) setFEmpresa(clave ? [clave] : []); };

  // El resumen (torta, KPIs) NO aplica el filtro de competidor: ese filtro deja solo perdidas y mostraría
  // «0 % de efectividad», como si nunca le ganáramos a ese competidor. Solo la lista y las pestañas lo usan.
  const conteoResumen = useMemo(() => {
    const c = { ganada: 0, perdida: 0 };
    for (const n of baseSinCompetidor) c[resultadoDe(n, adjMap[n.licitacion_codigo])]++;
    return c;
  }, [baseSinCompetidor, adjMap]);
  const conteo = useMemo(() => {
    const c = { ganada: 0, perdida: 0 };
    for (const n of base) c[resultadoDe(n, adjMap[n.licitacion_codigo])]++;
    return c;
  }, [base, adjMap]);

  const visibles = useMemo(() => {
    const lista = base.filter(n => !resultadoSel || resultadoDe(n, adjMap[n.licitacion_codigo]) === resultadoSel);
    const val = (n: Negocio) => montoResultado(n, adjMap[n.licitacion_codigo] ?? null, resultadoDe(n, adjMap[n.licitacion_codigo])) ?? -1;
    // El orden por fecha usa la ADJUDICACIÓN (cuándo se resolvió); si MP aún no la trae, el cierre.
    const fecha = (n: Negocio) => { const a = adjMap[n.licitacion_codigo]; return tsDe((a?.esAdjudicada && a.fechaAdjudicacion) || n.licitacion_cierre); };
    switch (orden) {
      case 'antiguas':     return lista.sort((a, b) => fecha(a) - fecha(b));
      case 'monto_ganado': return lista.sort((a, b) => val(b) - val(a));
      case 'presupuesto':  return lista.sort((a, b) => (b.licitacion_monto ?? -1) - (a.licitacion_monto ?? -1));
      case 'nombre':       return lista.sort((a, b) => (a.licitacion_nombre || '').localeCompare(b.licitacion_nombre || '', 'es'));
      default:             return lista.sort((a, b) => fecha(b) - fecha(a));
    }
  }, [base, resultadoSel, adjMap, orden]);

  // ── Exportar Excel ──────────────────────────────────────────────────────────
  // Exporta `visibles`: la MISMA vista de la pantalla (pestaña Ganadas/Perdidas/Todas + búsqueda +
  // perfil + empresa), SIN paginar, en el orden elegido. Una fila por licitación resuelta, con el
  // detalle del acta de adjudicación. Las fechas salen dd-mm-aaaa (ver app/lib/exportar-fechas.ts).
  const exportarExcel = async () => {
    if (exportando) return;
    if (visibles.length === 0) {
      toast.error('No hay licitaciones para exportar', 'Ajusta o limpia los filtros e inténtalo de nuevo.');
      return;
    }
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const filas = visibles.map(n => {
        const a = adjMap[n.licitacion_codigo] ?? null;
        const r = resultadoDe(n, a);
        const lineas = a?.lineasAdjudicadas || [];
        const adjudicatarios = Array.from(new Set(lineas.map(l => l.proveedor).filter(Boolean))) as string[];
        const cierre = fechaHoraParaExcel(n.licitacion_cierre);
        const apertura = fechaHoraParaExcel(n.apertura_detectada_en);
        const postulada = fechaHoraParaExcel(n.postulada_en);
        return {
          'Código':             n.licitacion_codigo,
          'Nombre':             n.licitacion_nombre || '',
          'Organismo':          n.licitacion_organismo || '',
          'Tipo':               extractTipoFromCodigo(n.licitacion_codigo || '') || '',
          'Región':             n.licitacion_region || '',
          'Resultado':          META[r].label,
          'Estado MP':          a?.estado || n.licitacion_estado || '',
          'Estado gestión':     getEstadoPipeline(n.estado_pipeline || '')?.label || n.estado_pipeline || '',
          'Aperturada':         n.aperturada ? 'Sí' : 'No',
          'Apertura detectada (fecha)': apertura.fecha,
          'Apertura detectada (hora)':  apertura.hora,
          'Asignada (fecha)':   fechaHoraParaExcel(n.created_at).fecha,
          'Postulada (fecha)':  postulada.fecha,
          'Postulada (hora)':   postulada.hora,
          'Cierre (fecha)':     cierre.fecha,
          'Cierre (hora)':      cierre.hora,
          'Fecha adjudicación': fechaHoraParaExcel(a?.esAdjudicada ? a.fechaAdjudicacion : null).fecha,
          'N° OC':              (a?.ocCodigos || []).join(', '),
          'Link OC':            (a?.ocCodigos || []).map(urlOc).join(' | '),
          'OC llegó':           fechaHoraParaExcel(a?.fechaOcLlegada ?? null).fecha,
          'OC aceptada':        fechaHoraParaExcel(a?.fechaOcAceptada ?? null).fecha,
          'Presupuesto MP':     n.licitacion_monto ?? '',
          'Monto ofertado':     n.monto_ofertado ?? '',
          'Monto resultado':    montoResultado(n, a, r) ?? '',
          'Monto adjudicado a nosotros': a?.montoNuestro ?? '',
          'Monto adjudicado total':      a?.montoAdjudicadoTotal ?? '',
          'Líneas adjudicadas':          lineas.length || '',
          'Líneas ganadas por nosotros': lineas.filter(l => l.esNuestra).length || '',
          'Adjudicatarios':     adjudicatarios.join(', '),
          'N° oferentes':       a?.adjudicacion?.numeroOferentes ?? '',
          'N° resolución':      a?.adjudicacion?.numeroResolucion || '',
          'Empresa':            n.empresa_nombre || '',
          'Perfil':             n.usuario_nombre || n.usuario_email || '',
          'URL acta':           a?.adjudicacion?.urlActa || '',
          'URL':                `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(n.licitacion_codigo)}`,
        };
      });
      const ws = hojaDeFilas(XLSX, filas);
      // Anchos en el MISMO orden que las claves de arriba.
      ws['!cols'] = [
        { wch: 18 }, { wch: 48 }, { wch: 30 }, { wch: 8 },  { wch: 22 },  // código…región
        { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 11 }, { wch: 18 }, { wch: 18 },  // resultado…apertura
        { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 60 }, { wch: 12 }, { wch: 12 },  // fechas, N° y link OC
        { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 22 },  // montos
        { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 18 },  // líneas, adjudicatarios
        { wch: 24 }, { wch: 22 }, { wch: 60 }, { wch: 60 },               // empresa…URLs
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, resultadoSel ? META[resultadoSel].short : 'Ganadas y perdidas');
      const etiqueta = resultadoSel === 'ganada' ? 'ganadas' : resultadoSel === 'perdida' ? 'perdidas' : 'ganadas-perdidas';
      XLSX.writeFile(wb, `${etiqueta}-${dayjs().format('DD-MM-YYYY')}.xlsx`);
      toast.success(
        `Exportadas ${filas.length} licitación${filas.length !== 1 ? 'es' : ''}`,
        'Se descargó el Excel con los filtros actuales.',
      );
    } catch (e) {
      console.error('[adjudicadas] exportar Excel falló:', e);
      toast.error('No se pudo exportar el Excel', String((e as any)?.message || e));
    } finally {
      setExportando(false);
    }
  };

  // ── Paginación en cliente sobre el resultado filtrado/ordenado ──────────────
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const enPagina = useMemo(
    () => visibles.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina),
    [visibles, paginaSegura, porPagina]);
  // Cambio de filtro/orden vuelve a la página 1 (cambiar de VISTA no: son los mismos datos).
  useEffect(() => { setPagina(1); }, [q, fPerfil, fEmpresa, fCompetidor, resultadoSel, orden, porPagina]);
  // Si los datos en vivo encogen el total, el estado no puede quedar apuntando a una
  // página que ya no existe (el clamp del render solo corrige lo visible).
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);

  const irAPagina = (p: number) => {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
    // El usuario quedaba mirando el FONDO de la lista nueva: subir al inicio del listado.
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stats = useMemo(() => {
    // Mismo criterio que Postuladas y el Dashboard: solo lo que Mercado Público adjudicó a
    // nosotros (antes, si faltaba ese monto, se sumaba lo ofertado y las cifras no cuadraban).
    let montoGanado = 0;
    for (const n of baseSinCompetidor) {
      const a = adjMap[n.licitacion_codigo];
      if (a?.ganamos && a.montoNuestro) montoGanado += a.montoNuestro;
    }
    const total = conteoResumen.ganada + conteoResumen.perdida;
    return { montoGanado, exito: total ? Math.round((conteoResumen.ganada / total) * 100) : null };
  }, [baseSinCompetidor, conteoResumen, adjMap]);

  const TABS: { id: Resultado | ''; label: string; count: number; color: string }[] = [
    { id: '', label: 'Todas', count: base.length, color: '#334155' },
    { id: 'ganada', label: 'Ganadas', count: conteo.ganada, color: META.ganada.color },
    { id: 'perdida', label: 'Perdidas', count: conteo.perdida, color: META.perdida.color },
  ];

  const hayFiltros = q.trim() !== '' || fPerfil.length > 0 || fEmpresa.length > 0 || resultadoSel !== '' || fCompetidor !== '';
  const limpiarFiltros = () => { setQ(''); setFPerfil([]); setFEmpresa([]); setResultadoSel(''); setFCompetidor(''); };

  // Hasta que el cruce con el cache no esté listo, tratamos la vista como "cargando" para no
  // mostrar un conteo parcial que luego salta.
  const cargandoTodo = cargando || !cruceListo;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Ganadas/Perdidas' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Ganadas/Perdidas"
          descripcion={cargandoTodo
            ? 'Cargando…'
            : `${base.length} licitación${base.length !== 1 ? 'es' : ''} resuelta${base.length !== 1 ? 's' : ''} · resultado real de Mercado Público`}
          acciones={
            <>
              <Boton onClick={exportarExcel} disabled={exportando || cargandoTodo || visibles.length === 0}
                title="Exportar a Excel las licitaciones con los filtros actuales (incluye la fecha de adjudicación)"
                icono={exportando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} stroke={1.75} />}>
                {exportando ? 'Exportando…' : 'Exportar'}
              </Boton>
              <div className="relative w-64 @2xl:w-80">
                <Search size={16} stroke={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Buscar por nombre o código…"
                  title={isAdmin ? 'Busca por nombre, código, organismo, empresa o perfil' : 'Busca por nombre, código, organismo o empresa'}
                  aria-label="Buscar licitaciones resueltas"
                  className="h-9 w-full rounded-lg border border-linea bg-white pl-9 pr-8 text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                {q && (
                  <button onClick={() => setQ('')} aria-label="Limpiar búsqueda" title="Limpiar búsqueda"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800">
                    <X size={14} stroke={1.75} />
                  </button>
                )}
              </div>
            </>
          }
        />

        {/* Aviso no bloqueante: el detalle de adjudicación (cache MP) no cargó */}
        {!cargandoTodo && errorCruce && (
          <Banner variante="warning" className="mb-4"
            accion={{ label: 'Reintentar', onClick: () => setCruceVersion(v => v + 1) }}>
            No se pudo cargar el detalle de adjudicación desde el servidor — se muestra la
            clasificación por estado, que puede estar incompleta.
          </Banner>
        )}

        {cargandoTodo ? (
          <Cargando vista={vista} />
        ) : error ? (
          <Banner variante="error" accion={{ label: 'Reintentar', onClick: () => { setCargando(true); setVersion(v => v + 1); } }}>
            {error}
          </Banner>
        ) : (
          <>
            {/* Resumen: torta ganadas/perdidas (clic = filtra) + indicadores clave */}
            {baseSinCompetidor.length > 0 && (
              <div className="mb-6 grid gap-3 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Resultado de las {baseSinCompetidor.length} resueltas</h2>
                  <p className="mt-0.5 mb-3 text-xs text-tinta-2 dark:text-slate-400">Ganadas sobre el total adjudicado en Mercado Público. Toca una para ver solo esas.</p>
                  <Dona
                    tajadas={[
                      { clave: 'ganada', etiqueta: META.ganada.short, valor: conteoResumen.ganada, color: META.ganada.color },
                      { clave: 'perdida', etiqueta: META.perdida.short, valor: conteoResumen.perdida, color: META.perdida.color },
                    ]}
                    centroValor={stats.exito != null ? `${stats.exito} %` : '—'} centroTexto="de efectividad"
                    elegido={resultadoSel} onElegir={c => setResultadoSel(c as Resultado | '')}
                    descripcion={`${conteoResumen.ganada} ganadas y ${conteoResumen.perdida} perdidas de ${baseSinCompetidor.length} resueltas`} />
                  {(ultimaGanada || ultimaPerdida) && (
                    <div className="mt-3 space-y-1 border-t border-linea pt-2.5 text-xs dark:border-slate-800">
                      {([['ganada', ultimaGanada], ['perdida', ultimaPerdida]] as const).map(([r, n]) => n && (
                        <Link key={r} href={`/negocios/${n.id}`} title={n.licitacion_nombre || n.licitacion_codigo}
                          className="flex min-w-0 items-center gap-2 rounded px-0.5 hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
                          <span className="flex-shrink-0 text-tinta-2 dark:text-slate-400">
                            <Estado color={META[r].color}>Última {META[r].label.toLowerCase()}</Estado>
                          </span>
                          <span className="truncate font-medium text-tinta dark:text-slate-100">{n.licitacion_nombre || n.licitacion_codigo}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <Lista className="grid grid-cols-2 gap-3 content-start">
                  <Indicador rotulo="Ganadas" valor={conteoResumen.ganada}
                    detalle={stats.exito != null ? `${stats.exito} % de efectividad` : undefined} />
                  <Indicador rotulo="Perdidas" valor={conteoResumen.perdida} detalle="Adjudicadas a terceros" />
                  <div className="col-span-2">
                    <Indicador rotulo="Monto ganado" valor={stats.montoGanado || 0} formato={fmtCLP} detalle="Lo adjudicado a nosotros" />
                  </div>
                </Lista>
              </div>
            )}

            {/* Por empresa propia: dos tortas + efectividad de cada una (clic = filtra por esa empresa) */}
            {porEmpresa.length > 0 && baseComun.length > 0 && (
              <PorEmpresa filas={porEmpresa} elegida={empresaElegida} onElegir={elegirEmpresa} />
            )}

            {/* Competidores que se adjudicaron nuestras perdidas (clic = filtra a esas perdidas) */}
            {competidores.lista.length > 0 && (
              <APerdimos lista={competidores.lista} perdidas={competidores.perdidas} sinDetalle={competidores.sinDetalle}
                elegido={fCompetidor} onElegir={setFCompetidor} />
            )}

            {/* Barra de control: resultado · vista · filtros · orden */}
            {resueltas.length > 0 && (
              <div className="mb-5 rounded-xl border border-linea bg-white p-3 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="overflow-x-auto">
                    <Pestanas id="adjudicadas-resultado" valor={resultadoSel} onCambio={setResultadoSel}
                      opciones={TABS.map(t => ({ valor: t.id, etiqueta: t.label, contador: t.count }))} />
                  </div>
                  <Pestanas id="adjudicadas-vista" valor={vista} onCambio={cambiarVista}
                    opciones={[{ valor: 'lista', etiqueta: 'Lista' }, { valor: 'tarjetas', etiqueta: 'Tarjetas' }]} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-linea pt-3 dark:border-slate-800">
                  {isAdmin && opcionesPerfil.length > 1 && (
                    <MultiSelect label="Perfil" icon={<Users size={13} />} options={opcionesPerfil} selected={fPerfil} onChange={setFPerfil} />
                  )}
                  {opcionesEmpresa.length > 1 && (
                    <MultiSelect label="Empresa" icon={<Building2 size={13} />} options={opcionesEmpresa} selected={fEmpresa} onChange={setFEmpresa} />
                  )}
                  {hayFiltros && (
                    <Boton tamano="sm" variante="fantasma" onClick={limpiarFiltros} icono={<X size={16} stroke={1.75} />}>Limpiar filtros</Boton>
                  )}
                  <div className="ml-auto inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-tinta-2 dark:text-slate-400">
                      <ArrowUpDown size={14} stroke={1.75} className="text-slate-400" /> Ordenar por
                    </span>
                    <Select value={orden} onChange={v => setOrden(v as Orden)} options={OPCIONES_ORDEN} minWidth={180} />
                  </div>
                </div>
              </div>
            )}

            {/* Contenido */}
            <div ref={listaRef} className="scroll-mt-16">
              {visibles.length === 0 ? (
                resueltas.length === 0 ? (
                  <Vacio icono={<Inbox size={28} stroke={1.5} />} titulo="Todavía no hay licitaciones resueltas"
                    texto="Cuando Mercado Público publique el resultado de una postulada, aparecerá aquí como ganada o perdida." />
                ) : (
                  <Vacio icono={<Inbox size={28} stroke={1.5} />} titulo="Nada con estos filtros"
                    texto={isAdmin ? 'Prueba con otra búsqueda, resultado, perfil o empresa.' : 'Prueba con otra búsqueda, resultado o empresa.'}
                    accion={hayFiltros ? <Boton tamano="sm" onClick={limpiarFiltros} icono={<X size={16} stroke={1.75} />}>Limpiar filtros</Boton> : undefined} />
                )
              ) : vista === 'tarjetas' ? (
                <Lista key={`t-${paginaSegura}`} className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
                  {enPagina.map(n => (
                    <Card key={n.id} n={n} adj={adjMap[n.licitacion_codigo] ?? null}
                      cargandoAdj={!resueltos.has(n.licitacion_codigo)} isAdmin={!!isAdmin} />
                  ))}
                </Lista>
              ) : (
                <div className="space-y-2">
                  {/* Encabezado de columnas (solo con panel ancho) */}
                  <div className={`hidden @5xl:grid ${isAdmin ? GRID_ADMIN : GRID_USER} gap-x-3 px-4 pb-0.5 text-[11px] text-tinta-2 dark:text-slate-400`}>
                    <span>Licitación</span>
                    {isAdmin && <span><span className="sr-only">Perfil</span></span>}
                    <span>Empresa</span>
                    <span className="text-right">Monto</span>
                    <span className="text-right">Adjudicada</span>
                    <span className="text-right">Orden de compra</span>
                    <span className="text-right">Cierre</span>
                    <span />
                  </div>
                  <Lista key={`l-${paginaSegura}`} className="space-y-2">
                    {enPagina.map(n => (
                      <Fila key={n.id} n={n} adj={adjMap[n.licitacion_codigo] ?? null}
                        cargandoAdj={!resueltos.has(n.licitacion_codigo)} isAdmin={!!isAdmin} />
                    ))}
                  </Lista>
                </div>
              )}
            </div>

            <Paginacion
              pagina={paginaSegura} totalPaginas={totalPaginas} total={visibles.length}
              desde={(paginaSegura - 1) * porPagina + 1}
              hasta={Math.min(paginaSegura * porPagina, visibles.length)}
              porPagina={porPagina} onPagina={irAPagina} onPorPagina={setPorPagina} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
