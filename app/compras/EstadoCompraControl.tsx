'use client';
// Estado de la compra (pedido del dueño, 23-nov-2026): Abierta → En proceso → Entregada → Pagada, o Cancelada con motivo obligatorio.
// Un solo componente para la ficha y la lista. Entregada y Pagada se confirman a mano (con avisos de lo que falta); Pagada cierra la licitación.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';
import { Modal } from '@/app/components/ui/Modal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import {
  type EstadoCompra, ETIQUETA_ESTADO_COMPRA, MIN_MOTIVO_CANCELACION, siguienteEstadoCompra, puedeCancelarseDesde,
} from '@/app/lib/compras-estado-core';

export const COLOR_ESTADO_COMPRA: Record<EstadoCompra, { texto: string; punto: string }> = {
  ABIERTA: { texto: 'text-tinta-2 dark:text-slate-400', punto: 'bg-zinc-400' },
  EN_PROCESO: { texto: 'text-teal-700', punto: 'bg-teal-600' },
  ENTREGADA: { texto: 'text-amber-700', punto: 'bg-amber-500' },
  PAGADA: { texto: 'text-emerald-700', punto: 'bg-emerald-500' },
  CANCELADA: { texto: 'text-rose-700', punto: 'bg-rose-500' },
};

export function EtiquetaEstadoCompra({ estado }: { estado: EstadoCompra }) {
  const c = COLOR_ESTADO_COMPRA[estado];
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${c.texto}`}><span className={`w-1.5 h-1.5 rounded-full ${c.punto}`} />{ETIQUETA_ESTADO_COMPRA[estado]}</span>;
}

const TEXTO_PASO: Partial<Record<EstadoCompra, string>> = { EN_PROCESO: 'Pasar a En proceso', ENTREGADA: 'Marcar Entregada', PAGADA: 'Marcar Pagada' };

async function cambiar(negocioId: number, estado: EstadoCompra, motivo?: string) {
  const res = await fetch(`/api/compras/${negocioId}/estado-compra`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado, motivo }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cambiar el estado');
}

/** Aviso obligatorio: una licitación «Abierta» no se toca hasta pasarla a «En proceso». Sin X ni Cancelar.
 *  Se pinta en el <body>: la ficha de Compras es un @container y atrapa a los elementos `fixed`. */
export function ModalPasarEnProceso({ negocioId, codigo, nombre, onCambio }: { negocioId: number; codigo: string; nombre?: string | null; onCambio: () => void }) {
  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  if (!montado) return null;
  const pasar = async () => {
    setGuardando(true);
    try { await cambiar(negocioId, 'EN_PROCESO'); onCambio(); }
    catch (e: any) { toast.error('No se pudo cambiar el estado', e.message); setGuardando(false); }
  };
  return createPortal(
    <Modal open onClose={() => {}} size="sm" sinCerrar
      footer={(
        <>
          <Link href="/compras" className="mr-auto text-[13px] text-tinta-2 hover:text-tinta transition-colors">Volver a Compras</Link>
          <Boton variante="primario" onClick={pasar} disabled={guardando} icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
            {guardando ? 'Cambiando…' : 'Pasar a En proceso'}
          </Boton>
        </>
      )}>
      <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug">Antes de empezar, pasa la licitación a «En proceso»</h2>
      <p className="text-sm text-tinta-2 dark:text-slate-400 mt-1">Mientras esté «Abierta» no se pueden hacer tareas, cotizar, aprobar ni emitir órdenes de compra.</p>
      <div className="mt-4 pt-3 border-t border-linea dark:border-slate-800">
        <p className="text-xs text-tinta-3">Licitación</p>
        <p className="text-[13px] text-tinta dark:text-slate-100 truncate"><span className="font-mono tabular-nums">{codigo}</span>{nombre ? <span className="text-tinta-2 dark:text-slate-400"> · {nombre}</span> : null}</p>
      </div>
    </Modal>,
    document.body,
  );
}

type Paso = { estado: EstadoCompra; avisos: string[] } | 'cancelar' | null;

export function EstadoCompraControl({ negocioId, estado, puede, onCambio }: { negocioId: number; estado: EstadoCompra; puede: boolean; onCambio: () => void }) {
  const toast = useToast();
  const pedirSiNo = useConfirm();
  const [paso, setPaso] = useState<Paso>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  const siguiente = siguienteEstadoCompra(estado);
  useEffect(() => { if (paso === null) setMotivo(''); }, [paso]);

  const pedirPaso = async (e: EstadoCompra) => {
    let avisos: string[] = [];
    if (e === 'ENTREGADA' || e === 'PAGADA') {
      try { const r = await fetch(`/api/compras/${negocioId}/estado-compra?para=${e}`).then(x => x.json()); avisos = r.advertencias || []; } catch { /* sin avisos */ }
    }
    setPaso({ estado: e, avisos });
  };
  const confirmar = async (e: EstadoCompra, m?: string) => {
    // Verificación final Sí/No antes de cambiar el estado de la compra.
    const textos: Partial<Record<EstadoCompra, { titulo: string; mensaje: string; si: string; peligro?: boolean }>> = {
      EN_PROCESO: { titulo: '¿Pasar la licitación a «En proceso»?', mensaje: 'Desde ahí se pueden hacer tareas, cotizar, aprobar y emitir órdenes de compra.', si: 'Sí, pasar a En proceso' },
      CANCELADA: { titulo: '¿Cancelar esta licitación?', mensaje: `Motivo: «${(m || '').trim()}». Queda guardado en la ficha y en la pestaña Canceladas.`, si: 'Sí, cancelar', peligro: true },
    };
    const t = textos[e];
    if (t) {
      const ok = await pedirSiNo({ titulo: t.titulo, mensaje: t.mensaje, confirmarLabel: t.si, cancelarLabel: 'No', peligro: t.peligro });
      if (!ok) return;
    }
    setGuardando(true);
    try { await cambiar(negocioId, e, m); setPaso(null); onCambio(); }
    catch (err: any) { toast.error('No se pudo cambiar el estado', err.message); }
    finally { setGuardando(false); }
  };

  const modal = montado && paso && createPortal(
    paso === 'cancelar' ? (
      <Modal open onClose={() => !guardando && setPaso(null)} size="sm"
        footer={(<>
          <Boton variante="fantasma" onClick={() => setPaso(null)} disabled={guardando}>Volver</Boton>
          <Boton variante="peligro" disabled={guardando || motivo.trim().length < MIN_MOTIVO_CANCELACION} onClick={() => confirmar('CANCELADA', motivo)}>
            {guardando ? 'Cancelando…' : 'Cancelar la licitación'}
          </Boton>
        </>)}>
        <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50">¿Por qué se cancela?</h2>
        <p className="text-sm text-tinta-2 dark:text-slate-400 mt-1">Queda guardado en la ficha y en la pestaña Canceladas. Escribe el motivo real (mínimo {MIN_MOTIVO_CANCELACION} caracteres).</p>
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={4} maxLength={1000} autoFocus
          placeholder="Ej.: el organismo canceló la OC porque el presupuesto se reasignó."
          className="mt-3 w-full rounded-lg border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-tinta dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-marca/40" />
        <p className="mt-1 text-xs text-tinta-2 tabular-nums">{motivo.trim().length}/{MIN_MOTIVO_CANCELACION} mínimo</p>
      </Modal>
    ) : (
      <Modal open onClose={() => !guardando && setPaso(null)} size="sm"
        footer={(<>
          <Boton variante="fantasma" onClick={() => setPaso(null)} disabled={guardando}>No, volver</Boton>
          <Boton variante="primario" disabled={guardando} onClick={() => confirmar(paso.estado)}>{guardando ? 'Guardando…' : paso.estado === 'PAGADA' ? 'Sí, marcar pagada' : 'Sí, marcar entregada'}</Boton>
        </>)}>
        <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50">{paso.estado === 'PAGADA' ? '¿Facturada al cliente y pagada?' : '¿Ya se entregó?'}</h2>
        <p className="text-sm text-tinta-2 dark:text-slate-400 mt-1">
          {paso.estado === 'PAGADA' ? 'Al marcarla Pagada la licitación se cierra y pasa a la pestaña Cerradas.' : 'Entregada todavía no cierra la licitación: se cierra al estar facturada y pagada.'}
        </p>
        {paso.avisos.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800">
            {paso.avisos.map(a => <li key={a}>• {a}</li>)}
          </ul>
        )}
      </Modal>
    ),
    document.body,
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <EtiquetaEstadoCompra estado={estado} />
      {puede && siguiente && estado !== 'ABIERTA' && (
        <Boton tamano="sm" variante="secundario" onClick={() => pedirPaso(siguiente)}>{TEXTO_PASO[siguiente]}</Boton>
      )}
      {puede && estado === 'ABIERTA' && <Boton tamano="sm" variante="primario" onClick={() => confirmar('EN_PROCESO')} disabled={guardando}>Pasar a En proceso</Boton>}
      {puede && puedeCancelarseDesde(estado) && (
        <button type="button" onClick={() => setPaso('cancelar')} className="text-xs font-medium text-tinta-2 hover:text-rose-700 transition-colors">Cancelar licitación</button>
      )}
      {modal}
    </div>
  );
}
