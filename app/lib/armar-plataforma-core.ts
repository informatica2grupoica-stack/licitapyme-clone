// app/lib/armar-plataforma-core.ts — partes PURAS de «armar la plataforma desde el RUT» (sin base de datos: se prueban solas).

export interface ArmadoAutomatico { fecha: string; palabras: string[]; negativas: string[]; alertas: number }

export interface DatosProveedorMP { rut: string; giro: string; direccion: string; region: string }

/** Solo una empresa VIRGEN se arma sola: si alguien ya escribió su perfil, puso palabras o confirmó, no se le pisa nada. */
export function puedeArmarse(e: { estado: string | null | undefined; confirmada: boolean; yaArmada: boolean; conPerfil: boolean; palabras: number }): boolean {
  return e.estado === 'LISTO' && !e.confirmada && !e.yaArmada && !e.conPerfil && e.palabras === 0;
}

/** Al confirmar por primera vez: de lo que el sistema puso solo, lo que la persona DESMARCÓ (o cambió de lista) hay que quitarlo. */
export function palabrasASacar(armado: Pick<ArmadoAutomatico, 'palabras' | 'negativas'>, positivas: string[], negativas: string[]): Array<{ keyword: string; negativa: 0 | 1 }> {
  const pos = new Set(positivas), neg = new Set(negativas);
  return [
    ...armado.palabras.filter(k => !pos.has(k)).map(keyword => ({ keyword, negativa: 0 as const })),
    ...armado.negativas.filter(k => !neg.has(k)).map(keyword => ({ keyword, negativa: 1 as const })),
  ];
}

/** Datos de la EMPRESA que MP publica en sus órdenes de compra (nunca los de la persona de contacto). Solo si la OC es de ese RUT. */
export function datosDeProveedor(oc: any, rutsPropios: Set<string>): DatosProveedorMP | null {
  const p = oc?.Proveedor;
  const rut = String(p?.RutSucursal || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (!rut || !rutsPropios.has(rut)) return null;
  const t = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 250);
  const direccion = [t(p.Direccion), t(p.Comuna)].filter(Boolean).join(', ');
  return { rut, giro: t(p.Actividad), direccion, region: t(p.Region) };
}
