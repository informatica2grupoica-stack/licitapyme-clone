'use client';

// ankIA — burbuja de chat flotante en toda la app. Vive en el layout raíz: la conversación y la posición sobreviven a la navegación.
// Un chatbot por MENÚ (nov-2026):
//   · Dashboard                               → chat GENERAL sobre todas las licitaciones (/api/chat-global, permiso chat_global).
//   · /licitacion/<código> y /negocios/<id>   → chat de ESA licitación: documentos + análisis (/api/chat-proyecto).
//   · Cada otro menú (Negocios, Compras, Radar…) → chat con los datos de ese menú (/api/chat-seccion, ver chat-secciones.ts).
//   · Un menú sin chat propio no muestra la burbuja.
// Multiempresa: la burbuja solo aparece si la empresa tiene el módulo «Consulta a la IA» (adicional) y el del menú.
// Botón y panel se arrastran; Ctrl+J abre/cierra. Posiciones en localStorage. Estilo: sistema licitank-ui (teal, sin chispas de IA).
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { IconMessageCircle2 as Chat, IconX as X, IconArrowUp as Enviar, IconGripVertical as Grip } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';
import { Esqueleto } from '@/app/components/ui/kit/Estructura';
import { EASE_LK, NORMAL } from '@/app/components/ui/kit/movimiento';
import { rutaPermitida, type Modulo } from '@/app/lib/modulos';
import { seccionDeRuta, type SeccionChat } from '@/app/lib/chat-secciones';

type Msg = { rol: 'usuario' | 'asistente'; mensaje: string };
type Pos = { x: number; y: number };
type Alcance =
  | { tipo: 'licitacion'; clave: string; param: 'codigo' | 'negocioId'; etiqueta: string }
  | { tipo: 'seccion'; sec: SeccionChat }
  | { tipo: 'global'; sec: SeccionChat };

const RUTAS_SIN_CHAT = ['/login', '/bienvenida', '/recuperar', '/restablecer'];
const LS_BOTON = 'chat-flotante-boton';
const LS_PANEL = 'chat-flotante-panel';
const TAM_BOTON = 48;
const ANCHO_PANEL = 420;
const ALTO_PANEL = 600;

const SUGERENCIAS_LICITACION = ['¿Cuáles son los requisitos clave?', '¿Cuándo cierra y cuál es el presupuesto?', '¿Qué garantías piden?', '¿Qué nos falta para postular?'];

function alcanceDe(pathname: string): Alcance | null {
  const lic = pathname.match(/^\/licitacion\/([^/]+)/);
  if (lic) { const c = decodeURIComponent(lic[1]); return { tipo: 'licitacion', clave: c, param: 'codigo', etiqueta: c }; }
  const neg = pathname.match(/^\/negocios\/(\d+)/);
  if (neg) return { tipo: 'licitacion', clave: neg[1], param: 'negocioId', etiqueta: `Negocio #${neg[1]}` };
  const sec = seccionDeRuta(pathname);
  if (!sec) return null;
  return sec.id === 'dashboard' ? { tipo: 'global', sec } : { tipo: 'seccion', sec };
}

function leerPos(k: string): Pos | null {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null; } catch { return null; }
}
function guardarPos(k: string, p: Pos) { try { localStorage.setItem(k, JSON.stringify(p)); } catch { /* sin storage */ } }
const acotar = (p: Pos, w: number, h: number): Pos => ({
  x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
  y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
});

// Arrastre por pointer events. `onClick` solo se dispara si el movimiento fue menor al umbral,
// para que el mismo botón sirva para arrastrar y para abrir.
function useArrastre(pos: Pos | null, setPos: (p: Pos) => void, w: number, h: number, clave: string, onClick?: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  const estado = useRef<{ dx: number; dy: number; x0: number; y0: number; movio: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const r = (ref.current ?? e.currentTarget).getBoundingClientRect();
    estado.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, movio: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = estado.current; if (!s) return;
    if (!s.movio && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 4) return;
    s.movio = true;
    setPos(acotar({ x: e.clientX - s.dx, y: e.clientY - s.dy }, w, h));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const s = estado.current; estado.current = null;
    if (!s) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    if (s.movio) {
      const r = (ref.current ?? e.currentTarget).getBoundingClientRect();
      guardarPos(clave, acotar({ x: r.left, y: r.top }, w, h));
    } else onClick?.();
  };
  return { ref, pos, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}

// ── Texto de la respuesta: párrafos, listas, tablas y **negritas**, sin HTML crudo ──────────────────
function enNegritas(t: string, k: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4
      ? <strong key={`${k}${i}`} className="font-semibold text-tinta dark:text-slate-100">{p.slice(2, -2)}</strong>
      : <span key={`${k}${i}`}>{p}</span>);
}
const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function TextoRespuesta({ texto }: { texto: string }) {
  const lineas = texto.replace(/\r/g, '').split('\n');
  const bloques: React.ReactNode[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const t = lineas[i].trim();
    if (!t) continue;
    // tabla markdown: encabezado + línea separadora |---|
    if (t.startsWith('|') && /^\|?\s*:?-{2,}/.test((lineas[i + 1] || '').trim())) {
      const enc = celdas(t); const filas: string[][] = []; const ini = i; i += 2;
      while (i < lineas.length && lineas[i].trim().startsWith('|')) { filas.push(celdas(lineas[i])); i++; }
      i--;
      bloques.push(
        <div key={`t${ini}`} className="overflow-x-auto rounded-lg border border-linea dark:border-slate-700">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 dark:bg-slate-800/70 text-left text-tinta-2 dark:text-slate-300">
              {enc.map((c, j) => <th key={j} className="px-2.5 py-1.5 font-medium whitespace-nowrap">{enNegritas(c, `h${j}`)}</th>)}
            </tr></thead>
            <tbody>{filas.map((f, r) => (
              <tr key={r} className="border-t border-linea/80 dark:border-slate-800">
                {f.map((c, j) => <td key={j} className="px-2.5 py-1.5 align-top tabular-nums">{enNegritas(c, `c${r}${j}`)}</td>)}
              </tr>))}
            </tbody>
          </table>
        </div>);
      continue;
    }
    const vineta = t.match(/^[-•*]\s+(.*)$/);
    const numero = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (vineta) bloques.push(
      <div key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{enNegritas(vineta[1], `v${i}`)}</span></div>);
    else if (numero) bloques.push(
      <div key={i} className="flex gap-2"><span className="w-4 shrink-0 text-right text-tinta-3 tabular-nums">{numero[1]}.</span><span>{enNegritas(numero[2], `n${i}`)}</span></div>);
    else bloques.push(<p key={i}>{enNegritas(t.replace(/^#+\s*/, ''), `p${i}`)}</p>);
  }
  return <div className="space-y-2 text-[13px] leading-relaxed text-tinta dark:text-slate-200">{bloques}</div>;
}

export function ChatFlotante() {
  const { usuario } = useSession();
  const pathname = usePathname();
  const { activo: costeoActivo } = useCosteoFlotante();
  const alcance = alcanceDe(pathname);
  const [abierto, setAbierto] = useState(false);
  const [posBoton, setPosBoton] = useState<Pos | null>(null);
  const [posPanel, setPosPanel] = useState<Pos | null>(null);
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const claveAlcance = !alcance ? '' : alcance.tipo === 'licitacion' ? `${alcance.param}:${alcance.clave}` : `${alcance.tipo}:${alcance.sec.id}`;

  useEffect(() => {
    const b = leerPos(LS_BOTON); if (b) setPosBoton(acotar(b, TAM_BOTON, TAM_BOTON));
    const p = leerPos(LS_PANEL); if (p) setPosPanel(acotar(p, ANCHO_PANEL, ALTO_PANEL));
  }, []);

  // Ctrl+J abre/cierra; Escape cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAbierto(a => !a); }
      else if (e.key === 'Escape') setAbierto(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ¿Puede esta persona usar el chat de este menú? (el servidor lo vuelve a verificar en cada endpoint)
  const permisos = usuario?.permisos;
  const esICA = !usuario?.clienteId || usuario.clienteId === 1;
  const modulos = (usuario?.modulos ?? []) as Modulo[];
  const habilitado = !!usuario && !!alcance && (
    alcance.tipo === 'global' ? !!permisos?.chat_global
      : !!permisos?.chat_licitacion && (alcance.tipo === 'licitacion' || esICA || rutaPermitida(alcance.sec.rutaModulo, usuario.clienteId ?? 0, modulos).ok)
  );

  // Al cambiar de menú o de licitación se carga SU historial.
  useEffect(() => {
    setMensajes([]); setError(null);
    if (!usuario || !alcance || !habilitado) return;
    let vivo = true;
    const url = alcance.tipo === 'licitacion'
      ? `/api/chat-proyecto?${alcance.param}=${encodeURIComponent(alcance.clave)}&sesionId=corpus`
      : alcance.tipo === 'global' ? '/api/chat-global' : `/api/chat-seccion?seccion=${alcance.sec.id}`;
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivo && d?.mensajes) setMensajes(d.mensajes); })
      .catch(() => { /* el historial es opcional */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveAlcance, !!usuario, habilitado]);

  useEffect(() => { if (abierto) finRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [mensajes, enviando, abierto]);

  const enviar = useCallback(async (preguntaDirecta?: string) => {
    const pregunta = (preguntaDirecta ?? texto).trim();
    if (!pregunta || enviando || !alcance) return;
    setTexto(''); setError(null); setEnviando(true);
    setMensajes(m => [...m, { rol: 'usuario', mensaje: pregunta }]);
    try {
      const [url, cuerpo] = alcance.tipo === 'licitacion'
        ? ['/api/chat-proyecto', { [alcance.param]: alcance.clave, sesionId: 'corpus', pregunta }]
        : alcance.tipo === 'global' ? ['/api/chat-global', { pregunta }] : ['/api/chat-seccion', { seccion: alcance.sec.id, pregunta }];
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo responder.');
      setMensajes(m => [...m, { rol: 'asistente', mensaje: d.respuesta }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo responder.');
    } finally { setEnviando(false); }
  }, [texto, enviando, alcance]);

  const boton = useArrastre(posBoton, setPosBoton, TAM_BOTON, TAM_BOTON, LS_BOTON, () => setAbierto(true));
  const panel = useArrastre(posPanel, setPosPanel, ANCHO_PANEL, ALTO_PANEL, LS_PANEL);

  if (!usuario || !alcance || !habilitado || RUTAS_SIN_CHAT.some(r => pathname.startsWith(r))) return null;

  // Por defecto: encima del botón de "Reportar error" (44px a 20px del borde; sube si hay costeo).
  const bottomBoton = costeoActivo ? 148 : 80;
  const nombre = usuario.nombre?.trim().split(/\s+/)[0] || '';
  const lugar = alcance.tipo === 'licitacion' ? alcance.etiqueta : alcance.sec.nombre;
  const alcanceTexto = alcance.tipo === 'licitacion' ? 'Esta licitación: documentos y análisis' : alcance.tipo === 'global' ? 'Todas las licitaciones' : `Datos de ${alcance.sec.nombre}`;
  const saludo = alcance.tipo === 'licitacion'
    ? `Ya leí los documentos de esta licitación y lo que tenemos analizado${nombre ? `, ${nombre}` : ''}. ¿Qué quieres saber?`
    : alcance.tipo === 'global'
      ? `Hola${nombre ? `, ${nombre}` : ''}. Tengo a la vista todas las licitaciones que ha visto el sistema: qué ganamos, quién compite y qué se repite. ¿Qué te interesa?`
      : `Hola${nombre ? `, ${nombre}` : ''}. Estás en ${alcance.sec.nombre}: puedo mirar ${alcance.sec.que}. ¿Qué necesitas?`;
  const sugerencias = alcance.tipo === 'licitacion' ? SUGERENCIAS_LICITACION : alcance.sec.sugerencias;
  const pensando = alcance.tipo === 'licitacion' ? 'Leyendo la licitación…' : 'Revisando la base…';

  return (
    <>
      {!abierto && (
        <button
          ref={boton.ref as React.RefObject<HTMLButtonElement>}
          type="button"
          title={`ankIA · ${lugar} (Ctrl+J)`}
          aria-label="Abrir el chat"
          {...boton.handlers}
          style={boton.pos ? { left: boton.pos.x, top: boton.pos.y, touchAction: 'none' } : { right: 20, bottom: bottomBoton, touchAction: 'none' }}
          className="fixed z-[250] w-12 h-12 rounded-full bg-marca text-white shadow-flotante flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-marca-fuerte hover:-translate-y-px transition duration-150"
        >
          <Chat size={22} stroke={1.75} />
        </button>
      )}

      <AnimatePresence>
        {abierto && (
          <motion.div
            ref={panel.ref as React.RefObject<HTMLDivElement>}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: NORMAL, ease: EASE_LK }}
            style={panel.pos ? { left: panel.pos.x, top: panel.pos.y, width: ANCHO_PANEL, height: ALTO_PANEL } : { right: 20, bottom: bottomBoton, width: ANCHO_PANEL, height: ALTO_PANEL }}
            className="fixed z-[250] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] flex flex-col overflow-hidden rounded-2xl border border-linea bg-white shadow-flotante dark:border-slate-800 dark:bg-slate-900"
            role="dialog" aria-label={`Chat de ${lugar}`}
          >
            <div
              {...panel.handlers}
              style={{ touchAction: 'none' }}
              className="flex items-center gap-3 px-4 py-3 border-b border-linea dark:border-slate-800 cursor-grab active:cursor-grabbing select-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marca-suave text-marca text-sm font-semibold dark:bg-teal-950/60 dark:text-teal-300">a</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">ankIA <span className="font-normal text-tinta-3">· {lugar}</span></p>
                <p className="truncate text-[11px] text-tinta-3">{alcanceTexto}</p>
              </div>
              <Grip size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />
              <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => setAbierto(false)}
                className="-mr-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label="Cerrar el chat" title="Cerrar (Esc)">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {mensajes.length === 0 && !enviando && (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-tinta-2 dark:text-slate-300">{saludo}</p>
                  <div className="flex flex-col items-start gap-1.5">
                    {sugerencias.map(s => (
                      <button key={s} type="button" onClick={() => enviar(s)}
                        className="rounded-lg border border-linea bg-white px-3 py-1.5 text-left text-xs text-tinta-2 transition duration-150 hover:-translate-y-px hover:border-marca/40 hover:bg-marca-suave hover:text-marca dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-teal-950/40 dark:hover:text-teal-300">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mensajes.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: NORMAL, ease: EASE_LK }}
                  className={m.rol === 'usuario' ? 'flex justify-end' : 'flex justify-start'}>
                  {m.rol === 'usuario' ? (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-marca px-3.5 py-2 text-[13px] leading-relaxed text-white">{m.mensaje}</div>
                  ) : (
                    <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-linea bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/50">
                      <TextoRespuesta texto={m.mensaje} />
                    </div>
                  )}
                </motion.div>
              ))}

              {enviando && (
                <div className="max-w-[70%] space-y-2 rounded-2xl rounded-bl-md border border-linea bg-slate-50 px-3.5 py-3 dark:border-slate-800 dark:bg-slate-800/50" aria-live="polite">
                  <p className="text-xs text-tinta-3">{pensando}</p>
                  <Esqueleto className="h-3 w-full" /><Esqueleto className="h-3 w-4/5" />
                </div>
              )}
              {error && <p className="text-xs text-urgente">{error}</p>}
              <div ref={finRef} />
            </div>

            <form onSubmit={e => { e.preventDefault(); enviar(); }} className="border-t border-linea p-3 dark:border-slate-800">
              <div className="flex items-end gap-2 rounded-xl border border-linea bg-white p-1.5 pl-3 transition-colors focus-within:border-marca dark:border-slate-700 dark:bg-slate-900">
                <textarea
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  rows={1}
                  placeholder="Escribe tu pregunta…"
                  className="max-h-28 min-h-[2rem] flex-1 resize-none self-center bg-transparent py-1 text-[13px] text-tinta outline-none placeholder:text-tinta-3 dark:text-slate-100"
                />
                <button type="submit" disabled={!texto.trim() || enviando} aria-label="Enviar"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-marca text-white transition-colors hover:bg-marca-fuerte disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600">
                  <Enviar size={16} stroke={2} />
                </button>
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-tinta-3">Enter envía · Shift+Enter salta de línea · Ctrl+J abre y cierra</p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
