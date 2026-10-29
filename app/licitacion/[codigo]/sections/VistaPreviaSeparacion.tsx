'use client';

// Vista previa de «Separar anexos» (28-oct-2026, pedido del dueño tras 2827-102-LE26: «hay forma
// de ver cómo queda antes de que se corten»). POST /api/anexos/separar con soloVer corta en
// memoria; acá se ve cada anexo (dónde empieza, dónde termina, su texto) y recién al confirmar se
// guarda, con la caja que el usuario eligió y sin los que desmarcó.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown as ChevronDown } from '@tabler/icons-react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';

export interface PiezaVistaPrevia {
  indice: number;
  nombre: string;
  titulo: string;
  categoria: string;
  lineas: string[];
  totalLineas: number;
  miniatura?: string | null; // primera página como se ve en Word (PNG); null si no se pudo convertir
  paginas?: number | null;
}

export interface AjusteSeparacion { indice: number; categoria: string; omitir: boolean }

const CAJAS: { valor: string; etiqueta: string }[] = [
  { valor: 'administrativo', etiqueta: 'Anexos Administrativos' },
  { valor: 'tecnico', etiqueta: 'Anexos Técnicos' },
  { valor: 'economico', etiqueta: 'Anexos Económicos' },
  { valor: 'sin_clasificar', etiqueta: 'Anexos Oferente (sin clasificar)' },
];

// Un anexo de 1-2 líneas casi siempre es un corte falso (el título repetido de 2827-102-LE26).
const LINEAS_SOSPECHOSAS = 2;

export function VistaPreviaSeparacion({ documento, piezas, onCancelar, onConfirmar }: {
  documento: string;
  piezas: PiezaVistaPrevia[];
  onCancelar: () => void;
  onConfirmar: (ajustes: AjusteSeparacion[]) => void;
}) {
  const [ajustes, setAjustes] = useState<AjusteSeparacion[]>(
    () => piezas.map(p => ({ indice: p.indice, categoria: p.categoria, omitir: false })),
  );
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [ampliada, setAmpliada] = useState<PiezaVistaPrevia | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (ampliada) setAmpliada(null); else onCancelar(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancelar, ampliada]);

  const cambiar = (indice: number, cambio: Partial<AjusteSeparacion>) =>
    setAjustes(prev => prev.map(a => (a.indice === indice ? { ...a, ...cambio } : a)));
  const alternar = (indice: number) => setAbiertos(prev => {
    const next = new Set(prev);
    if (next.has(indice)) next.delete(indice); else next.add(indice);
    return next;
  });
  const aGuardar = ajustes.filter(a => !a.omitir).length;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 overlay-in" onClick={onCancelar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vista-previa-separacion-titulo"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-flotante modal-in dark:bg-slate-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-linea px-6 py-4 dark:border-slate-800">
          <h2 id="vista-previa-separacion-titulo" className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">
            Vista previa de la separación
          </h2>
          <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-400">
            «{documento}» se separa en <span className="font-semibold tabular-nums">{piezas.length}</span> anexos.
            Revisa dónde empieza y termina cada uno antes de guardar; todavía no se ha guardado nada.
          </p>
        </div>

        <ol className="flex-1 overflow-y-auto px-6">
          {piezas.map(p => {
            const ajuste = ajustes.find(a => a.indice === p.indice)!;
            const abierto = abiertos.has(p.indice);
            const sospechoso = p.totalLineas <= LINEAS_SOSPECHOSAS;
            return (
              <li key={p.indice} className={`border-t border-linea py-4 first:border-t-0 dark:border-slate-800 ${ajuste.omitir ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <span className="w-5 pt-0.5 text-xs font-semibold tabular-nums text-tinta-3">{p.indice + 1}</span>
                  {p.miniatura ? (
                    <button
                      type="button"
                      onClick={() => setAmpliada(p)}
                      title="Ampliar"
                      className="w-28 shrink-0 overflow-hidden rounded-md border border-linea bg-white shadow-tarjeta transition hover:shadow-tarjeta-hover dark:border-slate-700"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.miniatura} alt={"Anexo "+(p.indice+1)+": "+p.titulo} className="block w-full" />
                    </button>
                  ) : (
                    <div className="flex h-36 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-linea px-2 text-center text-[11px] text-tinta-3 dark:border-slate-700">
                      Sin imagen: revisa el texto
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-tinta dark:text-slate-100">{p.titulo}</p>
                    <p className="mt-0.5 text-xs text-tinta-3">
                      {p.nombre} · <span className="tabular-nums">{p.totalLineas}</span> {p.totalLineas === 1 ? 'línea' : 'líneas'}
                      {p.paginas ? <> · <span className="tabular-nums">{p.paginas}</span> {p.paginas === 1 ? 'página' : 'páginas'}</> : null}
                    </p>
                    {(sospechoso || ajuste.categoria === 'sin_clasificar') && (
                      <p className="mt-1 text-xs text-alerta">
                        <Estado color="var(--color-alerta)">
                          {sospechoso
                            ? `Solo trae ${p.totalLineas} ${p.totalLineas === 1 ? 'línea' : 'líneas'}: puede ser un corte falso`
                            : 'No se pudo clasificar: elige la caja'}
                        </Estado>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="sr-only" htmlFor={`caja-${p.indice}`}>Caja</label>
                    <select
                      id={`caja-${p.indice}`}
                      value={ajuste.categoria}
                      disabled={ajuste.omitir}
                      onChange={e => cambiar(p.indice, { categoria: e.target.value })}
                      className="h-8 rounded-lg border border-linea bg-white px-2 text-[13px] text-tinta focus:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {CAJAS.map(c => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
                    </select>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-tinta-2 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={!ajuste.omitir}
                        onChange={e => cambiar(p.indice, { omitir: !e.target.checked })}
                        className="h-4 w-4 accent-teal-600"
                      />
                      Guardar
                    </label>
                  </div>
                </div>

                <div className="mt-2 pl-9">
                  {!abierto && (
                    <p className="truncate text-xs text-tinta-2 dark:text-slate-400">
                      <span className="text-tinta-3">Empieza:</span> {p.lineas[0] ?? '—'}
                      {p.lineas.length > 1 && <><span className="mx-1.5 text-tinta-3">·</span><span className="text-tinta-3">Termina:</span> {p.lineas.at(-1)}</>}
                    </p>
                  )}
                  {abierto && (
                    <div className="max-h-72 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-tinta-2 dark:bg-slate-800/60 dark:text-slate-300">
                      {p.lineas.map((l, i) => <p key={i} className="whitespace-pre-wrap">{l}</p>)}
                      {p.totalLineas > p.lineas.length && (
                        <p className="mt-1 text-tinta-3">… y {p.totalLineas - p.lineas.length} líneas más</p>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => alternar(p.indice)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-marca hover:underline"
                  >
                    <ChevronDown size={13} className={`transition-transform duration-150 ${abierto ? 'rotate-180' : ''}`} />
                    {abierto ? 'Ocultar texto' : 'Ver texto completo'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-end gap-2 border-t border-linea px-6 py-3 dark:border-slate-800">
          <Boton variante="secundario" onClick={onCancelar}>Cancelar</Boton>
          <Boton variante="primario" disabled={aGuardar === 0} onClick={() => onConfirmar(ajustes)}>
            Guardar {aGuardar} {aGuardar === 1 ? 'anexo' : 'anexos'}
          </Boton>
        </div>
      </div>

      {ampliada?.miniatura && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 overflow-y-auto" onClick={() => setAmpliada(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ampliada.miniatura} alt={ampliada.titulo} className="max-h-full w-auto max-w-2xl rounded bg-white shadow-flotante" />
        </div>
      )}
    </div>,
    document.body,
  );
}
