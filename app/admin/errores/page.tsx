'use client';

// Bandeja de errores reportados por los perfiles con el botón flotante "Reportar error"
// (components/ReportarErrorBoton). Solo admin (proxy.ts bloquea /admin/*). Cada reporte trae la
// captura marcada, la observación del usuario y el contexto técnico (navegador, errores de
// consola). El admin lo pasa a "En revisión" y lo cierra como Resuelto (escribiendo cómo se
// solucionó) o Descartado (escribiendo por qué). En cada cambio de estado al que lo reportó le
// llega aviso; el switch "Visible para" decide si ve el TEXTO de la solución o si queda solo
// para los administradores (migration-124). Al anotar/cerrar, el admin puede adjuntar archivos de
// respaldo (PDF, Word, TXT, imágenes…; subirlos o pegar una captura con Ctrl+V) que quien lo
// reportó ve con el ícono de ojo en /mis-reportes (migration-148).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { IconBug as Bug, IconLoader2 as Loader2, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconDeviceFloppy as Save, IconPaperclip as Paperclip } from '@tabler/icons-react';
import { AdjuntosReporte, pesoLegible, type AdjuntoReporte } from '@/app/components/AdjuntosReporte';
import { useToast } from '@/app/components/ui/toast';
import { Switch } from '@/app/components/ui/Switch';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Estado as EstadoPunto } from '@/app/components/ui/kit/Tarjeta';

type Estado = 'abierto' | 'en_revision' | 'resuelto' | 'descartado';
interface Reporte {
  id: number;
  usuario_nombre: string | null;
  usuario_email: string | null;
  url: string;
  titulo: string;
  que_paso: string;
  que_esperaba: string;
  pasos: string | null;
  gravedad: 'bloqueante' | 'alta' | 'media' | 'baja';
  imagen_url: string | null;
  contexto: { tituloPagina?: string; navegador?: string; pantalla?: string; tema?: string; erroresConsola?: string[] } | string | null;
  estado: Estado;
  solucion: string | null;
  solucion_visible: number | boolean;
  adjuntos: AdjuntoReporte[];
  resuelto_por_nombre: string | null;
  resuelto_at: string | null;
  created_at: string;
}

const ESTADOS: { key: Estado; label: string; color: string }[] = [
  { key: 'abierto',     label: 'Abierto',     color: '#dc2626' },
  { key: 'en_revision', label: 'En revisión', color: '#d97706' },
  { key: 'resuelto',    label: 'Resuelto',    color: '#16a34a' },
  { key: 'descartado',  label: 'Descartado',  color: '#64748b' },
];
const GRAVEDAD_COLOR: Record<Reporte['gravedad'], string> = {
  bloqueante: '#dc2626',
  alta: '#ea580c',
  media: '#d97706',
  baja: '#94a3b8',
};
const GRAVEDAD_TEXTO: Record<Reporte['gravedad'], string> = { bloqueante: 'Bloqueante', alta: 'Alta', media: 'Media', baja: 'Baja' };
const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const estadoInfo = (e: Estado) => ESTADOS.find(x => x.key === e)!;
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
const ctx = (r: Reporte) => (typeof r.contexto === 'string' ? (() => { try { return JSON.parse(r.contexto as string); } catch { return null; } })() : r.contexto) || {};

export default function ErroresReportadosPage() {
  const toast = useToast();
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<'pendientes' | Estado | 'todos'>('pendientes');
  const [selId, setSelId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/admin/reportes-error').then(r => r.json());
      if (d.success) setReportes(d.reportes || []);
    } catch { /* silencioso */ } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    return suscribirRealtime(ev => {
      if (ev.tipo === 'cambio' || (ev.tipo === 'notificacion' && (ev.datos as { tipo?: string })?.tipo === 'REPORTE_ERROR')) cargar();
    });
  }, [cargar]);

  const visibles = useMemo(() => reportes.filter(r =>
    filtro === 'todos' ? true : filtro === 'pendientes' ? r.estado === 'abierto' || r.estado === 'en_revision' : r.estado === filtro,
  ), [reportes, filtro]);
  const sel = reportes.find(r => r.id === selId) ?? visibles[0] ?? null;
  const cuenta = (f: typeof filtro) => reportes.filter(r =>
    f === 'todos' ? true : f === 'pendientes' ? r.estado === 'abierto' || r.estado === 'en_revision' : r.estado === f).length;

  return (
    <AppLayout breadcrumb={[{ label: 'Admin', href: '/admin/usuarios' }, { label: 'Errores reportados' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Errores reportados"
          descripcion="Lo que los perfiles reportan con el botón rojo flotante: captura marcada + observación. Resuélvelos dejando escrito cómo se solucionó."
        />

        <div className="mb-4 overflow-x-auto">
          <Pestanas id="errores" valor={filtro} onCambio={f => { setFiltro(f); setSelId(null); }}
            opciones={(['pendientes', 'abierto', 'en_revision', 'resuelto', 'descartado', 'todos'] as const).map(f => ({
              valor: f, etiqueta: f === 'pendientes' ? 'Pendientes' : f === 'todos' ? 'Todos' : estadoInfo(f).label, contador: cuenta(f),
            }))} />
        </div>

        {cargando ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Esqueleto key={i} className="h-16 rounded-xl" />)}</div>
        ) : visibles.length === 0 ? (
          <Vacio icono={<CheckCircle size={28} stroke={1.75} />} titulo="No hay reportes en esta vista" texto="Cuando alguien reporte un error con el botón rojo, aparecerá aquí." />
        ) : (
          <div className="grid grid-cols-1 @6xl:grid-cols-[360px_1fr] gap-4 items-start">
            <div className={`${SUPERFICIE} divide-y divide-linea dark:divide-slate-800 overflow-hidden`}>
              {visibles.map(r => (
                <button key={r.id} onClick={() => setSelId(r.id)} aria-pressed={sel?.id === r.id}
                  className={`w-full text-left px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca/60 ${sel?.id === r.id ? 'bg-marca-suave dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                  <div className="flex items-center gap-3 mb-1 text-xs">
                    <span className="font-medium text-tinta dark:text-slate-200"><EstadoPunto color={GRAVEDAD_COLOR[r.gravedad]}>{GRAVEDAD_TEXTO[r.gravedad]}</EstadoPunto></span>
                    <span className="font-medium text-tinta-2 dark:text-slate-300"><EstadoPunto color={estadoInfo(r.estado).color}>{estadoInfo(r.estado).label}</EstadoPunto></span>
                    <span className="ml-auto text-tinta-2 dark:text-slate-400 tabular-nums">#{r.id} · {fecha(r.created_at)}</span>
                  </div>
                  <p className="text-[13px] font-medium text-tinta dark:text-slate-100 line-clamp-1">{r.titulo}</p>
                  <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{r.usuario_nombre || r.usuario_email} · {new URL(r.url, 'http://x').pathname}</p>
                </button>
              ))}
            </div>
            {sel && <DetalleReporte key={sel.id} r={sel} onGuardado={cargar} toast={toast} />}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function DetalleReporte({ r, onGuardado, toast }: { r: Reporte; onGuardado: () => Promise<void>; toast: ReturnType<typeof useToast> }) {
  const [estado, setEstado] = useState<Estado>(r.estado);
  const [solucion, setSolucion] = useState(r.solucion || '');
  const [visible, setVisible] = useState(r.solucion_visible !== 0 && r.solucion_visible !== false);
  const [guardando, setGuardando] = useState(false);
  // Adjuntos: archivos nuevos por subir y ids de los ya guardados que se van a quitar.
  const [nuevos, setNuevos] = useState<File[]>([]);
  const [quitados, setQuitados] = useState<number[]>([]);
  const guardados = r.adjuntos.filter(a => !quitados.includes(a.id));
  const agregarArchivos = (fs: File[]) => {
    const ok = fs.filter(f => f.size <= 10 * 1024 * 1024);
    if (ok.length < fs.length) toast.error('Hay archivos de más de 10 MB', 'Se omitieron.');
    setNuevos(prev => [...prev, ...ok].slice(0, 5));
  };
  // Cerrado (resuelto/descartado) se muestra como tarjeta de solo lectura: antes el formulario
  // quedaba igual tras guardar y parecía que no se había guardado nada (23-sep-2026).
  const cerradoEnBD = r.estado === 'resuelto' || r.estado === 'descartado';
  const [editando, setEditando] = useState(!cerradoEnBD);
  const c = ctx(r);
  const cierra = estado === 'resuelto' || estado === 'descartado';
  const faltaSolucion = cierra && solucion.trim().length < 10;

  const guardar = async () => {
    setGuardando(true);
    try {
      const fd = new FormData();
      fd.append('estado', estado);
      fd.append('solucion', solucion);
      fd.append('solucion_visible', visible ? '1' : '0');
      fd.append('quitar_adjuntos', JSON.stringify(quitados));
      for (const f of nuevos) fd.append('archivos', f, f.name);
      const res = await fetch(`/api/admin/reportes-error/${r.id}`, { method: 'PATCH', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || `Error ${res.status}`);
      toast.success(cierra ? 'Reporte cerrado y guardado' : 'Reporte actualizado',
        d.avisado ? `Se le avisó a ${r.usuario_nombre || 'quien lo reportó'}.` : undefined);
      await onGuardado();
      setNuevos([]); setQuitados([]);
      if (cierra) setEditando(false);
    } catch (e) {
      toast.error('No se pudo guardar', String((e as Error).message || e));
    } finally { setGuardando(false); }
  };

  const bloque = `${SUPERFICIE} p-5`;
  const titulo = 'text-xs font-medium text-tinta-2 dark:text-slate-400 mb-1';
  const texto = 'text-[13px] text-tinta dark:text-slate-200 whitespace-pre-wrap';

  return (
    <div className="space-y-4 min-w-0">
      <div className={bloque}>
        <div className="flex items-start gap-2 mb-2">
          <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 flex-1">{r.titulo}</h2>
          <span className="text-xs font-medium text-tinta dark:text-slate-200"><EstadoPunto color={GRAVEDAD_COLOR[r.gravedad]}>{GRAVEDAD_TEXTO[r.gravedad]}</EstadoPunto></span>
        </div>
        <p className="text-xs text-tinta-2 dark:text-slate-400">
          Reportado por <b className="font-semibold text-tinta dark:text-slate-200">{r.usuario_nombre || r.usuario_email}</b> ({r.usuario_email}) · {fecha(r.created_at)}
        </p>
        <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-marca hover:underline inline-flex items-center gap-1 break-all mt-1">
          {r.url} <ExternalLink size={14} stroke={1.75} className="flex-shrink-0" />
        </a>
      </div>

      {r.imagen_url && (
        <a href={r.imagen_url} target="_blank" rel="noreferrer" className="block" title="Abrir captura en tamaño completo">
          <img src={r.imagen_url} alt={`Captura del reporte #${r.id}`} className="w-full rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta" />
        </a>
      )}

      <div className={`${bloque} grid gap-4 @2xl:grid-cols-2`}>
        <div><p className={titulo}>Qué pasó</p><p className={texto}>{r.que_paso}</p></div>
        <div><p className={titulo}>Qué esperaba</p><p className={texto}>{r.que_esperaba}</p></div>
        {r.pasos && <div className="@2xl:col-span-2"><p className={titulo}>Qué estaba haciendo</p><p className={texto}>{r.pasos}</p></div>}
      </div>

      <details className={bloque}>
        <summary className="text-[13px] font-medium text-tinta dark:text-slate-200 cursor-pointer">
          Contexto técnico {c.erroresConsola?.length ? `· ${c.erroresConsola.length} error(es) de consola` : ''}
        </summary>
        <div className="mt-3 space-y-1 text-xs text-tinta-2 dark:text-slate-400">
          {c.tituloPagina && <p><b>Página:</b> {c.tituloPagina}</p>}
          {c.pantalla && <p><b>Pantalla:</b> {c.pantalla} · tema {c.tema}</p>}
          {c.navegador && <p className="break-all"><b>Navegador:</b> {c.navegador}</p>}
          {c.erroresConsola?.length ? (
            <pre className="mt-2 p-2 rounded-lg bg-slate-900 text-red-300 text-xs overflow-x-auto whitespace-pre-wrap">{c.erroresConsola.join('\n')}</pre>
          ) : <p className="text-tinta-2">Sin errores de JavaScript registrados en la pestaña.</p>}
        </div>
      </details>

      <div className={bloque}>
        <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">Gestión</h3>
        {!editando && cerradoEnBD ? (
          <div className="rounded-lg border border-linea p-3.5 dark:border-slate-800">
            <p className="text-[13px] font-medium text-tinta dark:text-slate-100 flex items-center gap-1.5">
              <CheckCircle size={16} stroke={1.75} className={r.estado === 'resuelto' ? 'text-exito' : 'text-slate-400'} />
              {estadoInfo(r.estado).label} por {r.resuelto_por_nombre} el {fecha(r.resuelto_at)}
            </p>
            <p className="text-xs font-medium text-tinta-2 dark:text-slate-400 mt-3 mb-1">
              {r.estado === 'resuelto' ? 'Cómo se solucionó' : 'Por qué se descartó'}
            </p>
            <p className="text-[13px] text-tinta dark:text-slate-200 whitespace-pre-wrap">{r.solucion}</p>
            {r.adjuntos.length > 0 && <div className="mt-3"><AdjuntosReporte adjuntos={r.adjuntos} /></div>}
            <p className="text-xs text-tinta-2 dark:text-slate-400 mt-3">
              {visible
                ? `${r.usuario_nombre || 'Quien lo reportó'} ve este texto en "Mis reportes".`
                : `Solo administradores: ${r.usuario_nombre || 'quien lo reportó'} ve el estado, pero no este texto.`}
            </p>
            <Boton className="mt-3" tamano="sm" onClick={() => setEditando(true)}>Editar / reabrir</Boton>
          </div>
        ) : (<>
        {r.resuelto_at && (
          <p className="text-xs text-tinta-2 dark:text-slate-400 mb-3">
            {estadoInfo(r.estado).label} por <b>{r.resuelto_por_nombre}</b> el {fecha(r.resuelto_at)}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ESTADOS.map(e => (
            <button key={e.key} onClick={() => setEstado(e.key)} aria-pressed={estado === e.key}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${estado === e.key
                ? 'border-marca bg-marca-suave text-marca' : 'border-linea text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              <span aria-hidden style={{ backgroundColor: e.color }} className="h-1.5 w-1.5 rounded-full" />
              {e.label}
            </button>
          ))}
        </div>
        <label className="block text-[13px] font-medium text-tinta dark:text-slate-200 mb-1">
          {estado === 'descartado' ? 'Por qué se descarta' : estado === 'resuelto' ? 'Cómo se solucionó' : 'Notas / cómo se está solucionando'}
        </label>
        <textarea value={solucion} onChange={e => setSolucion(e.target.value)} rows={4}
          onPaste={e => {
            const fs = Array.from(e.clipboardData.files);
            if (fs.length) { e.preventDefault(); agregarArchivos(fs); }
          }}
          placeholder="Ej: El guardado fallaba porque el precio venía con puntos de miles; se corrigió el parser y se re-guardaron los 3 costeos afectados."
          className="w-full rounded-lg border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[13px] text-tinta dark:text-slate-100 placeholder:text-tinta-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
        {faltaSolucion && <p className="text-xs text-alerta mt-1">Escribe al menos 10 caracteres para cerrarlo.</p>}
        <div className="mt-3 space-y-2">
          <AdjuntosReporte adjuntos={guardados} onQuitar={a => setQuitados(q => [...q, a.id])} />
          {nuevos.length > 0 && (
            <ul className="space-y-1">
              {nuevos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-300">
                  <Paperclip size={16} stroke={1.75} className="text-exito" /> <span className="truncate">{f.name}</span>
                  <span className="text-xs text-tinta-2">{pesoLegible(f.size)} · se sube al guardar</span>
                  <button type="button" onClick={() => setNuevos(n => n.filter((_, j) => j !== i))} className="ml-auto text-xs font-medium text-urgente hover:underline">Quitar</button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex h-9 items-center gap-2 cursor-pointer rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 text-[13px] font-medium text-tinta-2 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Paperclip size={16} stroke={1.75} /> Adjuntar archivos de respaldo
            <input type="file" multiple className="hidden" data-testid="adjuntar-archivos"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.csv"
              onChange={e => { agregarArchivos(Array.from(e.target.files || [])); e.target.value = ''; }} />
          </label>
          <p className="text-xs text-tinta-2 dark:text-slate-400">Opcional · PDF, Word, Excel, TXT o imágenes · hasta 5 archivos de 10 MB. También puedes pegar una captura con Ctrl+V dentro del texto. Siguen la misma visibilidad que la solución.</p>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <Switch checked={visible} onChange={() => setVisible(v => !v)} label="Solución visible para quien lo reportó" />
          <span className="text-[13px] text-tinta dark:text-slate-200">
            {visible
              ? <>Visible para <b>todos</b> — {r.usuario_nombre || 'quien lo reportó'} verá este texto</>
              : <><b>Solo administradores</b> — {r.usuario_nombre || 'quien lo reportó'} recibe el aviso del estado, sin el texto</>}
          </span>
        </div>
        <Boton variante="primario" className="mt-3" onClick={guardar}
          disabled={guardando || faltaSolucion || (estado === r.estado && solucion.trim() === (r.solucion || '') && visible === (r.solucion_visible !== 0 && r.solucion_visible !== false) && nuevos.length === 0 && quitados.length === 0)}
          icono={guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} stroke={1.75} />}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
        </>)}
      </div>
    </div>
  );
}
