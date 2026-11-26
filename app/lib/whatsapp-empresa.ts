// app/lib/whatsapp-empresa.ts
// Límite de frecuencia para generar el QR de WhatsApp de una empresa-cliente. Cada pedido de QR BORRA y vuelve a crear la instancia en Evolution
// (whatsapp.ts → conectarInstancia): sin tope, un admin (o un script) podría martillar el servicio de WhatsApp compartido por todas las empresas.
export const SEGUNDOS_ENTRE_QR = 20;

/** Segundos que faltan para poder pedir otro QR (0 = ya se puede). Pura, para probarla sin servicio. */
export function esperaParaQr(ultimoMs: number | undefined, ahoraMs: number, segundos = SEGUNDOS_ENTRE_QR): number {
  if (ultimoMs == null) return 0;
  const falta = segundos * 1000 - (ahoraMs - ultimoMs);
  return falta > 0 ? Math.ceil(falta / 1000) : 0;
}

const ultimoQr = new Map<number, number>();

/** Reserva el turno de QR de una empresa. Devuelve 0 si se puede, o los segundos de espera. */
export function reservarQr(clienteId: number, ahoraMs = Date.now()): number {
  const espera = esperaParaQr(ultimoQr.get(clienteId), ahoraMs);
  if (espera === 0) ultimoQr.set(clienteId, ahoraMs);
  return espera;
}
