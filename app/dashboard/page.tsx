'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useRealtime } from '@/app/lib/use-realtime';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { IconSearch as Search, IconChevronRight as ChevronRight, IconChevronDown as ChevronDown, IconX as X } from '@tabler/icons-react';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { getEstadoPipeline, ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { diasCalendarioChile } from '@/app/lib/tz';
import { AnaliticaGestion } from '@/app/components/AnaliticaGestion';
import { MetricInfo, type EspecificacionMetrica } from '@/app/components/ui/MetricInfo';
import { Banner } from '@/app/components/ui/Banner';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Dona, type TajadaDona } from '@/app/components/ui/kit/Dona';
import { Encabezado, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';
import { Estado } from '@/app/components/ui/kit/Tarjeta';

interface DashData {
  success: boolean; rol: string;
  admin: null | {
    usuarios: { total: number; activos: number; nuevosSemana: number; ultimosAccesos: any[] };
    radar: { totalLicitaciones: number; sinAsignar: number };
    viabilidad: { nivel: string | null; semaforo: string | null; n: number }[];
    prefiltro: { decision: string; n: number }[];
    pipeline: { etapa: string; n: number }[];
    montoPipeline: number;
    porDia: { dia: string; n: number }[];
    porPerfil: { id: number; nombre: string | null; email: string; total: number; monto: number; descartadas: number; pipeline: { etapa: string; n: number }[] }[];
  };
  usuario: {
    asignadas: number; montoAsignadas: number;
    pipeline: { etapa: string; n: number }[];
    proximosCierres: { codigo: string; nombre: string; organismo: string; cierre: string; monto: number | null }[];
    proximosCierresTotal?: number;
  };
  favoritosRecientes: any[];
}

const TZ = 'America/Santiago';
const fmtN = (n: number) => new Intl.NumberFormat('es-CL').format(n);
// Montos grandes en millones («$3.011 MM»); el resto completo. Nunca «B» (en Chile no se entiende).
const fmtMonto = (n: number) =>
  n >= 1_000_000 ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n / 1_000_000)} MM`
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtMontoFull = (n?: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const mayus1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtFecha = (f?: string | null) => {
  if (!f) return '—';
  try { return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: TZ }); } catch { return f; }
};
// «Hoy», «Mañana» o «Jueves 30», en días de CALENDARIO de Chile (nunca ms ÷ 24 h).
function cierreEnPalabras(f?: string | null): { texto: string; color: string } {
  const d = diasCalendarioChile(f);
  if (d == null) return { texto: '—', color: '#64748b' };
  if (d <= 0) return { texto: d < 0 ? 'Cerrada' : 'Hoy', color: '#dc2626' };
  if (d === 1) return { texto: 'Mañana', color: '#dc2626' };
  const texto = mayus1(new Date(f!).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', timeZone: TZ }));
  return { texto, color: d <= 3 ? '#d97706' : '#64748b' };
}

// Viabilidad: manda el nivel de la v4; si la licitación solo tiene el semáforo antiguo, se muestra con su escala.
const NIVEL_V4: Record<string, { label: string; color: string; orden: number }> = {
  MUY_ALTO:   { label: 'Muy alto',   color: '#059669', orden: 0 },
  ALTO:       { label: 'Alto',       color: '#10b981', orden: 1 },
  MEDIO_ALTO: { label: 'Medio alto', color: '#eab308', orden: 2 },
  MEDIO:      { label: 'Medio',      color: '#d97706', orden: 3 },
  MEDIO_BAJO: { label: 'Medio bajo', color: '#f97316', orden: 4 },
  BAJO:       { label: 'Bajo',       color: '#ef4444', orden: 5 },
  EXCLUIDO:   { label: 'Excluido',   color: '#b91c1c', orden: 6 },
};
const SEMAFORO: Record<string, { label: string; color: string; orden: number }> = {
  VERDE:     { label: 'Viable (escala anterior)',     color: '#0d9488', orden: 10 },
  AMARILLO:  { label: 'Media-alta (escala anterior)', color: '#ca8a04', orden: 11 },
  NARANJA:   { label: 'Media (escala anterior)',      color: '#ea580c', orden: 12 },
  ROJO:      { label: 'Baja (escala anterior)',       color: '#ef4444', orden: 13 },
  ROJO_DURO: { label: 'Descartar (escala anterior)',  color: '#b91c1c', orden: 14 },
};
const PREFILTRO: Record<string, { label: string; color: string; orden: number }> = {
  PASA:            { label: 'Pasan al análisis',     color: '#0d9488', orden: 0 },
  REVISION_HUMANA: { label: 'Las revisa una persona', color: '#d97706', orden: 1 },
  EXCLUIDO:        { label: 'Excluidas solas',        color: '#94a3b8', orden: 2 },
};
// Nombre visible de una etapa del pipeline — resuelto desde la fuente de verdad
// (app/lib/pipeline.ts), tolerante a ids legados vía getEstadoPipeline.
const etapaLabel = (id: string) => getEstadoPipeline(id)?.label || id;
const ordenEtapa = (id: string) => { const i = ESTADOS_PIPELINE.findIndex(e => e.id === id); return i < 0 ? 99 : i; };

/** Tarjeta de un bloque del tablero: título, qué mide (siempre visible) y la ficha «cómo se calcula». */
function Panel({ titulo, descripcion, derecha, spec, children }: {
  titulo: string; descripcion?: string; derecha?: React.ReactNode; spec?: EspecificacionMetrica; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-linea bg-white px-4 py-4 shadow-tarjeta dark:border-slate-800 dark:bg-slate-900 @container">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-tinta dark:text-slate-100">
            {titulo}{spec && <MetricInfo spec={spec} />}
          </h2>
          {descripcion && <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">{descripcion}</p>}
        </div>
        {derecha}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const verTodo = 'whitespace-nowrap text-[13px] font-medium text-marca hover:underline';

/** Barras horizontales con cantidad y % de cada fila. Interactivas: al pasar el mouse se resalta la fila y, si se pasa
 *  `onElegir`, el clic la elige (las demás se atenúan) y vuelve a tocar para quitar. */
function BarrasLista({ filas, total, elegido, onElegir }: {
  filas: { clave: string; etiqueta: string; valor: number; color: string }[]; total: number;
  elegido?: string; onElegir?: (clave: string) => void;
}) {
  const max = Math.max(...filas.map(f => f.valor), 1);
  return (
    <ul className="-mx-2 space-y-0.5">
      {filas.map(f => {
        const activo = elegido === f.clave;
        const clases = `block w-full rounded-lg px-2 py-1.5 text-left transition-[background-color,opacity] duration-150 ${elegido && !activo ? 'opacity-40' : ''} ${activo ? 'bg-slate-50 dark:bg-slate-800' : ''}`;
        const contenido = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-tinta dark:text-slate-100">
                <span aria-hidden style={{ backgroundColor: f.color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
                <span className="truncate">{f.etiqueta}</span>
              </span>
              <span className="flex-shrink-0 tabular-nums">
                <span className="font-semibold text-tinta dark:text-slate-100">{fmtN(f.valor)}</span>
                <span className="ml-2 text-xs text-tinta-2 dark:text-slate-400">{total ? Math.round((f.valor / total) * 100) : 0} %</span>
              </span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className="block h-full rounded-full" style={{ width: `${(f.valor / max) * 100}%`, backgroundColor: f.color }} />
            </span>
          </>
        );
        return (
          <li key={f.clave}>
            {onElegir ? (
              <button type="button" aria-pressed={activo} onClick={() => onElegir(activo ? '' : f.clave)}
                className={`${clases} hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800`}>
                {contenido}
              </button>
            ) : <div className={`${clases} hover:bg-slate-50 dark:hover:bg-slate-800`}>{contenido}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage() {
  const { usuario } = useSession();
  const [data, setData] = useState<DashData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tiempo real: el hook escucha el SSE (evento `cambio` de cualquier usuario + campana
  // propia) y recarga; el intervalo y el refresco al volver a la pestaña son el respaldo.
  const cargar = useCallback(() => {
    fetch('/api/dashboard', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.success) { setData(d); setError(null); } else setError(d.error); })
      .catch(() => setError('Error al cargar el dashboard'))
      .finally(() => setCargando(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(cargar, { intervaloMs: 30_000 });

  const hora = Number(new Date().toLocaleString('es-CL', { hour: 'numeric', hour12: false, timeZone: TZ }));
  const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';
  const esAdmin = data?.rol === 'admin' && !!data.admin;
  const fecha = mayus1(new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }));

  return (
    <AppLayout>
      <div className="@container mx-auto max-w-7xl p-5 sm:p-7">
        <Encabezado
          titulo={`${saludo}${nombre ? `, ${nombre}` : ''}`}
          descripcion={fecha}
          acciones={esAdmin ? (
            <Link href="/radar"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-linea bg-white px-3.5 text-sm font-medium text-tinta shadow-tarjeta transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
              <Search size={16} stroke={1.75} className="text-slate-400" /> Ir al radar
            </Link>
          ) : undefined}
        />

        {cargando ? (
          <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <TarjetaCargando key={i} />)}</div>
        ) : error ? (
          <Banner variante="error">{error}</Banner>
        ) : data ? (
          esAdmin ? <VistaAdmin data={data} /> : <VistaUsuario data={data} />
        ) : null}
      </div>
    </AppLayout>
  );
}

function VistaAdmin({ data }: { data: DashData }) {
  const a = data.admin!;
  // Interactividad: la etapa elegida en «Negocios por etapa» filtra «Seguimiento por perfil»; cada persona se abre.
  const router = useRouter();
  const [etapa, setEtapa] = useState('');
  const [perfilAbierto, setPerfilAbierto] = useState<number | null>(null);
  const filasPerfil = a.porPerfil
    .map(p => ({ p, cuenta: etapa ? Number(p.pipeline.find(x => x.etapa === etapa)?.n || 0) : p.total }))
    .filter(x => !etapa || x.cuenta > 0)
    .sort((x, y) => y.cuenta - x.cuenta);

  // Viabilidad: una fila por nivel v4 o, si la licitación solo tiene semáforo antiguo, por semáforo.
  const porNivel = new Map<string, TajadaDona & { orden: number }>();
  for (const v of a.viabilidad) {
    const def = (v.nivel && NIVEL_V4[v.nivel]) || (v.semaforo && SEMAFORO[v.semaforo]) || null;
    const clave = v.nivel && NIVEL_V4[v.nivel] ? `v4:${v.nivel}` : `s:${v.semaforo}`;
    if (!def) continue;
    const previa = porNivel.get(clave);
    if (previa) previa.valor += Number(v.n);
    else porNivel.set(clave, { clave, etiqueta: def.label, valor: Number(v.n), color: def.color, orden: def.orden });
  }
  const viabTajadas = [...porNivel.values()].sort((x, y) => x.orden - y.orden);
  const totalViab = viabTajadas.reduce((s, t) => s + t.valor, 0);

  const pipe = [...a.pipeline].sort((x, y) => ordenEtapa(x.etapa) - ordenEtapa(y.etapa));
  const totalPipe = pipe.reduce((s, p) => s + Number(p.n), 0);

  const pref = [...a.prefiltro].sort((x, y) => (PREFILTRO[x.decision]?.orden ?? 9) - (PREFILTRO[y.decision]?.orden ?? 9));
  const totalPref = pref.reduce((s, p) => s + Number(p.n), 0);
  const sinPrefiltro = Math.max(a.radar.totalLicitaciones - totalPref, 0);
  const prefFilas = [
    ...pref.map(p => ({ clave: p.decision, etiqueta: PREFILTRO[p.decision]?.label || p.decision, valor: Number(p.n), color: PREFILTRO[p.decision]?.color || '#94a3b8' })),
    ...(sinPrefiltro > 0 ? [{ clave: 'sin', etiqueta: 'Todavía sin prefiltro', valor: sinPrefiltro, color: '#cbd5e1' }] : []),
  ];
  const pasan = a.prefiltro.find(p => p.decision === 'PASA')?.n || 0;
  const excluidas = a.prefiltro.find(p => p.decision === 'EXCLUIDO')?.n || 0;
  const porRevisar = a.prefiltro.find(p => p.decision === 'REVISION_HUMANA')?.n || 0;

  // Tendencia: los 14 días completos (los días sin detecciones valen 0, no se omiten).
  const claveChile = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const detectadas = new Map(a.porDia.map(d => [claveChile(new Date(d.dia)), Number(d.n)]));
  const [hy, hm, hd] = claveChile(new Date()).split('-').map(Number);
  const tendencia = Array.from({ length: 14 }, (_, i) => {
    const f = new Date(Date.UTC(hy, hm - 1, hd - (13 - i), 12));
    return {
      dia: f.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
      n: detectadas.get(f.toISOString().slice(0, 10)) ?? 0,
    };
  });
  const totalTendencia = tendencia.reduce((s, d) => s + d.n, 0);

  return (
    <div className="space-y-6">
      {/* Indicadores clave */}
      <Lista className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        <Indicador rotulo="Licitaciones en radar" valor={a.radar.totalLicitaciones} href="/radar"
          detalle="Activas ahora · igual que el radar"
          info={<MetricInfo spec={{
            mide: 'Cuántas licitaciones detectó el radar y siguen activas (todavía no cierran).',
            calculo: 'Cuenta licitaciones únicas de alertas_licitaciones (una fila por match de palabra clave) cuya fecha de cierre aún no pasó, comparada contra la hora de Chile — no contra la hora del servidor.',
            fuente: 'alertas_licitaciones.licitacion_cierre',
            nota: 'Sube cuando el intake automático encuentra nuevas; baja sola a medida que van venciendo — nadie la actualiza a mano.',
          }} />} />
        <Indicador rotulo="Sin asignar" valor={a.radar.sinAsignar} href="/radar?gestion=sin_asignar"
          detalle={`De ${fmtN(a.radar.totalLicitaciones)} activas · por repartir`}
          info={<MetricInfo spec={{
            mide: 'La cola de trabajo pendiente: licitaciones activas del radar que nadie tomó todavía.',
            calculo: 'Del total de "Licitaciones en radar", resta las que ya tienen un negocio asignado, las que ya se descartaron a mano, y las que Mercado Público marcó "Revocada" (ya no se pueden postular aunque sigan con fecha de cierre futura).',
            fuente: 'alertas_licitaciones + negocios (activo) + licitaciones_descartadas',
            nota: 'Al abrir el radar con este filtro puede mostrar unas pocas más: el radar también lista las que Mercado Público marcó «Revocada».',
          }} />} />
        <Indicador rotulo="Usuarios activos" valor={a.usuarios.activos} href="/admin/usuarios"
          detalle={`${fmtN(a.usuarios.total)} en total · +${a.usuarios.nuevosSemana} esta semana`}
          info={<MetricInfo spec={{
            mide: 'Cuántas cuentas del equipo están activas hoy.',
            calculo: 'Cuenta de usuarios con activo = TRUE. El subtítulo suma el total de cuentas (activas o no) y cuántas se crearon en los últimos 7 días.',
            fuente: 'usuarios.activo',
          }} />} />
        {/* El subtítulo nombra los TRES destinos del prefiltro: las que quedan en revisión humana no pueden
            desaparecer, o la tarjeta daría a entender que el prefiltro ya decidió todo. */}
        <Indicador rotulo="Pasan el prefiltro" valor={Number(pasan)} href="/radar?decision=PASA"
          detalle={`${fmtN(Number(excluidas))} excluidas · ${fmtN(Number(porRevisar))} por revisar`}
          info={<MetricInfo spec={{
            mide: 'De las licitaciones activas del radar, cuántas pasaron el filtro automático (previo a la IA). Cuenta también las que después se descartaron a mano o se asignaron a alguien.',
            calculo: 'Cruza el universo de "Licitaciones en radar" contra prefiltro_licitacion.decision. El filtro tiene 3 salidas posibles: PASA (sigue a viabilidad), EXCLUIDO (se descarta sola) y REVISION_HUMANA (no se anima a decidir, alguien la mira).',
            fuente: 'prefiltro_licitacion.decision',
            nota: 'El número es lo que dijo el filtro automático, no lo que sigue disponible: muchas ya se descartaron o se asignaron. En el radar, «Sin asignar» muestra solo las que nadie ha tomado.',
          }} />} />
      </Lista>

      {/* Analítica de gestión INTERACTIVA (pipeline · descartes · postuladas) */}
      <AnaliticaGestion />

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <Panel titulo="Licitaciones detectadas por día"
          descripcion={`${fmtN(totalTendencia)} licitaciones nuevas en los últimos 14 días`}
          spec={{
            mide: 'Cuántas licitaciones nuevas detectó el radar cada día, últimos 14 días (los días sin detecciones valen 0).',
            calculo: 'Cuenta de licitaciones únicas agrupadas por el día en que aparecieron por primera vez en alertas_licitaciones.',
            fuente: 'alertas_licitaciones.created_at',
          }}>
          {totalTendencia > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tendencia} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="n" name="Licitaciones nuevas" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Vacio titulo="Sin detecciones en los últimos 14 días" texto="Cuando el radar encuentre licitaciones nuevas aparecerán aquí." />}
        </Panel>

        <Panel titulo="Viabilidad de las licitaciones analizadas"
          descripcion={totalViab > 0
            ? `${fmtN(totalViab)} de las ${fmtN(a.radar.totalLicitaciones)} activas del radar ya tienen análisis de IA`
            : 'Ninguna licitación activa del radar tiene análisis todavía'}
          spec={{
            mide: 'De las licitaciones activas del radar que ya tienen análisis de IA, cuántas salieron en cada nivel de viabilidad.',
            calculo: 'Cuenta agrupada por el nivel de la viabilidad v4 (nivel_atractivo); si una licitación solo tiene la escala anterior, se cuenta por su semáforo y se rotula «escala anterior». Solo cuenta las que YA se analizaron — no todo el radar tiene análisis.',
            fuente: 'viabilidad_licitacion.nivel_atractivo / semaforo',
          }}>
          {totalViab > 0 ? (
            <Dona tajadas={viabTajadas} centroValor={fmtN(totalViab)} centroTexto="analizadas"
              descripcion={`Reparto de ${totalViab} licitaciones analizadas por nivel de viabilidad`} />
          ) : <Vacio titulo="Aún sin análisis de viabilidad" texto="Se llena a medida que la IA analiza las licitaciones del radar." />}
        </Panel>

        <Panel titulo="Negocios por etapa"
          descripcion={`${fmtN(totalPipe)} negocios activos · incluye ganados, perdidos, desiertos y revocados; sin descartados. Toca una etapa para ver quién la tiene.`}
          derecha={<Link href={etapa ? `/negocios?estado=${encodeURIComponent(etapa)}` : '/negocios'} className={verTodo}>{etapa ? `Ver ${etapaLabel(etapa).toLowerCase()} en Negocios` : 'Ver negocios'}</Link>}
          spec={{
            mide: 'En qué etapa del pipeline está cada negocio activo de la empresa (todos los perfiles), incluidos los que ya terminaron.',
            calculo: 'Cuenta de negocios activos agrupada por estado_pipeline, sin contar las Descartada (esas ya no se "trabajan"). Ganadas, perdidas, desiertas y revocadas SÍ entran: son parte del historial, no carga de trabajo.',
            fuente: 'negocios.estado_pipeline',
          }}>
          {totalPipe > 0 ? (
            <BarrasLista total={totalPipe} elegido={etapa} onElegir={setEtapa}
              filas={pipe.map(p => ({ clave: p.etapa, etiqueta: etapaLabel(p.etapa), valor: Number(p.n), color: getEstadoPipeline(p.etapa)?.color || '#94a3b8' }))} />
          ) : <Vacio titulo="Sin negocios activos" texto="Cuando asignes una licitación aparecerá en su etapa." />}
        </Panel>

        <Panel titulo="Prefiltro automático"
          descripcion={`Qué pasó con las ${fmtN(a.radar.totalLicitaciones)} licitaciones activas del radar antes de la IA · toca una fila para verlas en el radar`}
          spec={{
            mide: 'Los 3 destinos posibles del filtro automático, sobre las licitaciones activas del radar.',
            calculo: 'prefiltro_licitacion.decision agrupado (PASA / REVISION_HUMANA / EXCLUIDO) sobre el universo activo del radar. «Todavía sin prefiltro» son las activas que aún no tienen decisión.',
            fuente: 'prefiltro_licitacion.decision',
          }}>
          {prefFilas.length > 0 ? (
            <BarrasLista total={a.radar.totalLicitaciones} filas={prefFilas} onElegir={k => { if (k && k !== 'sin') router.push(`/radar?decision=${encodeURIComponent(k)}`); }} />
          ) : <Vacio titulo="Sin prefiltro" texto="Todavía no hay licitaciones activas con decisión del filtro." />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <ProximosCierres items={data.usuario.proximosCierres} total={data.usuario.proximosCierresTotal} titulo="Próximos cierres (empresa)" />
        <Panel titulo="Últimos accesos" descripcion="Quién entró más recientemente al sistema"
          derecha={<Link href="/admin/usuarios" className={verTodo}>Gestionar</Link>}
          spec={{
            mide: 'Quién entró más recientemente al sistema.',
            calculo: 'Usuarios ordenados por último login (o por fecha de creación de la cuenta si nunca ha entrado), top 6.',
            fuente: 'usuarios.ultimo_login',
          }}>
          <ul className="divide-y divide-linea dark:divide-slate-800">
            {a.usuarios.ultimosAccesos.map((u: any) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span style={{ background: colorUsuario(u.email || u.id) }}
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white">
                    {inicialesUsuario(u.nombre, u.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-tinta dark:text-slate-100">{u.nombre || u.email}</p>
                    <p className="truncate text-xs text-tinta-2 dark:text-slate-400">{u.email}</p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs text-tinta-2 dark:text-slate-400">
                  {u.rol === 'admin' && <span>Admin</span>}
                  <span className="tabular-nums">{fmtFecha(u.ultimo_login)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Seguimiento por perfil: cada usuario, su carga, su flujo y sus descartadas. Interactivo: la etapa elegida arriba
          filtra quién la tiene y cada persona se abre para ver su reparto por etapa (y elegir una de sus etapas). */}
      {(a.porPerfil?.length ?? 0) > 0 && (
        <Panel titulo="Seguimiento por perfil"
          descripcion={etapa
            ? `Quién tiene negocios en «${etapaLabel(etapa)}»: ${fmtN(filasPerfil.reduce((s, x) => s + x.cuenta, 0))} en total`
            : 'Negocios activos de cada analista y cómo se reparten por etapa · toca una persona para ver el detalle'}
          derecha={etapa ? (
            <button type="button" onClick={() => setEtapa('')}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-linea bg-white px-2 text-xs font-medium text-tinta-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {etapaLabel(etapa)} <X size={12} stroke={1.75} className="text-slate-400" />
            </button>
          ) : <Link href="/analisis-licitacion" className={verTodo}>Ver análisis</Link>}
          spec={{
            mide: 'La carga de cada analista: cuántos negocios activos tiene, en qué etapas están repartidos, cuánto monto publicado suman y cuántos descartó.',
            calculo: 'Negocios activos agrupados por asignado_a. El número grande es el total sin descartadas (incluye los ya ganados o perdidos); la barra muestra la proporción por etapa; «descartadas» se cuentan aparte y no suman al total. Si eliges una etapa en «Negocios por etapa», el número pasa a ser solo los de esa etapa y el monto se oculta (el monto se calcula por persona, no por etapa). El monto es el presupuesto que publica Mercado Público, no lo que ofertamos.',
            fuente: 'negocios.asignado_a + estado_pipeline + licitacion_monto',
          }}>
          {filasPerfil.length > 0 ? (
            <ul className="-mx-2 divide-y divide-linea dark:divide-slate-800">
              {filasPerfil.map(({ p, cuenta }) => {
                const abierto = perfilAbierto === p.id;
                const detalle = [...p.pipeline].sort((x, y) => ordenEtapa(x.etapa) - ordenEtapa(y.etapa));
                return (
                  <li key={p.id}>
                    <button type="button" aria-expanded={abierto} onClick={() => setPerfilAbierto(abierto ? null : p.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
                      <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ background: colorUsuario(p.email || p.id) }}>
                        {inicialesUsuario(p.nombre, p.email)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-3">
                          <span className="truncate text-[13px] font-medium text-tinta dark:text-slate-100">{p.nombre || p.email}</span>
                          {p.descartadas > 0 && <span className="text-xs text-tinta-2 dark:text-slate-400">{fmtN(p.descartadas)} descartadas</span>}
                        </span>
                        {!etapa && <MiniFlujo pipeline={p.pipeline} />}
                      </span>
                      <span className="flex-shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtN(cuenta)}</span>
                        <span className="block text-xs tabular-nums text-tinta-2 dark:text-slate-400">{etapa ? `de ${fmtN(p.total)}` : fmtMonto(p.monto)}</span>
                      </span>
                      <ChevronDown size={16} stroke={1.75} className={`flex-shrink-0 text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
                    </button>
                    {abierto && (
                      <div className="pb-3 pl-[3.25rem] pr-2">
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] text-tinta-2 dark:text-slate-400">Negocios por etapa · toca una para ver quién más la tiene</p>
                          {p.email && <Link href={`/negocios?analista=${encodeURIComponent(p.email)}${etapa ? `&estado=${encodeURIComponent(etapa)}` : ''}`} className={verTodo}>Ver sus negocios</Link>}
                        </div>
                        <ul className="flex flex-wrap gap-x-2 gap-y-1">
                          {detalle.map(x => (
                            <li key={x.etapa}>
                              <button type="button" onClick={() => setEtapa(x.etapa)}
                                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-linea bg-white px-2 text-xs text-tinta-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                <Estado color={getEstadoPipeline(x.etapa)?.color || '#94a3b8'}>{etapaLabel(x.etapa)}</Estado>
                                <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmtN(Number(x.n))}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <Vacio titulo={`Nadie tiene negocios en «${etapaLabel(etapa)}»`} texto="Quita el filtro para ver a todo el equipo."
              accion={<button type="button" onClick={() => setEtapa('')} className="inline-flex h-8 items-center rounded-lg border border-linea bg-white px-3 text-[13px] font-medium text-tinta shadow-tarjeta hover:bg-slate-50">Ver a todo el equipo</button>} />}
        </Panel>
      )}
    </div>
  );
}

// Barra apilada del flujo (pipeline) con los colores canónicos de cada etapa.
function MiniFlujo({ pipeline }: { pipeline: { etapa: string; n: number }[] }) {
  const total = pipeline.reduce((s, p) => s + p.n, 0) || 1;
  const items = [...pipeline].sort((a, b) => ordenEtapa(a.etapa) - ordenEtapa(b.etapa));
  return (
    <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {items.map(p => {
        const e = getEstadoPipeline(p.etapa);
        return <div key={p.etapa} style={{ width: `${(p.n / total) * 100}%`, background: e?.color || '#94a3b8' }} title={`${e?.label || p.etapa}: ${p.n}`} />;
      })}
    </div>
  );
}

function VistaUsuario({ data }: { data: DashData }) {
  const u = data.usuario;
  const pipe = [...u.pipeline].sort((a, b) => ordenEtapa(a.etapa) - ordenEtapa(b.etapa));
  const totalPipe = pipe.reduce((s, p) => s + p.n, 0);
  const tajadas: TajadaDona[] = pipe.map(p => ({ clave: p.etapa, etiqueta: etapaLabel(p.etapa), valor: Number(p.n), color: getEstadoPipeline(p.etapa)?.color || '#94a3b8' }));

  return (
    <div className="space-y-6">
      <Lista className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        <Indicador rotulo="Mis negocios" valor={u.asignadas} href="/negocios" detalle="Asignados · sin descartadas"
          info={<MetricInfo spec={{
            mide: 'Cuántas licitaciones tienes asignadas ahora mismo.',
            calculo: 'Cuenta de negocios donde asignado_a eres tú y activo = TRUE, sin contar las que descartaste.',
            fuente: 'negocios.asignado_a',
          }} />} />
        <Indicador rotulo="Monto en gestión" valor={u.montoAsignadas} formato={fmtMonto} detalle="Presupuesto publicado en mis licitaciones"
          info={<MetricInfo spec={{
            mide: 'El presupuesto que publica Mercado Público en tus licitaciones asignadas — no lo que vas a cotizar.',
            calculo: 'Suma de licitacion_monto de tus negocios activos, sin descartadas.',
            fuente: 'negocios.licitacion_monto',
          }} />} />
        <Indicador rotulo="Próximos cierres" valor={u.proximosCierresTotal ?? u.proximosCierres.length} detalle="Licitaciones que aún no cierran"
          info={<MetricInfo spec={{
            mide: 'Cuántas de tus licitaciones todavía no cierran.',
            calculo: 'Cuenta de tus negocios activos con fecha de cierre futura (hora de Chile), sin descartadas. La lista de abajo muestra las 6 más cercanas.',
            fuente: 'negocios.licitacion_cierre',
          }} />} />
      </Lista>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <Panel titulo="Mis negocios por etapa"
          descripcion={totalPipe > 0 ? `${fmtN(totalPipe)} negocios activos · sin descartados` : undefined}
          derecha={<Link href="/negocios" className={verTodo}>Ver negocios</Link>}>
          {totalPipe > 0 ? (
            <>
              <MiniFlujo pipeline={u.pipeline} />
              <div className="mt-4">
                <Dona tajadas={tajadas} centroValor={fmtN(totalPipe)} centroTexto="negocios"
                  descripcion={`Reparto de ${totalPipe} negocios por etapa`} />
              </div>
            </>
          ) : (
            <Vacio titulo="Aún no tienes licitaciones asignadas" texto="Cuando te asignen una, la verás aquí con su etapa." />
          )}
        </Panel>

        <ProximosCierres items={u.proximosCierres} total={u.proximosCierresTotal} titulo="Mis próximos cierres" />
      </div>
    </div>
  );
}

function ProximosCierres({ items, total, titulo }: { items: DashData['usuario']['proximosCierres']; total?: number; titulo: string }) {
  return (
    <Panel titulo={titulo}
      descripcion="Las que cierran antes, para no dejar pasar el plazo"
      derecha={total && total > items.length ? <span className="text-xs tabular-nums text-tinta-2 dark:text-slate-400">{items.length} de {fmtN(total)}</span> : undefined}
      spec={{
        mide: 'Las licitaciones que están por cerrar antes, para no dejar pasar el plazo.',
        calculo: 'Negocios activos con fecha de cierre futura, ordenados de la más próxima a la más lejana, hasta 6. El día se cuenta en días de calendario de Chile.',
        fuente: 'negocios.licitacion_cierre',
      }}>
      {items.length > 0 ? (
        <ul className="-mx-2 divide-y divide-linea dark:divide-slate-800">
          {items.map((it, i) => {
            const c = cierreEnPalabras(it.cierre);
            return (
              <li key={`${it.codigo}-${i}`}>
                <Link href={`/licitacion/${encodeURIComponent(it.codigo)}`}
                  className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-tinta group-hover:text-marca dark:text-slate-100">{it.nombre || it.codigo}</p>
                    <p className="truncate text-xs text-tinta-2 dark:text-slate-400">{it.organismo || it.codigo}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3 text-xs tabular-nums">
                    {it.monto ? <span className="text-tinta-2 dark:text-slate-400">{fmtMontoFull(it.monto)}</span> : null}
                    <span className="font-medium text-tinta dark:text-slate-100"><Estado color={c.color}>{c.texto}</Estado></span>
                    <ChevronRight size={16} stroke={1.75} className="text-slate-400" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Vacio titulo="Sin cierres próximos" texto="No hay licitaciones activas con fecha de cierre futura." />
      )}
    </Panel>
  );
}
