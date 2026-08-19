// app/lib/anexos-repaso-ia.ts
// SEGUNDA PASADA — la IA REVISA lo que el diccionario ya rellenó (pedido explícito del usuario,
// 19-ago-2026: "que la primera pasada lo realice código y el repaso la IA, para tener dos cosas y
// mitigar errores").
//
// POR QUÉ ESTO Y NO VOLVER A LA IA QUE RELLENA: el motor determinista (anexos-determinista.ts)
// resuelve la casilla en ~20 ms, con test por regla y sin depender de que Z.AI conteste. Lo que NO
// puede hacer es dudar de sí mismo: si una regex calza con la etiqueta equivocada, escribe el dato
// equivocado con la misma seguridad con la que escribe el correcto — y eso termina en una
// declaración jurada. Este módulo agrega esa duda, sin devolverle a la IA el control del relleno.
//
// EL REVISOR NO RELLENA. Solo puede hacer tres cosas con una casilla YA resuelta:
//   · confirmarla        → no pasa nada, queda como estaba;
//   · degradarla         → pasa a PENDIENTE con el motivo del revisor, visible para el humano;
//   · proponer OTRO campo→ se acepta solo si ese campo existe en la ficha Y pasa los mismos
//                          guardarraíles de forma que el resto del motor (campoCalzaConLaEtiqueta).
// Nunca escribe texto libre: igual que el motor original, la IA nombra campos, el valor sale de
// `empresa[campo]`. Un revisor alucinando no puede inventar un RUT.
//
// SESGO DELIBERADO HACIA "OK": el diccionario acierta la enorme mayoría de las veces (medido:
// 18 de 20 casillas en el formulario de datos del oferente más común). Un revisor quisquilloso
// que degrade lo que estaba bien destruye la automatización y hace que el humano vuelva a llenar
// todo a mano — el resultado sería PEOR que no revisar. Por eso el prompt exige error evidente, y
// por eso existe el cortacircuito de abajo.
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { campoCalzaConLaEtiqueta, type EmpresaCampos, type Resolucion } from '@/app/lib/anexos-ia-motor';
import type { CandidatoCelda, CandidatoInline } from '@/app/lib/anexos-detectar';
import type { Parrafo } from '@/app/lib/anexos-docx';

/** Interruptor. Apagado, `repasarConIA` devuelve las resoluciones intactas sin gastar una llamada. */
export function repasoActivado(): boolean {
  return process.env.ANEXOS_IA_REPASO === '1';
}

// Si el revisor rechaza MÁS de esta proporción de lo que revisó, se descarta el repaso COMPLETO y
// se deja lo que hizo el diccionario. Un modelo que objeta la mitad de un formulario de datos del
// oferente no encontró medio formulario malo: se desalineó (prompt mal interpretado, respuesta
// corrida de índice, degradación del proveedor). En ese escenario, confiar en el código —que es
// determinista y testeado— es estrictamente mejor que vaciar el anexo.
const MAX_PROPORCION_RECHAZO = 0.4;
// Debajo de este número de casillas la proporción no significa nada (rechazar 1 de 2 es 50% y
// puede ser perfectamente correcto), así que el cortacircuito no se aplica.
const MIN_CASILLAS_PARA_CORTACIRCUITO = 5;

const TAMANO_LOTE = 12;
const LOTES_EN_PARALELO = 3;

export interface CasillaRevisada {
  clave: string;
  etiqueta: string;
  /** Qué hizo el revisor con ella. */
  veredicto: 'ok' | 'corregida' | 'degradada' | 'descartado';
  campoAntes?: string;
  campoDespues?: string;
  valorAntes: string;
  valorDespues?: string;
  motivo?: string;
}

export interface ResultadoRepaso {
  celda: Map<number, Resolucion>;
  inline: Map<string, Resolucion>;
  /** Bitácora de lo que hizo el revisor — para el banco de pruebas y para el log del servidor. */
  revisadas: CasillaRevisada[];
  /** true si el cortacircuito anuló el repaso completo. */
  anulado: boolean;
}

const SYS_REPASO = `Eres un revisor experto en licitaciones públicas chilenas (Ley N°19.886, Mercado Público). Un motor automático YA rellenó las casillas de un ANEXO DE OFERENTE en Word usando la ficha de la empresa. Tu trabajo NO es rellenar nada: es AUDITAR lo que ya se escribió y detectar el dato puesto en la casilla equivocada, antes de que el documento se presente.

Te doy la FICHA de la empresa y una lista NUMERADA de casillas YA RELLENADAS. De cada una ves: la etiqueta que trae el documento, el contexto real que la rodea, el NOMBRE DEL CAMPO de la ficha que se usó, y el VALOR que quedó escrito.

Para cada casilla devuelve un veredicto:
- "ok": el campo usado corresponde a lo que la etiqueta pide. ESTE ES EL VEREDICTO POR DEFECTO.
- "corregir": la etiqueta pide claramente OTRO campo de la ficha. Indica en "campo" el NOMBRE EXACTO del campo correcto (de la lista de la ficha). Nunca escribas un valor: solo el nombre del campo.
- "pendiente": la casilla NO se puede resolver con ningún campo de la ficha (la debe llenar un humano, o corresponde a un tercero, o es una decisión del oferente, o es un título que no pide dato). Indica el motivo en una frase corta y clara en español.

CRITERIO PARA DUDAR (los errores que de verdad ocurren, en orden de gravedad):
1. TITULAR CRUZADO: el dato de la empresa puesto donde se pide el de la persona, o al revés. Ojo: el oferente, el representante legal y el contacto son SIEMPRE la misma persona/empresa de la ficha, así que un teléfono o un correo repetido entre bloques NO es un error. El error real es de TIPO de dato: la razón social donde dice "Nombre del representante legal", o el RUT de la empresa donde dice "Cédula de identidad".
2. TIPO DE DATO EQUIVOCADO: un nombre donde se pide un RUT, una dirección completa donde se pide solo el número, la región donde se pide solo la comuna, un texto donde se pide una fecha.
3. TERCERO: el bloque describe a alguien externo (un cliente que certifica, la institución que emite un certificado, otro integrante de una UTP) y se escribieron datos NUESTROS. Eso es siempre "pendiente".
4. PERSONA QUE DESIGNAMOS PARA ESTA LICITACIÓN: coordinador técnico, jefe de proyecto, administrador del contrato, contraparte técnica. NO son la representante legal: sus datos los llena un asistente. Siempre "pendiente".
5. TÍTULO: la casilla es un encabezado que anuncia lo que viene abajo ("ANTECEDENTES GENERALES", "PROPUESTA:"), no pide un dato. Si al leer la línea en voz alta con el valor adentro queda sin sentido, es un título → "pendiente".

REGLA DE CONTENCIÓN (no negociable): el motor que rellenó acierta la enorme mayoría de las veces. Marca "corregir" o "pendiente" SOLO cuando el error sea EVIDENTE leyendo la etiqueta. Ante cualquier duda, responde "ok". Degradar una casilla correcta obliga a una persona a llenarla de nuevo a mano: es un costo real, no una precaución gratis.

Devuelve SOLO JSON, sin markdown, respondiendo TODAS las casillas que te di, en orden:
{"casillas":[{"id":<número>,"veredicto":"ok"|"corregir"|"pendiente","campo":"<nombre del campo>"|null,"motivo":"<frase corta>"|null}]}`;

interface ItemRepaso {
  n: number;
  clave: string;
  etiqueta: string;
  valor: string;
  campo?: string;
  texto: string;
  /** Dónde vive, para escribir el resultado en el mapa que corresponda. */
  destino: { tipo: 'celda'; indice: number } | { tipo: 'inline'; clave: string };
}

function contextoPrevio(parrafos: Parrafo[], antesDeIndice: number, cuantos = 2): string[] {
  const out: string[] = [];
  for (let i = antesDeIndice; i >= 0 && out.length < cuantos; i--) {
    const p = parrafos[i];
    if (p?.texto && !p.vacio) out.push(p.texto.slice(0, 140));
  }
  return out;
}

function describir(item: { n: number; etiqueta: string; campo?: string; valor: string }, contexto: string[]): string {
  const partes = [`etiqueta: "${item.etiqueta.slice(0, 160)}"`];
  if (contexto.length) partes.push(`contexto: ${contexto.map(c => `"${c}"`).join(' / ')}`);
  partes.push(`campo usado: ${item.campo || '(desconocido)'}`);
  partes.push(`valor escrito: "${item.valor.slice(0, 120)}"`);
  return `${item.n}. ${partes.join(' — ')}`;
}

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

async function enParaleloLimitado<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (let i = siguiente++; i < items.length; i = siguiente++) salida[i] = await fn(items[i]);
  }));
  return salida;
}

interface VeredictoIA { veredicto: 'ok' | 'corregir' | 'pendiente'; campo: string | null; motivo: string | null }

async function revisarLote(items: ItemRepaso[], ficha: string): Promise<Map<number, VeredictoIA>> {
  const out = new Map<number, VeredictoIA>();
  const user = `FICHA DE LA EMPRESA:\n${ficha}\n\nCASILLAS YA RELLENADAS (${items.length}):\n${items.map(i => i.texto).join('\n')}`;
  try {
    // Mismo modelo y misma política que el resto del motor: glm-4.7 (el cuidadoso, no el rápido) y
    // soloGlm para que una caída de Z.AI no derive a DeepSeek — un revisor peor que el revisado
    // sería peor que no revisar. Si la llamada falla entera, el catch deja todo como estaba.
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_REPASO }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 3_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true });

    const parsed: any = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
    const arr = Array.isArray(parsed.casillas) ? parsed.casillas : [];
    for (const r of arr) {
      if (!r) continue;
      const n = Number(r.id);
      if (!items.some(i => i.n === n)) continue;
      const veredicto = r.veredicto === 'corregir' || r.veredicto === 'pendiente' ? r.veredicto : 'ok';
      out.set(n, {
        veredicto,
        campo: typeof r.campo === 'string' && r.campo.trim() ? r.campo.trim() : null,
        motivo: typeof r.motivo === 'string' && r.motivo.trim() ? r.motivo.trim() : null,
      });
    }
  } catch (error) {
    // Igual que el resto del pipeline: un fallo del proveedor NO puede tumbar el relleno. Sin
    // veredictos, todas las casillas de este lote quedan como las dejó el diccionario.
    console.error('[anexos-repaso] Falló un lote de repaso, esas casillas quedan como las dejó el código:', String(error).slice(0, 200));
  }
  return out;
}

/**
 * Repasa con IA lo que el motor determinista ya resolvió.
 *
 * Solo mira las resoluciones `auto` que salieron de un campo de la ficha: lo pendiente ya lo va a
 * ver un humano (no hay nada que auditar) y lo que vino de las bases o de una orden de compra tiene
 * su propia evidencia y su propio prompt, con un criterio que este revisor no conoce.
 */
export async function repasarConIA(entrada: {
  celda: Map<number, Resolucion>;
  inline: Map<string, Resolucion>;
  candidatos: CandidatoCelda[];
  blancosInline: CandidatoInline[];
  parrafos: Parrafo[];
  empresa: EmpresaCampos;
}): Promise<ResultadoRepaso> {
  const { celda, inline, candidatos, blancosInline, parrafos, empresa } = entrada;
  const revisadas: CasillaRevisada[] = [];

  const items: ItemRepaso[] = [];
  let n = 0;
  for (const c of candidatos) {
    const r = celda.get(c.indice);
    if (r?.tipo !== 'auto' || !r.campo) continue;
    const item: ItemRepaso = {
      n: ++n, clave: `celda:${c.indice}`, etiqueta: c.etiqueta, valor: r.valor, campo: r.campo,
      texto: '', destino: { tipo: 'celda', indice: c.indice },
    };
    item.texto = describir(item, contextoPrevio(parrafos, c.indice - 1));
    items.push(item);
  }
  for (const b of blancosInline) {
    const clave = `${b.indiceRun}:${b.posEnTexto}`;
    const r = inline.get(clave);
    if (r?.tipo !== 'auto' || !r.campo) continue;
    const etiqueta = (b.textoMarcador || b.parrafoCompleto || b.contexto || '').slice(0, 200);
    const item: ItemRepaso = {
      n: ++n, clave: `inline:${clave}`, etiqueta, valor: r.valor, campo: r.campo,
      texto: '', destino: { tipo: 'inline', clave },
    };
    item.texto = describir(item, contextoPrevio(parrafos, b.indiceParrafo - 1, 1));
    items.push(item);
  }

  if (!items.length) return { celda, inline, revisadas, anulado: false };

  const ficha = (Object.keys(empresa) as (keyof EmpresaCampos)[])
    .filter(c => c !== 'firma_url' && c !== 'timbre_url' && empresa[c] != null && String(empresa[c]).trim())
    .map(c => `- ${c}: "${String(empresa[c])}"`)
    .join('\n');

  const mapas = await enParaleloLimitado(enLotes(items, TAMANO_LOTE), LOTES_EN_PARALELO, lote => revisarLote(lote, ficha));
  const veredictos = new Map<number, VeredictoIA>();
  for (const m of mapas) for (const [k, v] of m) veredictos.set(k, v);

  // Se calcula TODO primero y se aplica después: el cortacircuito necesita saber cuántos rechazos
  // hubo en total antes de tocar el primer mapa.
  const cambios: { item: ItemRepaso; nueva: Resolucion; registro: CasillaRevisada }[] = [];
  for (const item of items) {
    const v = veredictos.get(item.n);
    const base = { clave: item.clave, etiqueta: item.etiqueta, valorAntes: item.valor, campoAntes: item.campo };
    if (!v || v.veredicto === 'ok') { revisadas.push({ ...base, veredicto: 'ok' }); continue; }

    if (v.veredicto === 'corregir' && v.campo) {
      const valorNuevo = empresa[v.campo as keyof EmpresaCampos];
      const texto = valorNuevo == null ? '' : String(valorNuevo).trim();
      // La corrección pasa por los MISMOS guardarraíles que cualquier relleno: el campo tiene que
      // existir con dato real y el valor tiene que tener la forma de lo que la etiqueta pide. Una
      // corrección que no los pasa no se escribe — pero tampoco se ignora: que el revisor haya
      // objetado ya es motivo suficiente para que lo mire un humano.
      if (texto && campoCalzaConLaEtiqueta(item.etiqueta, texto)) {
        cambios.push({
          item,
          nueva: { tipo: 'auto', valor: texto, categoria: 'perfil_empresa', evidencia: item.etiqueta, campo: v.campo },
          registro: { ...base, veredicto: 'corregida', campoDespues: v.campo, valorDespues: texto, motivo: v.motivo || undefined },
        });
        continue;
      }
    }

    const motivo = v.motivo
      || 'El repaso automático marcó esta casilla como dudosa — complétala o confírmala a mano.';
    cambios.push({
      item,
      nueva: { tipo: 'pendiente', categoria: 'decision_del_usuario', motivo },
      registro: { ...base, veredicto: 'degradada', motivo },
    });
  }

  const rechazos = cambios.filter(c => c.registro.veredicto === 'degradada').length;
  if (items.length >= MIN_CASILLAS_PARA_CORTACIRCUITO && rechazos / items.length > MAX_PROPORCION_RECHAZO) {
    console.warn(
      `[anexos-repaso] CORTACIRCUITO: el revisor degradó ${rechazos} de ${items.length} casillas `
      + `(>${Math.round(MAX_PROPORCION_RECHAZO * 100)}%). Se descarta el repaso completo y queda lo que resolvió el diccionario.`,
    );
    for (const c of cambios) revisadas.push({ ...c.registro, veredicto: 'descartado' });
    return { celda, inline, revisadas, anulado: true };
  }

  for (const c of cambios) {
    if (c.item.destino.tipo === 'celda') celda.set(c.item.destino.indice, c.nueva);
    else inline.set(c.item.destino.clave, c.nueva);
    revisadas.push(c.registro);
  }

  const corregidas = revisadas.filter(r => r.veredicto === 'corregida').length;
  if (corregidas || rechazos) {
    console.log(`[anexos-repaso] ${items.length} casillas revisadas · ${corregidas} corregidas · ${rechazos} degradadas a pendiente`);
  }
  return { celda, inline, revisadas, anulado: false };
}
