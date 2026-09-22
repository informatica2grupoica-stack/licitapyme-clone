'use client';

// Botón flotante "Reportar error" (22-sep-2026). Visible para todo perfil logueado, en cualquier
// página. Al apretarlo:
//   1. Saca una captura de la pantalla TAL CUAL se ve en ese momento (modern-screenshot rasteriza
//      el DOM; `restoreScrollPosition` respeta el scroll del <main>, que es el que se mueve en la
//      app, no la ventana).
//   2. Abre un editor a pantalla completa donde el usuario MARCA el error (recuadro o lápiz) y
//      llena una observación detallada. No se puede enviar sin al menos una marca ni sin detalle:
//      el pedido fue que el reporte "demuestre el error".
//   3. Envía todo a /api/reportes-error → llega a todos los admin (campana) y a /admin/errores.
// Además junta en segundo plano los últimos errores de JavaScript de la pestaña, que viajan en el
// contexto del reporte: al admin le sirven para encontrar la causa sin tener que reproducirlo.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { domToCanvas } from 'modern-screenshot';
import { IconBug as Bug, IconSquare as Square, IconPencil as Pencil, IconArrowBackUp as Undo, IconTrash as Trash2, IconX as X, IconLoader2 as Loader2, IconSend as Send } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';

type Marca =
  | { tipo: 'rect'; x: number; y: number; w: number; h: number }
  | { tipo: 'lapiz'; pts: [number, number][] };

const COLOR = '#ef4444';
const MIN_QUE_PASO = 30;       // mismos mínimos que valida /api/reportes-error
const MIN_QUE_ESPERABA = 15;
const RUTAS_SIN_BOTON = ['/login', '/bienvenida', '/recuperar', '/restablecer'];

// Errores recientes de la pestaña (módulo, no estado: se acumulan desde que carga la app).
const erroresRecientes: string[] = [];
let colectorInstalado = false;
function instalarColector() {
  if (colectorInstalado || typeof window === 'undefined') return;
  colectorInstalado = true;
  const guardar = (s: string) => {
    erroresRecientes.push(`${new Date().toLocaleTimeString('es-CL')} ${s}`.slice(0, 500));
    if (erroresRecientes.length > 15) erroresRecientes.shift();
  };
  window.addEventListener('error', e => guardar(`[error] ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => guardar(`[promesa] ${String(e.reason?.message ?? e.reason)}`));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    try { guardar(`[console] ${args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`); } catch { /* nunca romper console.error */ }
    original.apply(console, args);
  };
}

function dibujar(ctx: CanvasRenderingContext2D, m: Marca, grosor: number) {
  ctx.strokeStyle = COLOR;
  ctx.lineWidth = grosor;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (m.tipo === 'rect') {
    ctx.fillStyle = 'rgba(239,68,68,0.10)';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  } else if (m.pts.length > 1) {
    ctx.beginPath();
    ctx.moveTo(m.pts[0][0], m.pts[0][1]);
    for (const [x, y] of m.pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
}

export function ReportarErrorBoton() {
  const { usuario } = useSession();
  const pathname = usePathname();
  const { activo: costeoActivo } = useCosteoFlotante();
  const [capturando, setCapturando] = useState(false);
  const [captura, setCaptura] = useState<HTMLCanvasElement | null>(null);
  const [urlCapturada, setUrlCapturada] = useState('');

  useEffect(() => { instalarColector(); }, []);

  if (!usuario || RUTAS_SIN_BOTON.some(r => pathname?.startsWith(r))) return null;

  const capturar = async () => {
    setCapturando(true);
    try {
      const canvas = await domToCanvas(document.body, {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: 1,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        features: { restoreScrollPosition: true },
        // El propio botón no debe salir en la foto.
        filter: n => !(n instanceof HTMLElement && n.dataset.reporteErrorIgnorar != null),
      });
      setUrlCapturada(window.location.href);
      setCaptura(canvas);
    } catch (e) {
      console.warn('[reportar-error] captura falló', e);
      // Sin captura igual se puede reportar: lienzo en blanco del tamaño de la pantalla.
      const c = document.createElement('canvas');
      c.width = window.innerWidth; c.height = window.innerHeight;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#64748b'; ctx.font = '20px sans-serif';
      ctx.fillText('No se pudo capturar la pantalla automáticamente', 40, 60);
      setUrlCapturada(window.location.href);
      setCaptura(c);
    } finally {
      setCapturando(false);
    }
  };

  return (
    <>
      <button
        data-reporte-error-ignorar
        onClick={capturar}
        disabled={capturando || !!captura}
        title="Reportar un error de la plataforma (captura esta pantalla)"
        aria-label="Reportar error"
        className={`fixed right-5 z-[250] w-11 h-11 rounded-full bg-red-600 text-white shadow-xl flex items-center justify-center
          opacity-70 hover:opacity-100 hover:bg-red-700 transition-all ${costeoActivo ? 'bottom-[88px]' : 'bottom-5'}`}
      >
        {capturando ? <Loader2 size={20} className="animate-spin" /> : <Bug size={20} />}
      </button>
      {captura && (
        <EditorReporte captura={captura} url={urlCapturada} onCerrar={() => setCaptura(null)} />
      )}
    </>
  );
}

function EditorReporte({ captura, url, onCerrar }: { captura: HTMLCanvasElement; url: string; onCerrar: () => void }) {
  const toast = useToast();
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [herramienta, setHerramienta] = useState<'rect' | 'lapiz'>('rect');
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const enCurso = useRef<Marca | null>(null);
  const [titulo, setTitulo] = useState('');
  const [gravedad, setGravedad] = useState('media');
  const [quePaso, setQuePaso] = useState('');
  const [queEsperaba, setQueEsperaba] = useState('');
  const [pasos, setPasos] = useState('');
  const [enviando, setEnviando] = useState(false);
  const grosor = Math.max(3, Math.round(captura.width / 400));

  const repintar = () => {
    const c = lienzo.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(captura, 0, 0);
    for (const m of marcas) dibujar(ctx, m, grosor);
    if (enCurso.current) dibujar(ctx, enCurso.current, grosor);
  };
  useEffect(repintar);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onCerrar(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [enviando, onCerrar]);

  // Coordenadas del puntero → píxeles de la captura (el lienzo se muestra escalado).
  const punto = (e: React.PointerEvent): [number, number] => {
    const r = lienzo.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * (captura.width / r.width), (e.clientY - r.top) * (captura.height / r.height)];
  };
  const bajar = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = punto(e);
    enCurso.current = herramienta === 'rect' ? { tipo: 'rect', x, y, w: 0, h: 0 } : { tipo: 'lapiz', pts: [[x, y]] };
  };
  const mover = (e: React.PointerEvent) => {
    const m = enCurso.current; if (!m) return;
    const [x, y] = punto(e);
    if (m.tipo === 'rect') { m.w = x - m.x; m.h = y - m.y; } else m.pts.push([x, y]);
    repintar();
  };
  const soltar = () => {
    const m = enCurso.current; enCurso.current = null;
    if (!m) return;
    const util = m.tipo === 'rect' ? Math.abs(m.w) > 6 && Math.abs(m.h) > 6 : m.pts.length > 2;
    if (util) setMarcas(prev => [...prev, m]); else repintar();
  };

  const faltantes = [
    marcas.length === 0 && 'marca en la captura dónde está el error',
    !titulo.trim() && 'un título',
    quePaso.trim().length < MIN_QUE_PASO && `qué pasó (mín. ${MIN_QUE_PASO} caracteres)`,
    queEsperaba.trim().length < MIN_QUE_ESPERABA && `qué esperabas (mín. ${MIN_QUE_ESPERABA} caracteres)`,
  ].filter(Boolean) as string[];

  const enviar = async () => {
    if (faltantes.length) return;
    setEnviando(true);
    try {
      const blob = await new Promise<Blob | null>(res => lienzo.current!.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('No se pudo generar la imagen');
      const fd = new FormData();
      fd.append('imagen', blob, 'reporte.jpg');
      fd.append('titulo', titulo.trim());
      fd.append('gravedad', gravedad);
      fd.append('que_paso', quePaso.trim());
      fd.append('que_esperaba', queEsperaba.trim());
      fd.append('pasos', pasos.trim());
      fd.append('url', url);
      fd.append('contexto', JSON.stringify({
        tituloPagina: document.title,
        navegador: navigator.userAgent,
        pantalla: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
        tema: document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro',
        erroresConsola: [...erroresRecientes],
      }));
      const r = await fetch('/api/reportes-error', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || `Error ${r.status}`);
      toast.success('Reporte enviado', 'Le llegó a los administradores. Te avisaremos cuando esté solucionado.');
      onCerrar();
    } catch (e) {
      toast.error('No se pudo enviar el reporte', String((e as Error).message || e));
    } finally {
      setEnviando(false);
    }
  };

  const inp = 'w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/40';
  const lbl = 'block text-[12px] font-semibold text-slate-700 dark:text-slate-300 mb-1';
  const cont = (n: number, min: number) => (
    <span className={`text-[10.5px] ${n >= min ? 'text-emerald-600' : 'text-slate-400'}`}>{n}/{min}</span>
  );

  return (
    <div data-reporte-error-ignorar className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-[2px] flex flex-col lg:flex-row" role="dialog" aria-modal="true">
      {/* Captura + herramientas */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col p-3 gap-2">
        <div className="flex items-center gap-2 text-white">
          <Bug size={18} className="text-red-400" />
          <p className="text-[13px] font-semibold flex-1">Marca en la captura dónde está el error</p>
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button onClick={() => setHerramienta('rect')} className={`px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1.5 ${herramienta === 'rect' ? 'bg-red-600' : 'hover:bg-white/10'}`}><Square size={14} /> Recuadro</button>
            <button onClick={() => setHerramienta('lapiz')} className={`px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1.5 ${herramienta === 'lapiz' ? 'bg-red-600' : 'hover:bg-white/10'}`}><Pencil size={14} /> Lápiz</button>
            <button onClick={() => setMarcas(m => m.slice(0, -1))} disabled={!marcas.length} className="px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1.5 hover:bg-white/10 disabled:opacity-40"><Undo size={14} /> Deshacer</button>
            <button onClick={() => setMarcas([])} disabled={!marcas.length} className="px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1.5 hover:bg-white/10 disabled:opacity-40"><Trash2 size={14} /> Limpiar</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <canvas
            ref={lienzo}
            width={captura.width}
            height={captura.height}
            onPointerDown={bajar}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
            className="max-w-full max-h-full rounded-lg shadow-2xl ring-1 ring-white/20 cursor-crosshair touch-none"
          />
        </div>
      </div>

      {/* Observación */}
      <div className="w-full lg:w-[380px] flex-shrink-0 bg-white dark:bg-[#1c1f26] flex flex-col max-h-[55vh] lg:max-h-none">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/[0.07]">
          <p className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Reportar error</p>
          <button onClick={onCerrar} disabled={enviando} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-[11px] text-slate-400 break-all">Página: {url}</p>
          <div>
            <label className={lbl}>Título *</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={200} className={inp} placeholder="Ej: El botón Guardar del costeo no hace nada" />
          </div>
          <div>
            <label className={lbl}>Gravedad *</label>
            <select value={gravedad} onChange={e => setGravedad(e.target.value)} className={inp}>
              <option value="bloqueante">Bloqueante — no puedo seguir trabajando</option>
              <option value="alta">Alta — funciona mal, hay que darle la vuelta</option>
              <option value="media">Media — molesta pero se puede seguir</option>
              <option value="baja">Baja — detalle visual o de texto</option>
            </select>
          </div>
          <div>
            <label className={`${lbl} flex justify-between`}><span>¿Qué pasó? *</span>{cont(quePaso.trim().length, MIN_QUE_PASO)}</label>
            <textarea value={quePaso} onChange={e => setQuePaso(e.target.value)} rows={4} className={inp} placeholder="Describe el error con detalle: qué mensaje salió, qué dato aparece mal, qué no respondió…" />
          </div>
          <div>
            <label className={`${lbl} flex justify-between`}><span>¿Qué esperabas que pasara? *</span>{cont(queEsperaba.trim().length, MIN_QUE_ESPERABA)}</label>
            <textarea value={queEsperaba} onChange={e => setQueEsperaba(e.target.value)} rows={3} className={inp} placeholder="Ej: Que se guardara el precio y apareciera en el resumen" />
          </div>
          <div>
            <label className={lbl}>¿Qué estabas haciendo justo antes? <span className="font-normal text-slate-400">(opcional)</span></label>
            <textarea value={pasos} onChange={e => setPasos(e.target.value)} rows={3} className={inp} placeholder="1. Abrí la licitación…  2. Cambié la cantidad…  3. Apreté Guardar…" />
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 dark:border-white/[0.07] space-y-2">
          {faltantes.length > 0 && (
            <p className="text-[11.5px] text-amber-600 dark:text-amber-400">Falta: {faltantes.join(' · ')}</p>
          )}
          <button
            onClick={enviar}
            disabled={enviando || faltantes.length > 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[13px] font-semibold py-2.5"
          >
            {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar reporte
          </button>
        </div>
      </div>
    </div>
  );
}
