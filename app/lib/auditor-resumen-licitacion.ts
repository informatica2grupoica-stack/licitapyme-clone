// app/lib/auditor-resumen-licitacion.ts
// AUDITOR · RESUMEN DE LA LICITACIÓN (Prompt 4 v3.0, Paso 5). Puro y SIN imports: la pantalla del Auditor lo usa en el navegador.
// Por línea: la opción más barata con estado CUMPLE; si no hay, la más barata con FALTA DATO (marcada). Al final: costo total contra el presupuesto del
// organismo, con alerta 🔴 si lo supera, 🟡 si la diferencia es menor al 20% del presupuesto y ✅ si es 20% o más.
export type EstadoProductoV3 = 'CUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO';

export interface OpcionResumen { opcionId: number; etiqueta: string; estado: EstadoProductoV3 | 'SIN_VERIFICAR'; costoUnitNeto: number | null }
export interface LineaParaResumen { filaId: string; item: number; nombre: string; cantidad: number | null; noOfertada: boolean; opciones: OpcionResumen[] }
export interface FilaResumen { filaId: string; item: number; nombre: string; cantidad: number | null; mejor: OpcionResumen | null; faltaDato: boolean; totalNeto: number | null }
export interface ResumenLicitacion {
  filas: FilaResumen[]; costoTotal: number; lineasSinOpcion: number;
  /** Todas las líneas ofertadas tienen su mejor opción: solo entonces el total es comparable con el presupuesto. */
  completo: boolean;
  presupuesto: number | null; queda: number | null; quedaPct: number | null;
  alerta: 'rojo' | 'amarillo' | 'verde' | 'sin_presupuesto';
}

/** Por línea: la opción más barata con estado CUMPLE; si no hay, la más barata con FALTA DATO (marcada). NO CUMPLE y sin precio no compiten. */
export function resumenLicitacion(lineas: LineaParaResumen[], presupuestoNeto: number | null): ResumenLicitacion {
  const filas: FilaResumen[] = lineas.filter(l => !l.noOfertada).map(l => {
    const conCosto = l.opciones.filter(o => o.costoUnitNeto != null);
    const masBarata = (xs: OpcionResumen[]) => [...xs].sort((a, b) => (a.costoUnitNeto as number) - (b.costoUnitNeto as number))[0] ?? null;
    const cumple = masBarata(conCosto.filter(o => o.estado === 'CUMPLE'));
    const mejor = cumple ?? masBarata(conCosto.filter(o => o.estado === 'FALTA_DATO'));
    return { filaId: l.filaId, item: l.item, nombre: l.nombre, cantidad: l.cantidad, mejor, faltaDato: !!mejor && mejor.estado !== 'CUMPLE',
      totalNeto: mejor && l.cantidad != null ? Math.round((mejor.costoUnitNeto as number) * l.cantidad) : null };
  });
  const costoTotal = filas.reduce((n, f) => n + (f.totalNeto ?? 0), 0);
  const queda = presupuestoNeto != null ? presupuestoNeto - costoTotal : null;
  const quedaPct = queda != null && presupuestoNeto ? Math.round((queda / presupuestoNeto) * 1000) / 10 : null;
  const alerta: ResumenLicitacion['alerta'] = presupuestoNeto == null ? 'sin_presupuesto' : costoTotal > presupuestoNeto ? 'rojo' : (queda as number) < presupuestoNeto * 0.2 ? 'amarillo' : 'verde';
  return { filas, costoTotal, lineasSinOpcion: filas.filter(f => !f.mejor).length, completo: filas.every(f => !!f.mejor) && filas.length > 0, presupuesto: presupuestoNeto, queda, quedaPct, alerta };
}
