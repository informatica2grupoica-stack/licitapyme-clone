// app/components/MenuNegocioLateral.tsx
// Menú lateral ÚNICO de una licitación/negocio. Lo usan /negocios/[id] (padre) y
// /licitacion/[codigo] (solo para licitaciones que aún no son negocio): mismo título, mismo
// estilo, mismo orden. Las secciones las arma cada página (con sus contadores), pero el orden y
// las etiquetas salen de aquí para que no vuelvan a divergir.
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { IconArrowLeft as ArrowLeft, IconCheck as Check } from '@tabler/icons-react';

export interface ItemMenuNegocio {
  key: string;
  label: string;
  count: number | null;
  alerta?: boolean;
  // Otro color para marcar una fase distinta del flujo (Auditor Técnico y Auditor de Compra son
  // "auditorías", no pasos de armado de la oferta — pedido del usuario, 28-sep-2026).
  variante?: 'compra';
  // Ítem visible pero todavía no clickeable. Sin uso hoy (Auditor de Compra pasó a estar activo
  // en todo momento, pedido del usuario, 29-sep-2026) — se deja el soporte por si vuelve a hacer
  // falta para otro ítem futuro.
  disabled?: boolean;
}

export interface NavSeccionesNegocioInput {
  documentosCount: number | null;
  // ¿Ya sabemos si ganamos o perdimos? (usar tieneResultado() de app/lib/pipeline.ts)
  hayResultado: boolean;
  itemsCount?: number | null;
  hayCosteo?: boolean;
  hayAuditorTecnico?: boolean;
  auditorCount?: number | null;
  auditorAlerta?: boolean;
  // ¿Ganamos? (esGanado()) — ya no condiciona el ítem de Auditor de Compra (ver
  // puedeVerAuditorCompra); se deja el campo por si una fase futura vuelve a necesitarlo.
  hayGanado?: boolean;
  // ¿Puede este usuario ver y trabajar la pestaña Auditor de Compra? (admin o permiso
  // `auditor_compra`, ver app/lib/api-auth.ts) — mismo criterio que Auditor Técnico: activo en todo
  // momento desde que hay información comercial, sin esperar a que el negocio gane (pedido
  // explícito del usuario, 29-sep-2026 — "después lo vemos si lo activamos con algún estado"). Solo
  // /negocios/[id] lo pasa.
  puedeVerAuditorCompra?: boolean;
}

// Arma la lista de ítems del menú lateral: MISMO orden, MISMAS etiquetas y MISMO criterio de
// visibilidad para /negocios/[id] y /licitacion/[codigo] (antes cada página armaba su propio
// NAV_SECTIONS y solo se sincronizaba el orden a mano). Fechas, Criterios y Comentarios viven
// como pestañas DENTRO de "Resumen" (ver SeccionTabs más abajo); Competencia vive como pestaña
// dentro de "Resultado". Auditor Técnico y Auditor de Compra son ítems DISTINTOS y separados
// (pedido explícito del usuario, 28-sep-2026: "son distintos, que no estén juntos").
//
// Orden = línea de avance real del negocio: Resumen → Documentos → Líneas → Viabilidad →
// Resultado/Preguntas (solo con Ganada o Perdida) → Costeo → Auditor Técnico → Auditor de Compra
// (disponibles desde que se asigna, ver tieneInformacionComercial en checklist-comercial.ts).
export function construirNavSeccionesNegocio(input: NavSeccionesNegocioInput): ItemMenuNegocio[] {
  const { documentosCount, hayResultado, itemsCount, hayCosteo, hayAuditorTecnico, auditorCount, auditorAlerta, puedeVerAuditorCompra } = input;
  return [
    { key: 'resumen',    label: 'Resumen',    count: null },
    { key: 'documentos', label: 'Documentos', count: documentosCount || null },
    { key: 'items',      label: 'Líneas',     count: itemsCount || null },
    { key: 'viabilidad', label: 'Viabilidad', count: null },
    ...(hayResultado ? [{ key: 'resultado', label: 'Resultado', count: null }] : []),
    ...(hayResultado ? [{ key: 'preguntas', label: 'Preguntas', count: null }] : []),
    // Un solo ítem "Auditor" (módulo AUDITOR unificado, 29-sep-2026) que también contiene el Costeo: ya no es
    // un ítem propio del menú. Se mantiene la key 'comercial' para no romper los deep-links de /aprobaciones.
    ...(hayAuditorTecnico || puedeVerAuditorCompra || hayCosteo
      ? [{ key: 'comercial', label: 'Auditor', count: auditorCount || null, alerta: !!auditorAlerta, variante: 'compra' as const }]
      : []),
  ];
}

// Marca cada ítem del flujo como "visitado" (persistido en localStorage por licitación, no por
// usuario/dispositivo) y avisa —con un toast suave, no bloqueante— cuando se entra a un paso
// habiéndose saltado uno anterior sin ver. Los ítems `disabled` (Auditor de Compra antes de
// ganar) quedan fuera del flujo: no se pueden visitar, así que no cuentan para el salto.
export function useFlujoNegocio({
  negocioKey, items, seccionActual, toast,
}: {
  negocioKey: string | number | null | undefined;
  items: ItemMenuNegocio[];
  seccionActual: string;
  toast: { info: (mensaje: string, descripcion?: string) => void };
}): Set<string> {
  const [visitados, setVisitados] = useState<Set<string>>(new Set());
  const avisados = useRef<Set<string>>(new Set()); // no repetir el mismo aviso en esta sesión de pestaña
  const storageKey = negocioKey != null ? `flujo_negocio_visitado_${negocioKey}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setVisitados(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch { setVisitados(new Set()); }
  }, [storageKey]);

  const clavesFlujo = items.filter(i => !i.disabled).map(i => i.key).join(',');

  useEffect(() => {
    if (!storageKey) return;
    const navegables = clavesFlujo ? clavesFlujo.split(',') : [];
    const idx = navegables.indexOf(seccionActual);
    if (idx < 0) return;

    const claveSaltada = navegables.slice(0, idx).find(k => !visitados.has(k));
    if (claveSaltada) {
      const avisoId = `${seccionActual}::${claveSaltada}`;
      if (!avisados.current.has(avisoId)) {
        avisados.current.add(avisoId);
        const item = items.find(i => i.key === claveSaltada);
        toast.info(
          `Te saltaste "${item?.label ?? claveSaltada}"`,
          'No es obligatorio, pero conviene revisarlo antes de seguir.',
        );
      }
    }

    if (!visitados.has(seccionActual)) {
      setVisitados(prev => {
        const next = new Set(prev).add(seccionActual);
        try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* localStorage no disponible */ }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionActual, clavesFlujo, storageKey]);

  return visitados;
}

export interface TabItemNegocio { key: string; label: string; count?: number | null }

// Barra de pestañas internas dentro de una sección del menú (Resumen agrupa
// Resumen/Fechas/Criterios/Comentarios; Resultado agrupa Resultado/Competencia). Mismo componente
// en ambas páginas para que la UI no vuelva a divergir entre ellas.
export function SeccionTabs({ items, activo, onSelect }: { items: TabItemNegocio[]; activo: string; onSelect: (key: string) => void }) {
  return (
    <div className="flex gap-4 mb-5 border-b border-zinc-200">
      {items.map(it => (
        <button
          key={it.key}
          onClick={() => onSelect(it.key)}
          className={`flex items-center gap-1.5 pb-2.5 -mb-px text-[13px] font-semibold border-b-2 transition-colors ${
            activo === it.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-zinc-400 hover:text-zinc-700'
          }`}
        >
          {it.label}
          {it.count != null && it.count > 0 && (
            <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${activo === it.key ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'}`}>
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface Props {
  items: ItemMenuNegocio[];
  activa: string;
  onSelect: (key: string) => void;
  volverHref?: string;
  onVolver?: () => void;
  cargandoContadores?: boolean;
  // Claves ya visitadas en el flujo (ver useFlujoNegocio) — se pintan de otro color aunque no
  // estén activas, para que se note el avance ("línea de realización").
  visitados?: Set<string>;
}

export function MenuNegocioLateral({ items, activa, onSelect, volverHref, onVolver, cargandoContadores, visitados }: Props) {
  const clsVolver = 'flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors font-medium';
  return (
    <aside className="hidden lg:flex flex-col w-44 border-r border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto">
      <div className="px-3 pt-4 pb-3">
        {volverHref ? (
          <Link href={volverHref} className={clsVolver}><ArrowLeft size={13} /> Volver</Link>
        ) : (
          <button onClick={onVolver} className={clsVolver}><ArrowLeft size={13} /> Volver</button>
        )}
      </div>
      <div className="px-3 pb-2">
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-2 pb-1.5">El negocio</p>
        <nav className="space-y-0.5">
          {items.map(s => {
            const esCompra = s.variante === 'compra';
            const activo   = activa === s.key;
            const visitado = !!visitados?.has(s.key) && !activo;

            if (s.disabled) {
              return (
                <div
                  key={s.key}
                  title="Todavía no disponible"
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] text-zinc-300 font-medium cursor-not-allowed select-none"
                >
                  <span>{s.label}</span>
                </div>
              );
            }

            return (
              <button
                key={s.key}
                onClick={() => onSelect(s.key)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] transition-all ${
                  activo
                    ? (esCompra ? 'bg-amber-50 text-amber-700 font-bold' : 'bg-indigo-50 text-indigo-700 font-bold')
                    : visitado
                      ? (esCompra ? 'text-amber-600 hover:bg-amber-50 font-medium' : 'text-emerald-600 hover:bg-emerald-50 font-medium')
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 font-medium'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {visitado && <Check size={11} className={esCompra ? 'text-amber-500' : 'text-emerald-500'} />}
                  {s.label}
                </span>
                {s.count != null && s.count > 0 && (
                  // Rojo cuando hay trabajo detenido esperando el visto bueno del asesor.
                  <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${
                    s.alerta ? 'bg-rose-500 text-white' : activo ? (esCompra ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600') : 'bg-zinc-100 text-zinc-400'
                  }`}>
                    {cargandoContadores ? '…' : s.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
