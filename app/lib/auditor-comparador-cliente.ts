// app/lib/auditor-comparador-cliente.ts
// Lado navegador del COMPARADOR DE FICHAS (PROMPT 4): tipos del estado que devuelve
// /api/negocios/[id]/comercial/[itemId]/comparador y el encadenado "comparar → reverificar" que
// comparten la fila de la línea (arrastrar fichas) y el modal ("Auditar con IA").
// Sin imports de servidor: se puede usar desde Client Components.
import type {
  AnalisisCaracteristica, CausalAdmisibilidad, BloqueoP4, MensajeProveedor, FichaInventariada, AsignacionFicha,
  AlertaSobredimensionamiento, ResumenComparador, CriticidadP4,
} from '@/app/lib/auditor-comparador-core';

export interface FilaEstado {
  id: number;
  producto_index: number;
  descripcion: string;
  tipo: 'PISO' | 'TECHO' | 'EXACTO' | 'RANGO' | 'CUALITATIVO' | 'NORMATIVO';
  valor_requerido_texto: string | null;
  valor_requerido_numero: number | null;
  valor_requerido_numero_max: number | null;
  unidad_requerida: string | null;
  valor_ofertado_texto: string | null;
  valor_ofertado_numero: number | null;
  unidad_ofertada_original: string | null;
  valor_convertido_numero: number | null;
  veredicto: 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO' | null;
  pendiente_confirmacion_proveedor: boolean;
  fundamento_cita: string | null;
  criticidad: CriticidadP4;
  analisis: AnalisisCaracteristica;
  estado: 'CUMPLIDA' | 'NO_CUMPLIDA' | 'PENDIENTE';
  ruta_cierre: string;
}

export interface AdministrativoEstado {
  id: number; materia: string; exige_base_literal: string; fuente_bases: string; se_compromete: string;
  criticidad: CriticidadP4; precargado_cumplido: boolean; check_confirmado: boolean;
}

export interface EstadoComparador {
  usado: boolean;
  caracteristicas: FilaEstado[];
  resumen: ResumenComparador;
  alerta_sobredimensionamiento: AlertaSobredimensionamiento;
  tecnico_administrativo: AdministrativoEstado[];
  inventario_fichas: FichaInventariada[];
  mapa_asignacion: AsignacionFicha[];
  lineas_sin_ficha: Array<{ linea: number | null; producto: string }>;
  archivos_sin_asignar: Array<{ archivo: string; motivo: string }>;
  mensajes_proveedor: MensajeProveedor[];
  certificado_admisibilidad: CausalAdmisibilidad[];
  bloqueos: BloqueoP4[];
  no_pude_leer: Array<{ archivo: string; que: string; donde: string }>;
  requiere_confirmacion_modelo: boolean;
  comparado_at: string | null;
  hay_tecnicas: boolean;
}

export interface ResultadoComparador {
  ok: boolean;
  error?: string;
  aviso?: string;
  estado?: EstadoComparador;
  /** Hay un catálogo con varios modelos: una persona debe elegir cuál se ofrece antes de comparar. */
  requiereConfirmacion?: boolean;
  sinFichas?: boolean;
  rectificados?: number;
}

export const urlComparador = (negocioId: number, itemId: number) => `/api/negocios/${negocioId}/comercial/${itemId}/comparador`;

async function post(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

/** Estado actual del comparador de la línea (null si no se pudo leer — la pantalla sigue con la tabla clásica). */
export async function leerComparador(negocioId: number, itemId: number): Promise<EstadoComparador | null> {
  try {
    const r = await fetch(urlComparador(negocioId, itemId));
    const d = await r.json().catch(() => null);
    return r.ok && d?.success && d.migracion !== false ? (d as EstadoComparador) : null;
  } catch { return null; }
}

/**
 * L1 + L2 y, si no hay nada que confirmar, L3 (reverificación de rojos): el orden que pide el
 * prompt — la asignación la confirma un humano y los CUMPLE críticos se releen ANTES del certificado.
 */
export async function ejecutarComparador(
  negocioId: number, itemId: number,
  docs: Array<{ url: string; nombre: string }>, modelosConfirmados?: Record<string, string>,
): Promise<ResultadoComparador> {
  const base = urlComparador(negocioId, itemId);
  const c = await post(base, { accion: 'comparar', documentos: docs, ...(modelosConfirmados ? { modelosConfirmados } : {}) });
  if (!c.ok) return { ok: false, error: c.data?.error || 'No se pudo comparar la ficha' };
  if (c.data.requiereConfirmacion || c.data.sinFichas)
    return { ok: true, estado: c.data, requiereConfirmacion: !!c.data.requiereConfirmacion, sinFichas: !!c.data.sinFichas };

  const v = await post(base, { accion: 'reverificar' });
  if (!v.ok) return { ok: true, estado: c.data, aviso: `Se comparó, pero la reverificación de los ítems críticos falló: ${v.data?.error || 'error desconocido'}. Quedan pendientes.` };
  return { ok: true, estado: v.data, aviso: c.data.aviso, rectificados: v.data.rectificados || 0 };
}
