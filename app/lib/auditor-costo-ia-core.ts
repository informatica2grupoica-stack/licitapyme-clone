// app/lib/auditor-costo-ia-core.ts
// AUDITOR · VERIFICADOR DE COSTO con IA (Prompt 5 v2.0) — la parte que decide el CÓDIGO. Puro (sin base de datos ni red).
// El modelo lee los respaldos de costo de UNA opción y devuelve lo que el código no puede ver por reglas: costos ocultos (V5), errores de unidad o
// empaque (V2), producto distinto (V1), plazo (V8) y la AYUDA de cinco campos. Pero lo que dice el modelo NO se usa directo: cada hallazgo debe traer una
// cita que exista LITERALMENTE en el texto de los documentos (mismo guardarraíl que el verificador técnico) o se descarta. El modelo nunca decide un
// bloqueo ni el veredicto: solo agrega alertas y ayuda; el veredicto lo sigue calculando `verificarOpcion`.
import { citaExiste, type Alerta } from '@/app/lib/auditor-compras-core';

export interface SalidaCostoIA {
  verificaciones?: {
    V1_identidad?: { estado?: string; marca_respaldo?: string; modelo_respaldo?: string; cita?: string };
    V2_unidad?: { estado?: string; detalle?: string; cita?: string };
    V5_costos_ocultos?: Array<{ tipo?: string; detalle?: string; monto?: string; cita?: string }>;
    V8_plazo?: { plazo_proveedor?: string; tipo_dias?: string; cita?: string };
  };
  ayuda?: { diagnostico?: string; causa_probable?: string; pregunta_proveedor?: string; accion_concreta?: string; datos_para_impacto?: string };
  eventos?: Array<{ tipo?: string; detalle?: string }>;
  no_pude_leer?: Array<{ respaldo?: string; que?: string; donde?: string }>;
}

export interface AyudaCosto { diagnostico: string; causaProbable: string; preguntaProveedor: string; accionConcreta: string; datosParaImpacto: string }
export interface ResultadoCostoIA {
  alertas: Alerta[];
  ayuda: AyudaCosto | null;
  productoCambiado: { marca: string; modelo: string } | null;
  descartados: string[];        // hallazgos del modelo que el código no aceptó (sin cita literal, etc.): se muestran para poder auditar al auditor
  noPudeLeer: Array<{ que: string; donde: string }>;
}

const t = (v: unknown, max = 400) => (v == null ? '' : String(v)).trim().slice(0, max);
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿La alerta del modelo repite algo que el código ya avisó? (mismo código y palabras en común). */
function yaAvisado(existentes: Alerta[], codigo: string, detalle: string): boolean {
  const palabras = norm(detalle).split(' ').filter(w => w.length > 3);
  if (palabras.length === 0) return false;
  return existentes.some(a => a.codigo === codigo && (() => {
    const m = norm(a.mensaje);
    return palabras.filter(w => m.includes(w)).length >= Math.min(2, palabras.length);
  })());
}

/**
 * @param textoDocumentos el texto COMPLETO de los respaldos de costo de la opción (contra el que se verifican las citas)
 * @param alertasCodigo   lo que el código ya detectó (para no repetirlo)
 * @param hayProblema     la opción no quedó VERIFICADA: solo entonces se muestra la ayuda (nunca a un CUMPLE, como en el Prompt 5 Parte VII)
 */
export function evaluarCostoIA(salida: SalidaCostoIA, textoDocumentos: string, alertasCodigo: Alerta[], hayProblema: boolean): ResultadoCostoIA {
  const alertas: Alerta[] = [], descartados: string[] = [];
  const v = salida.verificaciones || {};
  const acumuladas = [...alertasCodigo];
  const agregar = (a: Alerta) => { alertas.push(a); acumuladas.push(a); };
  const conCita = (cita: string | undefined, que: string): boolean => {
    if (!t(cita)) { descartados.push(`${que}: sin cita`); return false; }
    if (!citaExiste(textoDocumentos, cita)) { descartados.push(`${que}: la cita no figura en el documento («${t(cita, 80)}»)`); return false; }
    return true;
  };

  // V5 — costos ocultos: lo que hace que el precio visible no sea el precio real de compra.
  for (const c of v.V5_costos_ocultos || []) {
    const detalle = [t(c.tipo).replace(/_/g, ' '), t(c.detalle), t(c.monto)].filter(Boolean).join(' · ');
    if (!detalle || !conCita(c.cita, `V5 ${detalle.slice(0, 60)}`)) continue;
    if (yaAvisado(acumuladas, 'V5', `${c.detalle || ''} ${c.tipo || ''}`)) continue;
    agregar({ codigo: 'V5', nivel: 'amarillo', mensaje: `Costo que podría no estar en el costeo: ${detalle}. Verifica que el costo real de compra lo incluya.`, cita: t(c.cita, 160), accion: 'corregir_costeo' });
  }

  // V2 — unidad, empaque o cantidad.
  const v2 = v.V2_unidad;
  if (v2?.estado === 'ERROR' && t(v2.detalle) && conCita(v2.cita, 'V2') && !yaAvisado(acumuladas, 'V2', v2.detalle!))
    agregar({ codigo: 'V2', nivel: 'amarillo', mensaje: `Posible error de unidad o cantidad: ${t(v2.detalle)}.`, cita: t(v2.cita, 160), accion: 'pedir_proveedor' });

  // V1 — el respaldo parece ser de OTRO producto. El bloqueo lo decide el código (V1 sobre marca/modelo extraídos); aquí solo se avisa y se emite el evento.
  let productoCambiado: ResultadoCostoIA['productoCambiado'] = null;
  const v1 = v.V1_identidad;
  if (v1?.estado === 'NO_COINCIDE' && (t(v1.marca_respaldo) || t(v1.modelo_respaldo)) && conCita(v1.cita, 'V1')) {
    productoCambiado = { marca: t(v1.marca_respaldo, 120), modelo: t(v1.modelo_respaldo, 160) };
    if (!yaAvisado(acumuladas, 'V1', `${productoCambiado.marca} ${productoCambiado.modelo}`))
      agregar({ codigo: 'V1', nivel: 'rojo', mensaje: `El verificador de costo lee que el respaldo es de otro producto (${[productoCambiado.marca, productoCambiado.modelo].filter(Boolean).join(' ')}). Corrige la opción o crea una nueva.`, cita: t(v1.cita, 160), accion: 'corregir_costeo' });
  }

  // V8 — plazo del proveedor (sin plazo ofertado a mano no se compara: se muestra para que quien define el plazo lo tenga presente).
  const v8 = v.V8_plazo;
  if (t(v8?.plazo_proveedor) && conCita(v8?.cita || v8?.plazo_proveedor, 'V8') && !yaAvisado(acumuladas, 'V8', v8!.plazo_proveedor!))
    agregar({ codigo: 'V8', nivel: 'info', mensaje: `Plazo del proveedor: ${t(v8!.plazo_proveedor)}${v8!.tipo_dias && v8!.tipo_dias !== 'no_declarado' ? ` (días ${v8!.tipo_dias})` : ''}. Compáralo con el plazo que vamos a ofertar.`, cita: t(v8!.cita, 160), accion: 'revisar' });

  const a = salida.ayuda;
  const ayuda: AyudaCosto | null = hayProblema && a && (t(a.diagnostico) || t(a.accion_concreta))
    ? { diagnostico: t(a.diagnostico, 600), causaProbable: t(a.causa_probable, 500), preguntaProveedor: t(a.pregunta_proveedor, 500), accionConcreta: t(a.accion_concreta, 500), datosParaImpacto: t(a.datos_para_impacto, 400) }
    : null;

  return { alertas, ayuda, productoCambiado, descartados, noPudeLeer: (salida.no_pude_leer || []).filter(x => x?.que).map(x => ({ que: t(x.que, 200), donde: t(x.donde, 200) })) };
}
