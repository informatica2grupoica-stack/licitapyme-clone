// app/lib/tipos-licitacion.ts
// Mapa completo de tipos de licitación de Mercado Público
// Referencia: https://api.mercadopublico.cl/modules/Licitacion.aspx

export interface TipoLicitacion {
  codigo: string;
  label:  string;
  labelCorto: string;
  color:  string;
  categoria: 'Pública' | 'Privada' | 'Trato' | 'OC' | 'Otro';
}

export const TIPOS_LICITACION: TipoLicitacion[] = [
  // ── Licitaciones Públicas ──────────────────────────────────────────
  { codigo: 'L1', label: 'Licitación Pública Menor a 100 UTM',               labelCorto: 'L1',  color: '#F97316', categoria: 'Pública'  },
  { codigo: 'LE', label: 'Licitación Pública Entre 100 y 1000 UTM',          labelCorto: 'LE',  color: '#EF4444', categoria: 'Pública'  },
  { codigo: 'LP', label: 'Licitación Pública Mayor a 1000 UTM',              labelCorto: 'LP',  color: '#3B82F6', categoria: 'Pública'  },
  { codigo: 'LS', label: 'Servicios personales especializados',               labelCorto: 'LS',  color: '#8B5CF6', categoria: 'Pública'  },
  { codigo: 'LQ', label: 'Licitación Menor Cuantía',                         labelCorto: 'LQ',  color: '#A855F7', categoria: 'Pública'  },
  // ── Licitaciones Privadas ──────────────────────────────────────────
  { codigo: 'A1', label: 'L. Privada por L. Pública anterior sin oferentes', labelCorto: 'A1',  color: '#0EA5E9', categoria: 'Privada'  },
  { codigo: 'B1', label: 'L. Privada por otras causales',                    labelCorto: 'B1',  color: '#06B6D4', categoria: 'Privada'  },
  { codigo: 'J1', label: 'L. Privada Servicios Confidenciales',              labelCorto: 'J1',  color: '#14B8A6', categoria: 'Privada'  },
  { codigo: 'F1', label: 'L. Privada Convenios Extranjeros',                 labelCorto: 'F1',  color: '#10B981', categoria: 'Privada'  },
  { codigo: 'E1', label: 'L. Privada Remanente de Contrato',                 labelCorto: 'E1',  color: '#059669', categoria: 'Privada'  },
  { codigo: 'CO', label: 'L. Privada Entre 100 y 1000 UTM',                  labelCorto: 'CO',  color: '#16A34A', categoria: 'Privada'  },
  { codigo: 'B2', label: 'L. Privada Mayor a 1000 UTM',                      labelCorto: 'B2',  color: '#15803D', categoria: 'Privada'  },
  { codigo: 'E2', label: 'L. Privada Menor a 100 UTM',                       labelCorto: 'E2',  color: '#166534', categoria: 'Privada'  },
  // ── Trato Directo ─────────────────────────────────────────────────
  { codigo: 'A2', label: 'Trato Directo por L. Privada sin oferentes',       labelCorto: 'A2',  color: '#6366F1', categoria: 'Trato'   },
  { codigo: 'D1', label: 'Trato Directo Proveedor Único',                    labelCorto: 'D1',  color: '#7C3AED', categoria: 'Trato'   },
  { codigo: 'C2', label: 'Trato Directo (Cotización)',                       labelCorto: 'C2',  color: '#9333EA', categoria: 'Trato'   },
  { codigo: 'C1', label: 'Compra Directa (Orden de compra)',                 labelCorto: 'C1',  color: '#A855F7', categoria: 'Trato'   },
  { codigo: 'F2', label: 'Trato Directo (Cotización) F2',                    labelCorto: 'F2',  color: '#C026D3', categoria: 'Trato'   },
  { codigo: 'F3', label: 'Compra Directa (Orden de compra) F3',              labelCorto: 'F3',  color: '#DB2777', categoria: 'Trato'   },
  { codigo: 'G2', label: 'Directo (Cotización)',                             labelCorto: 'G2',  color: '#E11D48', categoria: 'Trato'   },
  { codigo: 'G1', label: 'Compra Directa (Orden de compra) G1',              labelCorto: 'G1',  color: '#F43F5E', categoria: 'Trato'   },
  // ── Órdenes de Compra ─────────────────────────────────────────────
  { codigo: 'R1', label: 'Orden de Compra menor a 3 UTM',                   labelCorto: 'R1',  color: '#F97316', categoria: 'OC'      },
  { codigo: 'CA', label: 'Orden de Compra sin Resolución',                   labelCorto: 'CA',  color: '#EAB308', categoria: 'OC'      },
  { codigo: 'SE', label: 'OC sin emisión automática',                        labelCorto: 'SE',  color: '#84CC16', categoria: 'OC'      },
  // ── Otros (vistos en datos reales, no en docs oficiales) ──────────
  { codigo: 'SU', label: 'Subasta Inversa',                                  labelCorto: 'SU',  color: '#64748B', categoria: 'Otro'    },
  { codigo: 'O1', label: 'Orden de Compra',                                  labelCorto: 'O1',  color: '#78716C', categoria: 'OC'      },
];

const _MAP = new Map(TIPOS_LICITACION.map(t => [t.codigo, t]));

export function getTipoLicitacion(codigo: string): TipoLicitacion | null {
  return _MAP.get(codigo.toUpperCase()) ?? null;
}

/**
 * Extrae el código de tipo desde el CodigoExterno de una licitación.
 * Ej: "1057385-29-LE26" → "LE"
 *     "2125-28-L126"    → "L1"
 *     "1068829-1-O126"  → "O1"
 */
export function extractTipoFromCodigo(codigo: string): string {
  // Patrón: -TIPO_YEAR al final, donde TIPO puede ser 1-2 letras seguidas de 0-1 dígito
  const m = codigo.match(/-([A-Za-z]{1,2}[0-9]?)\d{2}[a-z]?$/i);
  return m ? m[1].toUpperCase() : '';
}

/** Colores para chips inline. Devuelve background + text classes de Tailwind más cercanas. */
export const TIPO_COLOR_CLASS: Record<string, string> = {
  L1: 'bg-orange-500', LE: 'bg-red-500',    LP: 'bg-blue-500',  LS: 'bg-violet-500',
  LQ: 'bg-purple-500', A1: 'bg-sky-500',    B1: 'bg-cyan-500',  J1: 'bg-teal-500',
  F1: 'bg-emerald-600',E1: 'bg-green-600',  CO: 'bg-green-500', B2: 'bg-green-700',
  E2: 'bg-green-800',  A2: 'bg-indigo-500', D1: 'bg-violet-600',C2: 'bg-purple-600',
  C1: 'bg-purple-500', F2: 'bg-fuchsia-600',F3: 'bg-pink-600',  G2: 'bg-rose-600',
  G1: 'bg-rose-500',   R1: 'bg-orange-500', CA: 'bg-yellow-500',SE: 'bg-lime-500',
  SU: 'bg-slate-500',  O1: 'bg-stone-500',
};
