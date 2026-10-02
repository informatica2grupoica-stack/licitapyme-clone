// app/lib/aprobaciones-resumen.ts
// El badge del menú (AppLayout) y el aviso emergente (AprobacionPendienteModal) piden el MISMO
// resumen y se refrescan con el mismo evento en tiempo real: sin esto eran 2 peticiones idénticas
// en cada pantalla y en cada cambio. Las llamadas simultáneas comparten UNA sola petición en vuelo;
// al terminar se libera, así que el siguiente evento vuelve a consultar fresco.

let enVuelo: Promise<any> | null = null;

export function pedirResumenAprobaciones(): Promise<any> {
  if (!enVuelo) {
    enVuelo = fetch('/api/aprobaciones/resumen')
      .then(r => r.json())
      .finally(() => { enVuelo = null; });
  }
  return enVuelo;
}
