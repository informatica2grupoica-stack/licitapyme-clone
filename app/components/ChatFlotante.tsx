'use client';

// Burbuja de chat IA, flotante en toda la app (oct-2026). Vive en el layout raíz, así que sobrevive
// a la navegación: la conversación y la posición no se pierden al cambiar de página.
//   - Dentro de una licitación (/licitacion/<codigo> o /negocios/<id>) responde sobre ESA licitación
//     completa (documentos + viabilidad + costeo) vía /api/chat-proyecto.
//   - Fuera de una licitación responde sobre TODAS (SQL de solo lectura) vía /api/chat-global.
// Botón y panel se arrastran; Ctrl+J abre/cierra. Posiciones en localStorage (mismo patrón que
// ReportarErrorBoton).
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { IconMessageCircle2 as Chat, IconX as X, IconSend as Send, IconLoader2 as Loader2, IconGripHorizontal as Grip } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';
import { RespuestaFormateada } from '@/app/licitacion/[codigo]/utils';

type Msg = { rol: 'usuario' | 'asistente'; mensaje: string };
type Pos = { x: number; y: number };
type Alcance = { tipo: 'licitacion'; clave: string; param: 'codigo' | 'negocioId'; etiqueta: string } | { tipo: 'global' };

const RUTAS_SIN_CHAT = ['/login', '/bienvenida', '/recuperar', '/restablecer'];
const LS_BOTON = 'chat-flotante-boton';
const LS_PANEL = 'chat-flotante-panel';
const TAM_BOTON = 48;
const ANCHO_PANEL = 400;
const ALTO_PANEL = 560;

function alcanceDe(pathname: string): Alcance {
  const lic = pathname.match(/^\/licitacion\/([^/]+)/);
  if (lic) { const c = decodeURIComponent(lic[1]); return { tipo: 'licitacion', clave: c, param: 'codigo', etiqueta: c }; }
  const neg = pathname.match(/^\/negocios\/(\d+)/);
  if (neg) return { tipo: 'licitacion', clave: neg[1], param: 'negocioId', etiqueta: `Negocio #${neg[1]}` };
  return { tipo: 'global' };
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

export function ChatFlotante() {
  const { usuario } = useSession();
  const pathname = usePathname();
  const { activo: costeoActivo } = useCosteoFlotante();
  // Permisos (admin siempre): dentro de una licitación usa el de licitación; si no lo tiene pero sí el
  // general, cae al modo general; sin ninguno, la burbuja no aparece.
  const pLic = !!usuario?.permisos?.chat_licitacion;
  const pGlobal = !!usuario?.permisos?.chat_global;
  const alcanceUrl = alcanceDe(pathname);
  const alcance: Alcance = alcanceUrl.tipo === 'licitacion' && !pLic ? { tipo: 'global' } : alcanceUrl;
  const [abierto, setAbierto] = useState(false);
  const [posBoton, setPosBoton] = useState<Pos | null>(null);
  const [posPanel, setPosPanel] = useState<Pos | null>(null);
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const claveAlcance = alcance.tipo === 'licitacion' ? `${alcance.param}:${alcance.clave}` : 'global';

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

  // Al cambiar de licitación se carga SU historial (la conversación "corpus" compartida con la ficha).
  useEffect(() => {
    setMensajes([]); setError(null);
    if (!usuario) return;
    let vivo = true;
    fetch(alcance.tipo === 'licitacion'
      ? `/api/chat-proyecto?${alcance.param}=${encodeURIComponent(alcance.clave)}&sesionId=corpus`
      : '/api/chat-global')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivo && d?.mensajes) setMensajes(d.mensajes); })
      .catch(() => { /* historial es opcional */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveAlcance, !!usuario]);

  useEffect(() => { if (abierto) finRef.current?.scrollIntoView({ block: 'end' }); }, [mensajes, enviando, abierto]);

  const enviar = useCallback(async () => {
    const pregunta = texto.trim();
    if (!pregunta || enviando) return;
    setTexto(''); setError(null); setEnviando(true);
    setMensajes(m => [...m, { rol: 'usuario', mensaje: pregunta }]);
    try {
      const res = await fetch(alcance.tipo === 'licitacion' ? '/api/chat-proyecto' : '/api/chat-global', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alcance.tipo === 'licitacion'
          ? { [alcance.param]: alcance.clave, sesionId: 'corpus', pregunta }
          : { pregunta }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo responder.');
      setMensajes(m => [...m, { rol: 'asistente', mensaje: d.respuesta }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo responder.');
    } finally { setEnviando(false); }
  }, [texto, enviando, alcance]);

  const boton = useArrastre(posBoton, setPosBoton, TAM_BOTON, TAM_BOTON, LS_BOTON, () => setAbierto(true));
  const panel = useArrastre(posPanel, setPosPanel, ANCHO_PANEL, ALTO_PANEL, LS_PANEL);

  if (!usuario || RUTAS_SIN_CHAT.some(r => pathname.startsWith(r))) return null;
  if (alcance.tipo === 'licitacion' ? !pLic : !pGlobal) return null;

  // Por defecto: encima del botón de "Reportar error" (44px a 20px del borde; sube si hay costeo).
  const bottomBoton = costeoActivo ? 148 : 80;

  return (
    <>
      {!abierto && (
        <button
          ref={boton.ref as React.RefObject<HTMLButtonElement>}
          type="button"
          title="Chat IA (Ctrl+J)"
          aria-label="Abrir chat IA"
          {...boton.handlers}
          style={boton.pos ? { left: boton.pos.x, top: boton.pos.y, touchAction: 'none' } : { right: 20, bottom: bottomBoton, touchAction: 'none' }}
          className="fixed z-[250] w-12 h-12 rounded-full bg-zinc-900 text-white dark:bg-slate-200 dark:text-zinc-900 shadow-xl flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
        >
          <Chat size={22} />
        </button>
      )}

      {abierto && (
        <div
          ref={panel.ref as React.RefObject<HTMLDivElement>}
          style={panel.pos ? { left: panel.pos.x, top: panel.pos.y, width: ANCHO_PANEL, height: ALTO_PANEL } : { right: 20, bottom: bottomBoton, width: ANCHO_PANEL, height: ALTO_PANEL }}
          className="fixed z-[250] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] flex flex-col rounded-xl border border-zinc-200 dark:border-slate-700 bg-white dark:bg-[#12151c] shadow-2xl"
          role="dialog" aria-label="Chat IA"
        >
          <div
            {...panel.handlers}
            style={{ touchAction: 'none' }}
            className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-slate-700 cursor-grab active:cursor-grabbing select-none"
          >
            <Grip size={16} className="text-zinc-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">Chat IA</p>
              <p className="text-[11px] text-zinc-500 dark:text-slate-400 truncate">
                {alcance.tipo === 'licitacion' ? `Contexto: ${alcance.etiqueta}` : 'Contexto: todas las licitaciones'}
              </p>
            </div>
            <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => setAbierto(false)}
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-slate-800" aria-label="Cerrar chat" title="Cerrar (Esc)">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
            {mensajes.length === 0 && !enviando ? (
              <p className="text-zinc-500 dark:text-slate-400">
                {alcance.tipo === 'global'
                  ? 'Pregunta sobre todas nuestras licitaciones: qué equipos se repiten más, qué tipos de licitación hay, quién es la competencia, cómo nos ha ido.'
                  : 'Pregunta lo que quieras sobre esta licitación: lee todos sus documentos, la viabilidad y el costeo guardado.'}
              </p>
            ) : null}
            {mensajes.map((m, i) => (
              <div key={i} className={m.rol === 'usuario' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={m.rol === 'usuario'
                  ? 'max-w-[85%] rounded-lg bg-zinc-900 text-white dark:bg-slate-200 dark:text-zinc-900 px-3 py-2 whitespace-pre-wrap'
                  : 'max-w-[95%] rounded-lg bg-zinc-100 dark:bg-slate-800 px-3 py-2'}>
                  {m.rol === 'usuario' ? m.mensaje : <RespuestaFormateada texto={m.mensaje} />}
                </div>
              </div>
            ))}
            {enviando && (
              <div className="flex items-center gap-2 text-zinc-500 dark:text-slate-400"><Loader2 size={14} className="animate-spin" /> {alcance.tipo === 'global' ? 'Consultando la base…' : 'Leyendo la licitación…'}</div>
            )}
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div ref={finRef} />
          </div>

          <form
            onSubmit={e => { e.preventDefault(); enviar(); }}
            className="flex items-end gap-2 p-2 border-t border-zinc-200 dark:border-slate-700"
          >
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              rows={2}
              placeholder="Escribe tu pregunta… (Enter envía)"
              className="flex-1 resize-none rounded-lg border border-zinc-300 dark:border-slate-600 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            <button type="submit" disabled={!texto.trim() || enviando}
              className="h-9 w-9 shrink-0 rounded-lg bg-zinc-900 text-white dark:bg-slate-200 dark:text-zinc-900 flex items-center justify-center disabled:opacity-40" aria-label="Enviar">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
