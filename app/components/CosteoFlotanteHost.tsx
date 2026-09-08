'use client';

// Monta la ÚNICA instancia GLOBAL de CosteoEditorCard cuando hay un negocio flotando — ver
// CosteoFlotanteContext.tsx para el porqué. Vive en app/layout.tsx, fuera del árbol de
// cualquier página, así que sobrevive a cualquier navegación de Next.js. En archivo aparte
// (no dentro de CosteoFlotanteContext.tsx) para no crear un import circular: este archivo
// importa CosteoEditorCard, y CosteoEditorCard importa `useCosteoFlotante` del contexto.
import { CosteoEditorCard } from '@/app/negocios/[id]/CosteoEditorCard';
import { useCosteoFlotante } from '@/app/components/CosteoFlotanteContext';

export function CosteoFlotanteHost() {
  const { activo } = useCosteoFlotante();
  if (!activo) return null;
  // `key={negocioId}`: si el negocio flotante cambia, se quiere una instancia NUEVA (con su
  // propio estado interno desde cero, sembrado por `estadoHeredado`) — nunca reciclar los hooks
  // de la instancia anterior con datos de otro negocio adentro.
  return (
    <CosteoEditorCard
      key={activo.negocioId}
      negocioId={activo.negocioId}
      licitacionCodigo={activo.licitacionCodigo}
      modoFlotanteGlobal
      estadoHeredado={activo.heredado ?? null}
    />
  );
}
