// app/components/MenuNegocioLateral.tsx
// Menú lateral ÚNICO de una licitación/negocio. Lo usan /negocios/[id] (padre) y
// /licitacion/[codigo] (solo para licitaciones que aún no son negocio): mismo título, mismo
// estilo, mismo orden. Las secciones las arma cada página (con sus contadores), pero el orden y
// las etiquetas salen de aquí para que no vuelvan a divergir.
'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { IconArrowLeft as ArrowLeft, IconCheck as Check, IconCalculator as Calculator, IconLock as Lock } from '@tabler/icons-react';

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
  // Sub-ítem: se pinta sangrado bajo el ítem anterior (Postulación bajo Auditor).
  sub?: boolean;
  // Multi-cliente: módulo que la empresa no tiene contratado. El ítem se ve en gris con candado; al tocarlo la pantalla explica qué falta.
  bloqueado?: boolean;
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
  // Postulación (PDFs a subir + resumen del Auditor): sub-ítem bajo Auditor.
  hayPostulacion?: boolean;
  // Módulos no contratados (empresa-cliente): sus ítems siguen en el menú, en gris.
  viabilidadBloqueada?: boolean;
  preguntasBloqueadas?: boolean;
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
  const { documentosCount, hayResultado, itemsCount, hayCosteo, hayAuditorTecnico, auditorCount, auditorAlerta, puedeVerAuditorCompra, hayPostulacion, viabilidadBloqueada, preguntasBloqueadas } = input;
  return [
    { key: 'resumen',    label: 'Resumen',    count: null },
    { key: 'documentos', label: 'Documentos', count: documentosCount || null },
    { key: 'items',      label: 'Líneas',     count: itemsCount || null },
    { key: 'viabilidad', label: 'Viabilidad', count: null, ...(viabilidadBloqueada ? { bloqueado: true } : {}) },
    ...(hayResultado ? [{ key: 'resultado', label: 'Resultado', count: null }] : []),
    ...(hayResultado ? [{ key: 'preguntas', label: 'Preguntas', count: null, ...(preguntasBloqueadas ? { bloqueado: true } : {}) }] : []),
    // Un solo ítem "Auditor" (módulo AUDITOR unificado, 29-sep-2026) que también contiene el Costeo: ya no es
    // un ítem propio del menú. Se mantiene la key 'comercial' para no romper los deep-links de /aprobaciones.
    ...(hayAuditorTecnico || puedeVerAuditorCompra || hayCosteo
      ? [{ key: 'comercial', label: 'Auditor', count: auditorCount || null, alerta: !!auditorAlerta, variante: 'compra' as const }]
      : []),
    ...(hayPostulacion ? [{ key: 'postulacion', label: 'Postulación', count: null, variante: 'compra' as const, sub: true }] : []),
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
  // Subrayado teal que se desliza a la pestaña activa (skill licitank-ui).
  const id = useId();
  return (
    <div role="tablist" className="flex gap-6 mb-5 border-b border-linea dark:border-slate-800 overflow-x-auto">
      {items.map(it => {
        const on = activo === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(it.key)}
            className={`relative flex items-center gap-1.5 pb-3 pt-0.5 text-sm whitespace-nowrap transition-colors duration-150 ${
              on ? 'font-semibold text-tinta dark:text-slate-50' : 'font-medium text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {it.label}
            {it.count != null && it.count > 0 && (
              <span className={`text-xs font-semibold tabular-nums ${on ? 'text-marca' : 'text-tinta-3'}`}>{it.count}</span>
            )}
            {on && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-marca" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
          </button>
        );
      })}
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
  // Acceso rápido fijo bajo el menú (Costeo: abre la burbuja flotante sin salir de la sección actual).
  accesoRapido?: { label: string; onClick: () => void };
}

export function MenuNegocioLateral({ items, activa, onSelect, volverHref, onVolver, cargandoContadores, visitados, accesoRapido }: Props) {
  // Estilo del sistema de diseño (skill licitank-ui): activo en teal con fondo que se desliza; la fase
  // de auditoría (variante 'compra') sigue en ámbar para distinguirla (pedido del usuario, 28-sep-2026).
  const clsVolver = 'flex items-center gap-1.5 text-[13px] text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-100 transition-colors';
  return (
    <aside className="hidden lg:flex flex-col w-48 border-r border-linea bg-white flex-shrink-0 overflow-y-auto dark:bg-slate-900 dark:border-slate-800">
      <div className="px-4 pt-5 pb-4">
        {volverHref ? (
          <Link href={volverHref} className={clsVolver}><ArrowLeft size={14} /> Volver</Link>
        ) : (
          <button onClick={onVolver} className={clsVolver}><ArrowLeft size={14} /> Volver</button>
        )}
      </div>
      <div className="px-3 pb-2">
        <p className="text-[11px] text-slate-500 px-2.5 pb-2">El negocio</p>
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
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] text-slate-300 font-medium cursor-not-allowed select-none"
                >
                  <span>{s.label}</span>
                </div>
              );
            }

            return (
              <button
                key={s.key}
                onClick={() => onSelect(s.key)}
                className={`relative w-full flex items-center justify-between py-2 rounded-lg text-[13px] transition-colors duration-150 ${s.sub ? 'pl-6 pr-2.5' : 'px-2.5'} ${
                  activo
                    ? (esCompra ? 'text-amber-800 font-semibold dark:text-amber-300' : 'text-marca font-semibold dark:text-teal-300')
                    : 'text-tinta-2 hover:text-tinta hover:bg-slate-50 font-medium dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800'
                } ${s.bloqueado ? 'opacity-50' : ''}`}
                title={s.bloqueado ? 'No está incluido en tu plan' : undefined}
              >
                {activo && (
                  <motion.span layoutId="menu-negocio-activo" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className={`absolute inset-0 rounded-lg ${esCompra ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-marca-suave dark:bg-teal-950/40'}`} />
                )}
                <span className="relative flex items-center gap-1.5">
                  {visitado
                    ? <Check size={13} className={esCompra ? 'text-amber-500' : 'text-exito'} />
                    : <span aria-hidden className={`w-[13px] flex justify-center`}><span className={`w-1.5 h-1.5 rounded-full ${activo ? (esCompra ? 'bg-amber-500' : 'bg-marca') : 'bg-slate-300 dark:bg-slate-600'}`} /></span>}
                  {s.label}
                  {s.bloqueado && <Lock size={12} className="text-slate-400" />}
                </span>
                {s.count != null && s.count > 0 && (
                  // Rojo cuando hay trabajo detenido esperando el visto bueno del asesor.
                  <span className={`relative text-xs font-semibold tabular-nums ${
                    s.alerta ? 'text-urgente' : activo ? (esCompra ? 'text-amber-700' : 'text-marca') : 'text-tinta-3'
                  }`}>
                    {s.alerta && !cargandoContadores && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-urgente mr-1 align-middle" />}
                    {cargandoContadores ? '…' : s.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      {accesoRapido && (
        <div className="px-3 pb-4 mt-auto">
          <button
            onClick={accesoRapido.onClick}
            title="Abre el costeo digital sin salir de esta sección"
            className="w-full flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium text-tinta bg-white border border-linea shadow-tarjeta hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Calculator size={15} className="text-slate-500" /> {accesoRapido.label}
          </button>
        </div>
      )}
    </aside>
  );
}
