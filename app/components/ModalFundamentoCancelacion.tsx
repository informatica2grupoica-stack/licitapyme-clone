'use client';

// FUNDAMENTO DE OC CANCELADA (pedido del dueño, 10-nov-2026; migration-187).
//
// Cuando el organismo cancela la orden de compra de una licitación ganada, los encargados de esa
// licitación (el comercial que la postuló + encargado y coencargados de Compras) tienen que escribir
// por qué se canceló. Es bloqueante a propósito: no hay X, ni Esc, ni clic afuera. La única salida es
// guardar el fundamento (mín. 20 caracteres). Con un fundamento guardado por cualquiera de los
// encargados, el aviso desaparece para todos. Si hay varias, se muestran de a una, la más antigua primero.
import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconBan as Ban } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { useToast } from '@/app/components/ui/toast';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Datos, Dato } from '@/app/components/ui/kit/Tarjeta';
import { EASE_LK } from '@/app/components/ui/kit/movimiento';

interface Pendiente {
  id: number; negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; organismo: string | null;
  ocCodigo: string; canceladaAt: string | null; montoOc: number | null; cerroCompras: boolean;
}

const MIN = 20;
const fecha = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('-') : null);
const clp = (n: number | null) => (n == null ? null : `$${Math.round(n).toLocaleString('es-CL')}`);

export function ModalFundamentoCancelacion() {
  const { usuario } = useSession();
  const toast = useToast();
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!usuario || usuario.rol === 'externo') return;
    try {
      const r = await fetch('/api/compras/oc-canceladas');
      const d = await r.json();
      if (d.success) setPendientes(d.pendientes || []);
    } catch { /* silencioso: este aviso nunca deja la app inutilizable por un error de red */ }
  }, [usuario]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!usuario || usuario.rol === 'externo') return;
    return suscribirRealtime(() => cargar());   // la cancelación llega por la campana o por el bus de Compras
  }, [usuario, cargar]);

  const actual = pendientes[0];
  const largo = texto.trim().length;

  const guardar = async () => {
    if (!actual || enviando || largo < MIN) return;
    setEnviando(true); setError(null);
    try {
      const r = await fetch('/api/compras/oc-canceladas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: actual.id, fundamento: texto }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo guardar');
      setTexto('');
      setPendientes(d.pendientes || []);
      toast.success('Fundamento guardado', `Queda registrado en ${actual.licitacionCodigo}.`);
    } catch (e: any) {
      setError(e.message);
      cargar();   // si otro encargado ya lo fundamentó, el aviso se va
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AnimatePresence>
      {actual && (
        <motion.div key="fondo" role="dialog" aria-modal="true" aria-labelledby="fundamento-titulo"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_LK }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div key={actual.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_LK }}
            className="w-full max-w-xl rounded-2xl bg-white shadow-flotante dark:bg-slate-900 dark:border dark:border-slate-800">
            <div className="px-6 pt-6 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
                <Ban size={18} className="text-urgente" />
              </div>
              <div className="min-w-0">
                <h2 id="fundamento-titulo" className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50">
                  El organismo canceló la orden de compra
                </h2>
                <p className="mt-1 text-sm text-tinta-2 dark:text-slate-400">
                  Eres encargado de esta licitación. Para seguir usando Licitank escribe por qué se canceló.
                </p>
              </div>
            </div>

            <div className="px-6 pt-5">
              <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 leading-snug">{actual.licitacionNombre || actual.licitacionCodigo}</p>
              <Datos columnas={2}>
                <Dato rotulo="Licitación"><span className="tabular-nums">{actual.licitacionCodigo}</span></Dato>
                <Dato rotulo="Orden de compra cancelada"><span className="tabular-nums">{actual.ocCodigo}</span></Dato>
                <Dato rotulo="Organismo">{actual.organismo && <span title={actual.organismo}>{actual.organismo}</span>}</Dato>
                <Dato rotulo="Fecha de cancelación">{fecha(actual.canceladaAt)}</Dato>
                <Dato rotulo="Monto de la OC (con IVA)">{clp(actual.montoOc)}</Dato>
                <Dato rotulo="En Compras">{actual.cerroCompras ? 'Pasó a Compras cerradas' : 'Sigue abierto: hay compras a proveedores emitidas'}</Dato>
              </Datos>

              <label htmlFor="fundamento-texto" className="block mt-5 text-[13px] font-medium text-tinta dark:text-slate-100">¿Por qué se canceló?</label>
              <textarea id="fundamento-texto" value={texto} onChange={e => setTexto(e.target.value)} rows={4} autoFocus maxLength={4000}
                placeholder="Ej.: el organismo pidió anular la OC porque el ítem 3 quedó sin presupuesto; van a emitir una nueva por el resto."
                className="mt-1.5 w-full rounded-lg border border-linea bg-white px-3 py-2 text-sm text-tinta placeholder:text-tinta-3 focus:outline-none focus:ring-2 focus:ring-marca/40 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
              <div className="mt-1 flex justify-between gap-3 text-xs">
                <span className="text-urgente">{error}</span>
                <span className={`tabular-nums ${largo >= MIN ? 'text-tinta-3' : 'text-alerta'}`}>{largo < MIN ? `faltan ${MIN - largo} caracteres` : `${largo} caracteres`}</span>
              </div>
            </div>

            <div className="px-6 py-5 mt-2 flex items-center justify-between gap-3 border-t border-linea dark:border-slate-800">
              <span className="text-xs text-tinta-3 tabular-nums">{pendientes.length > 1 ? `1 de ${pendientes.length} cancelaciones por fundamentar` : ''}</span>
              <Boton variante="primario" onClick={guardar} disabled={enviando || largo < MIN}>
                {enviando ? 'Guardando…' : 'Guardar fundamento'}
              </Boton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
