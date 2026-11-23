'use client';
// Modal para elegir al encargado de Compras (licitank-ui): una fila por perfil con su carga visualizada.
// Quién aparece lo decide el permiso «Encargado de Compras» del perfil (Admin → Usuarios).
// `obligatorio`: negocio ganado sin encargado → se abre solo y no se cierra hasta asignar (sin encargado no hay tareas).
import { useState, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { IconCheck as Check, IconLoader2 as Loader2, IconUserCheck as UserCheck } from '@tabler/icons-react';
import { Modal } from '@/app/components/ui/Modal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { item } from '@/app/components/ui/kit/movimiento';
import type { Candidato } from './ComprasContext';

const iniciales = (n: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?';
const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;

interface Props {
  open: boolean; onClose: () => void; candidatos: Candidato[]; actualId: number | null; guardando: boolean;
  onConfirmar: (encargadoId: number) => void;
  /** Paso obligatorio: sin Cancelar ni X; solo se sale eligiendo a alguien (o volviendo a la lista). */
  obligatorio?: boolean;
  /** Para que se vea de qué negocio se trata. */
  negocio?: { codigo: string; nombre?: string | null };
}

/** Se pinta en el <body>: la ficha de Compras es un @container y ese contenedor atrapa a los elementos `fixed` (el modal no se veía).
 *  Solo existe mientras está abierto, así que la elección se reinicia cada vez que se abre. */
export function ModalElegirEncargado(props: Props) {
  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!montado || !props.open) return null;
  return createPortal(<Contenido {...props} />, document.body);
}

function Contenido({ onClose, candidatos, actualId, guardando, onConfirmar, obligatorio = false, negocio }: Props) {
  const [elegido, setElegido] = useState<number | null>(null);
  const ordenados = useMemo(() => [...candidatos].sort((a, b) => a.carga - b.carga || String(a.nombre).localeCompare(String(b.nombre))), [candidatos]);
  const maxCarga = Math.max(1, ...candidatos.map(c => c.carga));
  const menorCarga = ordenados.length > 1 ? ordenados[0].carga : null;
  const cambia = actualId != null;
  const quien = ordenados.find(c => c.id === elegido);
  const titulo = cambia ? 'Cambiar encargado de Compras' : obligatorio ? 'Asigna un encargado de Compras' : 'Elegir encargado de Compras';

  return (
    <Modal open onClose={guardando || obligatorio ? () => {} : onClose} size="sm" sinCerrar={obligatorio}
      footer={(
        <>
          {obligatorio
            ? <Link href="/compras" className="mr-auto text-[13px] text-tinta-2 hover:text-tinta transition-colors">Volver a Compras</Link>
            : <Boton variante="fantasma" onClick={onClose} disabled={guardando}>Cancelar</Boton>}
          <Boton variante="primario" disabled={elegido == null || guardando} onClick={() => elegido != null && onConfirmar(elegido)}
            icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
            {guardando ? 'Asignando…' : quien ? `Asignar a ${quien.nombre?.split(' ')[0] ?? 'este perfil'}` : cambia ? 'Cambiar encargado' : 'Asignar encargado'}
          </Boton>
        </>
      )}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-marca-suave text-marca dark:bg-teal-950 dark:text-teal-300 flex items-center justify-center flex-shrink-0">
          <UserCheck size={20} stroke={1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug">{titulo}</h2>
          <p className="text-sm text-tinta-2 dark:text-slate-400 mt-0.5">
            {obligatorio ? 'Este negocio ya es ganado. Sin encargado no se abren las tareas de Compras.' : 'Se le asignan las tareas de este negocio.'}
          </p>
        </div>
      </div>

      {negocio && (
        <div className="mt-4 pt-3 border-t border-linea dark:border-slate-800">
          <p className="text-xs text-tinta-3">Negocio</p>
          <p className="text-[13px] text-tinta dark:text-slate-100 truncate"><span className="font-mono tabular-nums">{negocio.codigo}</span>{negocio.nombre ? <span className="text-tinta-2 dark:text-slate-400"> · {negocio.nombre}</span> : null}</p>
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-[13px] font-medium text-tinta dark:text-slate-100">Elige al encargado</p>
        <p className="text-xs text-tinta-2 tabular-nums">{plural(candidatos.length, 'perfil', 'perfiles')}</p>
      </div>

      {candidatos.length === 0 ? (
        <p className="mt-3 text-[13px] text-tinta-2">No hay perfiles con el permiso «Encargado de Compras». Actívalo en Admin → Usuarios.</p>
      ) : (
        <Lista className="mt-2 space-y-2 max-h-[340px] overflow-y-auto -mx-1 px-1 py-1">
          {ordenados.map(c => {
            const activo = elegido === c.id; const esActual = actualId === c.id;
            return (
              <motion.button key={c.id} variants={item} type="button" role="radio" aria-checked={activo} disabled={esActual || guardando}
                onClick={() => setElegido(c.id)}
                className={`w-full flex items-center gap-3 text-left rounded-xl border px-3.5 py-3 transition-[border-color,box-shadow,background-color] duration-150 ease-lk
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:opacity-60 disabled:cursor-not-allowed
                  ${activo
                    ? 'border-marca bg-marca-suave ring-2 ring-marca/20 dark:bg-teal-950/40'
                    : 'border-linea bg-white hover:border-slate-300 hover:shadow-tarjeta-hover dark:bg-slate-900 dark:border-slate-800 dark:hover:border-slate-600'}`}>
                <span className={`w-9 h-9 rounded-full text-xs font-semibold flex items-center justify-center flex-shrink-0 transition-colors duration-150
                  ${activo ? 'bg-marca text-white' : 'bg-slate-100 text-tinta-2 dark:bg-slate-800 dark:text-slate-300'}`}>{iniciales(c.nombre)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-tinta dark:text-slate-50 truncate">
                    {c.nombre || `Usuario ${c.id}`}{esActual && <span className="ml-1.5 text-xs font-normal text-tinta-2">· encargado actual</span>}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400">
                    <span className="tabular-nums">{plural(c.carga, 'tarea pendiente', 'tareas pendientes')}</span>
                    {menorCarga != null && c.carga === menorCarga && <Estado color="#16a34a">Menos carga</Estado>}
                  </span>
                  <span className="mt-1.5 block h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" aria-hidden>
                    <span className={`block h-full rounded-full transition-[width] duration-300 ease-lk ${activo ? 'bg-marca' : 'bg-slate-400 dark:bg-slate-500'}`}
                      style={{ width: `${Math.max(c.carga > 0 ? 4 : 0, Math.round((c.carga / maxCarga) * 100))}%` }} />
                  </span>
                </span>
                <span aria-hidden className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-150
                  ${activo ? 'bg-marca text-white' : 'border-2 border-linea dark:border-slate-700'}`}>
                  {activo && <Check size={13} stroke={2.5} />}
                </span>
              </motion.button>
            );
          })}
        </Lista>
      )}
    </Modal>
  );
}
