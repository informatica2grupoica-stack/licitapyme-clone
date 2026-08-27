'use client';

// SELECTOR DE LÍNEAS A OFERTAR — "¿a qué líneas vamos?".
//
// En una licitación por línea casi nunca se postula a todas. Antes de esto nadie preguntaba: el
// Auditor Técnico creaba trabajo para las 7 líneas cuando se ofertaba solo la 7 (caso real
// 986278-14-LE26), el costeo pedía marcar línea por línea al cargar el Excel, y el Motor Comercial
// alertaba descuadres contra líneas que jamás se iban a ofertar.
//
// POR QUÉ VIVE ARRIBA DEL NEGOCIO Y NO DENTRO DEL AUDITOR: la decisión la consumen tres módulos
// (Auditor Técnico, costeo, Motor Comercial) y hay que tomarla TEMPRANO, antes de que se
// materialice el checklist. Metida dentro de una pestaña quedaría escondida justo para los otros
// dos.
//
// Mientras no se conteste, el sistema se comporta como siempre (genera todo): el banner insiste,
// no bloquea.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { ListChecks, Loader2, Check, X, Pencil, AlertTriangle } from 'lucide-react';

interface LineaDisponible {
  linea: number;
  nombre: string;
  cantidad: number | null;
  unidad: string | null;
  presupuesto: number | null;
  caracteristicas: number;
  /** La línea aparece en UNA sola de las dos vistas del informe (el manifiesto del parser o el
   *  listado de la IA). Se avisa en vez de resolverlo solo: medido el 26-ago-2026, 10 de 136
   *  informes por línea discrepan y ninguna de las dos fuentes es confiable siempre. */
  soloEn: 'comercial' | 'tecnico' | null;
  ofertamos: boolean;
}

const monto = (n: number | null) => (n == null ? null : `$${Math.round(n).toLocaleString('es-CL')}`);

export function SelectorLineasOferta({ negocioId, onGuardado }: {
  negocioId: number;
  /** El checklist y el costeo cambian con la decisión: el padre recarga lo que tenga en pantalla. */
  onGuardado?: () => void;
}) {
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaDisponible[]>([]);
  const [esPorLinea, setEsPorLinea] = useState(false);
  const [decidido, setDecidido] = useState(false);
  // Grupos del checklist ('linea_tecnica', 'precio') cuya numeración de línea no calza con la del
  // informe. La decisión se guarda igual, pero NO se aplica sobre esas filas: aplicarla marcaría
  // las equivocadas (pasó de verdad en 986278-14-LE26 antes de la guarda).
  const [desalineado, setDesalineado] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/lineas-oferta`);
      const d = await r.json();
      if (!d?.success) return;
      setEsPorLinea(!!d.esPorLinea);
      setDecidido(!!d.decidido);
      setLineas(d.lineas || []);
      setDesalineado(d.checklistDesalineado || []);
      // Sin decisión previa el panel arranca ABIERTO: si viniera colapsado detrás de un botón,
      // el caso normal (nadie contestó todavía) se seguiría comportando como si no existiera.
      setAbierto(!d.decidido);
    } catch { /* si falla, el banner simplemente no aparece: nada se rompe */ }
    finally { setCargando(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const alternar = (n: number) =>
    setLineas(prev => prev.map(l => (l.linea === n ? { ...l, ofertamos: !l.ofertamos } : l)));
  const todas = (v: boolean) => setLineas(prev => prev.map(l => ({ ...l, ofertamos: v })));

  const guardar = async () => {
    if (!lineas.some(l => l.ofertamos)) {
      toast.warning('Hay que ofertar al menos una línea');
      return;
    }
    setGuardando(true);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/lineas-oferta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineas: lineas.map(l => ({ linea: l.linea, ofertamos: l.ofertamos })) }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) { toast.error(d?.error || 'No se pudo guardar'); return; }
      setDecidido(true);
      setAbierto(false);
      toast.success(
        `Ofertamos ${d.ofertadas.length} línea${d.ofertadas.length === 1 ? '' : 's'}`,
        d.descartadas.length ? `Fuera de la oferta: ${d.descartadas.join(', ')}` : undefined,
      );
      onGuardado?.();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally { setGuardando(false); }
  };

  // Solo aplica a licitaciones por línea con líneas conocidas. En suma alzada no hay nada que elegir.
  if (cargando || !esPorLinea || lineas.length === 0) return null;

  const elegidas = lineas.filter(l => l.ofertamos);

  // Ya decidido y cerrado: una franja discreta con el resumen y el lápiz para cambiarlo.
  if (decidido && !abierto) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
        <ListChecks size={14} className="text-teal-600 flex-shrink-0" />
        <span className="min-w-0">
          Ofertamos {elegidas.length} de {lineas.length} línea{lineas.length === 1 ? '' : 's'}:{' '}
          <span className="font-semibold text-zinc-800 dark:text-zinc-100">
            {elegidas.map(l => l.linea).join(', ')}
          </span>
        </span>
        <button
          onClick={() => setAbierto(true)}
          className="ml-auto flex flex-shrink-0 items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 font-semibold hover:bg-white dark:border-zinc-600 dark:hover:bg-zinc-700"
        >
          <Pencil size={11} /> Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-lg border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-500/30 dark:bg-teal-500/10">
      <div className="mb-1 flex items-center gap-2">
        <ListChecks size={15} className="text-teal-600" />
        <h3 className="text-[13px] font-bold text-teal-900 dark:text-teal-200">
          Esta licitación es por línea ({lineas.length}). ¿A cuáles vamos?
        </h3>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-teal-800/80 dark:text-teal-300/80">
        Lo que marques acá manda en todo el negocio: el Auditor Técnico solo pide especificaciones
        de estas líneas, el costeo solo cuadra su presupuesto y el Motor Comercial deja de alertar
        por las demás. Se puede cambiar después.
      </p>

      {desalineado.length > 0 && (
        <div className="mb-2 flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-800">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-rose-500" />
          <span>
            El checklist {desalineado.includes('linea_tecnica') ? 'técnico' : 'de este negocio'} se
            generó con la numeración antigua (una fila por producto, no por línea), así que sus
            líneas no calzan con estas. Tu decisión se guarda, pero <strong>no se aplica sobre esas
            filas</strong> — marcar a ciegas dejaría fuera de la oferta el trabajo equivocado.
            Hay que reconciliarlo antes.
          </span>
        </div>
      )}

      {lineas.some(l => l.soloEn) && (
        <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <span>
            El análisis dejó dos listados de líneas que no calzan del todo (las marcadas abajo
            aparecen en uno solo). Revisa contra las bases antes de decidir — no lo resolvimos por
            ti para no elegir mal en silencio.
          </span>
        </div>
      )}

      <div className="mb-2 flex gap-2 text-[11px]">
        <button onClick={() => todas(true)} className="rounded border border-teal-300 px-2 py-0.5 font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-500/40 dark:text-teal-200 dark:hover:bg-teal-500/20">
          Todas
        </button>
        <button onClick={() => todas(false)} className="rounded border border-teal-300 px-2 py-0.5 font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-500/40 dark:text-teal-200 dark:hover:bg-teal-500/20">
          Ninguna
        </button>
        <span className="ml-auto self-center font-semibold text-teal-800 dark:text-teal-200">
          {elegidas.length} de {lineas.length} marcadas
        </span>
      </div>

      <div className="max-h-[280px] space-y-1 overflow-y-auto rounded border border-teal-200/70 bg-white p-1.5 dark:border-teal-500/20 dark:bg-zinc-900">
        {lineas.map(l => {
          const detalle = [
            l.cantidad != null && `${l.cantidad}${l.unidad ? ` ${l.unidad}` : ''}`,
            monto(l.presupuesto),
            l.caracteristicas > 0 && `${l.caracteristicas} especificación${l.caracteristicas === 1 ? '' : 'es'}`,
          ].filter(Boolean).join(' · ');
          return (
            <label
              key={l.linea}
              className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 transition-colors ${
                l.ofertamos ? 'bg-teal-50/70 dark:bg-teal-500/10' : 'opacity-55 hover:opacity-80'
              }`}
            >
              <input
                type="checkbox"
                checked={l.ofertamos}
                onChange={() => alternar(l.linea)}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
                  Línea {l.linea}
                </span>
                <span className="text-[12px] text-zinc-600 dark:text-zinc-300"> — {l.nombre}</span>
                {l.soloEn && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    {l.soloEn === 'comercial' ? 'sin ficha técnica' : 'sin línea en el económico'}
                  </span>
                )}
                {detalle && (
                  <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{detalle}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={guardar}
          disabled={guardando}
          className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Guardar líneas
        </button>
        {decidido && (
          <button
            onClick={() => { setAbierto(false); cargar(); }}
            className="flex items-center gap-1 rounded border border-zinc-300 px-2.5 py-1.5 text-[12px] font-semibold text-zinc-600 hover:bg-white dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X size={12} /> Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
