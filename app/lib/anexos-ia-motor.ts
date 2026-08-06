// app/lib/anexos-ia-motor.ts
// Motor ÚNICO de decisión del Anexo Creator (reemplaza anexos-diccionario.ts +
// anexos-ia-matching.ts + anexos-clasificar-ia.ts + anexos-ia-total.ts — decisión del usuario,
// 3-ago-2026: "solo IA, nada de diccionario"). Decide, para CADA casilla detectada del Word, una
// de 10 categorías (perfil de empresa/representante/contacto/banco, dato objetivo de ESTA
// licitación, dato específico de esta oferta, declaración de tercero, firma/fecha, no aplica, o
// decisión del usuario) y el valor final formateado — o explica POR QUÉ queda pendiente en vez de
// dejarla en blanco sin más.
//
// LO QUE NO CAMBIA: la DETECCIÓN estructural (dónde está cada blanco: anexos-detectar.ts,
// anexos-dividir.ts) y la ESCRITURA (anexos-docx.ts edita el <w:t> del run existente). Este
// archivo solo decide QUÉ VALOR va en cada casilla ya detectada — nunca toca el .docx.
//
// GUARDA ANTI-INVENCIÓN (se mantiene del diseño anterior, adaptada): para categorías de "perfil"
// el valor debe existir de verdad en la ficha de la empresa (comparado normalizado); si no calza,
// la casilla queda pendiente. Para "especifico_licitacion" (precio/cantidad) este motor NUNCA
// inventa el número — lo deja pendiente y el pipeline de costeo YA EXISTENTE (anexos-precios-ia.ts,
// sin tocar) lo resuelve cruzando contra el Motor Comercial, igual que hoy.
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import type { Parrafo } from '@/app/lib/anexos-docx';
import type { CandidatoCelda, CandidatoInline } from '@/app/lib/anexos-detectar';

export interface EmpresaCampos {
  razon_social: string | null;
  rut: string | null;
  direccion: string | null;
  region: string | null;
  giro: string | null;
  tipo_persona_juridica: string | null;
  fecha_sociedad: string | null;
  fecha_escritura: string | null;
  notaria: string | null;
  numero_repertorio: string | null;
  fojas_numero_anio: string | null;
  representante_nombre: string | null;
  representante_rut: string | null;
  representante_cargo: string | null;
  email1: string | null;
  telefono1: string | null;
  banco_tipo_cuenta: string | null;
  banco_numero: string | null;
  banco_nombre: string | null;
  banco_email: string | null;
  banco_titular_nombre: string | null;
  banco_titular_rut: string | null;
  firma_url: string | null;
  timbre_url: string | null;
  // Campos DERIVADOS (no son columnas de `empresas`) — los resuelve conCamposDerivados() en
  // anexos-derivados.ts justo antes de que este motor vea el registro.
  fecha_hoy?: string | null;
  // La fecha de hoy PARTIDA en tres. No es un capricho: el pie de firma más común de los anexos
  // chilenos es "Fecha: _______ /_______ /_______" — tres casillas separadas, una por parte. Con
  // solo `fecha_hoy` ("4 de agosto de 2026") el motor no tiene ningún campo que calce con "el día"
  // y las tres quedaban pendientes en todos los anexos.
  fecha_hoy_dia?: string | null;
  fecha_hoy_mes?: string | null;
  fecha_hoy_anio?: string | null;
  // El OTRO formato de fecha partida, igual de común: "___ de ___ de ___" (con la palabra "de"
  // en vez de barras) — ahí la casilla del medio pide el MES EN PALABRA ("agosto"), no el número.
  // En la práctica este trío lo resuelve detectarTripletesFecha (anexos-detectar.ts) sin pasar por
  // este motor; el campo queda documentado igual por si algún caso raro cae al camino normal.
  fecha_hoy_mes_palabra?: string | null;
  // Dirección partida (6-ago-2026, caso real 4777-24-LE26): un formulario "Domicilio: Calle ___
  // N°: ___ Comuna: ___ Ciudad: ___" son CUATRO casillas — sin esto, el único campo disponible era
  // `direccion` entera, y el motor la repetía completa en las cuatro (o, peor, elegía cualquier
  // otro campo con tal de llenar algo). `null` si `direccion` no trae una marca "N°"/"Nº" clara
  // que permita separar sin adivinar — ver calleYNumeroDeDireccion en anexos-derivados.ts.
  direccion_calle?: string | null;
  direccion_numero?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  // Datos de ESTA LICITACIÓN (tampoco son columnas de `empresas` — se resuelven en
  // anexos-datos.ts llamando a Mercado Público por el código de la licitación que se está
  // rellenando, ver obtenerLicitacionParaAnexo). Van en el MISMO objeto que la ficha de empresa
  // — no porque sean "de la empresa", sino porque el guardarraíl de categoría por categoría
  // (CAMPOS_PERMITIDOS_POR_CATEGORIA, categoría datos_licitacion) ya evita que se crucen con los
  // campos de la empresa; meterlos aparte hubiera significado duplicar toda esa maquinaria para
  // un objeto paralelo. 100% determinista, igual que fecha_hoy — la IA nunca los inventa, solo
  // elige NOMBRARLOS cuando una casilla los pide.
  licitacion_codigo?: string | null;
  licitacion_nombre?: string | null;
  licitacion_organismo?: string | null;
  licitacion_organismo_rut?: string | null;
  licitacion_direccion?: string | null;
  licitacion_comuna?: string | null;
  licitacion_region?: string | null;
  licitacion_unidad_compradora?: string | null;
  licitacion_monto_estimado?: string | null;
  licitacion_moneda?: string | null;
  licitacion_fecha_publicacion?: string | null;
  licitacion_fecha_cierre?: string | null;
}

export type CategoriaCampo =
  | 'perfil_empresa' | 'perfil_representante_legal' | 'perfil_contacto' | 'perfil_bancario'
  | 'datos_licitacion'
  | 'especifico_licitacion' | 'declaracion_tercero' | 'firma_fecha' | 'no_aplica_al_oferente'
  | 'decision_del_usuario';

const CATEGORIAS_PERFIL: CategoriaCampo[] = [
  'perfil_empresa', 'perfil_representante_legal', 'perfil_contacto', 'perfil_bancario', 'datos_licitacion',
];

// Qué campos de la ficha puede nombrar la IA para cada categoría — la condición NECESARIA (no
// suficiente) que impide que, dentro de un mismo bloque de representante legal, "cédula de
// identidad" termine con el NOMBRE porque las dos casillas comparten categoría
// perfil_representante_legal (bug real encontrado en pruebas: ambas devolvían
// representante_nombre). Acotar por categoría, no solo por "existe en la ficha", es lo que evita
// que un valor real pero del campo equivocado pase el guardarraíl.
//
// AJUSTE 6-ago-2026 (bug real medido en 1227338-6-LE26): separar perfil_empresa /
// perfil_representante_legal / perfil_contacto en tres pozos ESTANCOS costaba más de lo que
// protegía. En el ANEXO N°1 de ese documento —la tabla de identificación más común que existe—
// quedaron vacías tres casillas cuyo dato SÍ está en la ficha:
//   · "IDENTIFICACIÓN DEL REPRESENTANTE LEGAL — TELÉFONO"  (la IA respondió
//     categoria=perfil_representante_legal + campo=telefono1, y telefono1 no estaba en el pozo de
//     esa categoría → se descartó un acierto)
//   · "IDENTIFICACIÓN DEL CONTACTO — MAIL" y "— TELÉFONO"  (mismo mecanismo)
// El propio usuario lo dice de frente: en esta operación el oferente, el representante legal y el
// contacto/encargado son SIEMPRE la misma persona de la misma empresa, y los datos se repiten.
// Partir la ficha en tres compartimentos modela una distinción que no existe, y el precio es que
// cualquier desacuerdo de ETIQUETA (no de dato) borra el dato correcto.
//
// Las tres comparten ahora un solo pozo. Lo que protegía el corte —que "cédula de identidad" no
// termine con el NOMBRE— pasó a hacerlo `campoCalzaConLaEtiqueta` (más abajo), que valida la FORMA
// del valor contra lo que la etiqueta pide: es una comprobación directa sobre el dato, no un
// filtro indirecto por nombre de categoría, y además atrapa el error viniera de la categoría que
// viniera. Lo bancario y los datos de licitación siguen aparte a propósito: ahí sí hay dos titulares
// distintos posibles (la cuenta puede estar a nombre de otro) y dos fuentes de datos distintas.
const CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA: (keyof EmpresaCampos)[] = [
  'razon_social', 'rut', 'direccion', 'direccion_calle', 'direccion_numero', 'comuna', 'ciudad',
  'region', 'giro', 'tipo_persona_juridica',
  'fecha_sociedad', 'fecha_escritura', 'notaria', 'numero_repertorio', 'fojas_numero_anio',
  'representante_nombre', 'representante_rut', 'representante_cargo',
  'email1', 'telefono1',
  'fecha_hoy', 'fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_mes_palabra',
];

const CAMPOS_PERMITIDOS_POR_CATEGORIA: Record<string, (keyof EmpresaCampos)[]> = {
  perfil_empresa: CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA,
  perfil_representante_legal: CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA,
  perfil_contacto: CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA,
  perfil_bancario: [
    'banco_tipo_cuenta', 'banco_numero', 'banco_nombre', 'banco_email',
    'banco_titular_nombre', 'banco_titular_rut',
  ],
  datos_licitacion: [
    'licitacion_codigo', 'licitacion_nombre', 'licitacion_organismo', 'licitacion_organismo_rut',
    'licitacion_direccion', 'licitacion_comuna', 'licitacion_region', 'licitacion_unidad_compradora',
    'licitacion_monto_estimado', 'licitacion_moneda', 'licitacion_fecha_publicacion', 'licitacion_fecha_cierre',
  ],
};

// Motivo legible en español para cada categoría que NUNCA se autocompleta — se muestra en el
// modal como ayuda bajo el campo, en vez de una casilla vacía sin explicación.
const MOTIVO_POR_DEFECTO: Partial<Record<CategoriaCampo, string>> = {
  especifico_licitacion: 'Dato específico de esta oferta (precio, cantidad, plazo o especificación técnica) — se intenta cruzar contra el costeo y las bases; si tampoco aparece ahí, hay que escribirlo a mano.',
  declaracion_tercero: 'Debe completarlo y firmarlo un tercero (ej. un cliente anterior), no el oferente.',
  firma_fecha: 'Línea de firma o "ciudad y fecha" — se firma en papel o electrónicamente, no se completa aquí.',
  no_aplica_al_oferente: 'Es de uso interno del organismo comprador (o de un bloque que no corresponde a esta empresa) — no aplica.',
  decision_del_usuario: 'Hay que decidirlo — no se puede inferir de forma segura de la ficha ni del costeo.',
  datos_licitacion: 'Dato de esta licitación (organismo, código, monto, fechas) — no se pudo obtener de Mercado Público en este momento.',
};

export interface ResolucionAuto { tipo: 'auto'; valor: string; categoria: CategoriaCampo; evidencia: string | null }
export interface ResolucionPendiente { tipo: 'pendiente'; categoria: CategoriaCampo; motivo: string }
export type Resolucion = ResolucionAuto | ResolucionPendiente;

export interface AlertaInadmisibilidad { riesgo: string; datoQueLoResuelve: string; disponible: boolean }

export interface EntradaMotor {
  candidatos: CandidatoCelda[];
  blancosInline: CandidatoInline[];
  parrafos: Parrafo[];
  empresa: EmpresaCampos;
  basesTexto?: string;
  tituloAnexos?: string[]; // ordenFormularios — nombres de los anexos detectados, para el Paso 1
  postulaComoUTP?: boolean;   // ver contextoUTP en resolverLoteCampos
}

export interface ResultadoMotor {
  celda: Map<number, Resolucion>;         // key = CandidatoCelda.indice
  inline: Map<string, Resolucion>;        // key = `${indiceRun}:${posEnTexto}`
  alertasInadmisibilidad: AlertaInadmisibilidad[];
  checklistPendientes: string[];
}

// ── Normalización para el guardarraíl anti-invención (igual que el diseño anterior) ──────────
function normalizarValor(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\w@]+/g, '').trim();
}

export function valorExisteEnFicha(valor: string, empresa: EmpresaCampos): boolean {
  const n = normalizarValor(valor);
  if (!n) return false;
  return Object.values(empresa).some(v => v != null && normalizarValor(String(v)) === n);
}

// ── ¿El valor que va a escribirse tiene la FORMA de lo que la casilla pide? ──────────────────
// Reemplaza (y mejora) lo que antes intentaba el corte por categoría: en vez de preguntar "¿el
// nombre de campo pertenece al grupo que la IA declaró?", pregunta lo único que importa de verdad
// — "¿esto que voy a escribir se PARECE a lo que la etiqueta está pidiendo?". Un RUT donde dice
// "NOMBRE", o un nombre donde dice "RUT", se ven a simple vista y se atajan sin llamar a nadie.
//
// Solo dice que NO cuando hay contradicción evidente. Una etiqueta que no habla de ninguna de
// estas formas (giro, cargo, notaría, "Marca Ofertada"…) pasa sin opinión — este chequeo nunca
// puede ser la razón por la que un dato correcto se pierda.
const RE_PARECE_RUT = /^\s*\d{1,3}(\.\d{3})*\s*-\s*[\dkK]\s*$/;
const pareceRut = (v: string) => RE_PARECE_RUT.test(v);
const pareceCorreo = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const pareceTelefono = (v: string) => !/@/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7 && !pareceRut(v);
// Un N°/número de domicilio SIEMPRE trae al menos un dígito ("492", "575 N° 6", "s/n" es la única
// excepción real y es tan rara que no vale la pena contemplarla). Un nombre de persona, una razón
// social o una dirección completa (lo que terminaba cayendo ahí antes — caso real 4777-24-LE26,
// "Lidia Valenzuela" en la casilla "N°:") nunca tiene un dígito. Esta única condición basta para
// atajar el error sin importar qué campo equivocado haya propuesto la IA.
const pareceNumeroDomicilio = (v: string) => /\d/.test(v) && v.trim().length <= 25;
// Comuna/ciudad son UN nombre de lugar, no una dirección compuesta: si trae coma o la palabra
// "Región", es el campo `region`/`direccion` completo colado donde no correspondía.
const pareceLugarSuelto = (v: string) => !/,/.test(v) && !/\bregi[óo]n\b/i.test(v) && !pareceRut(v) && !pareceCorreo(v);

// Se evalúan EN ORDEN y manda la primera que calce: "Nombre y RUT del representante" es una
// etiqueta real y ahí el RUT es una respuesta válida, así que la regla de RUT tiene que ganarle a
// la de nombre.
const REGLAS_FORMA: { pide: RegExp; valido: (v: string) => boolean }[] = [
  { pide: /\b(rut|r\.\s*u\.\s*t|c[ée]dula|c\.\s*i\.|\brun\b|rol\s+[úu]nico\s+tributario)\b/i, valido: pareceRut },
  { pide: /\b(correo|e-?mail|mail|casilla\s+electr[óo]nica)\b/i, valido: pareceCorreo },
  { pide: /\b(tel[ée]fono|fono|celular|m[óo]vil|anexo\s+telef)\b/i, valido: pareceTelefono },
  // "N°"/"Nº"/"Número" SOLO cuando no viene pegado a RUT/teléfono (esos ya se resolvieron arriba
  // y ganan por orden). Cubre "N°:", "Número", "Nro" como etiqueta de casilla de domicilio.
  // OJO: nunca agregar una "o" suelta al char-class de abajo — "n[o]:" calza con "Fono:"/
  // "Teléfono:" (terminan en "no:"), solo el signo de grado real distingue "N°" de esas palabras.
  { pide: /(?:^|[^a-záéíóúñ])n[°º]\s*:|\bn[úu]mero\b|\bnro\.?\b/i, valido: pareceNumeroDomicilio },
  { pide: /\bcomuna\b|\bciudad\b/i, valido: pareceLugarSuelto },
  // Un nombre / razón social / dirección nunca es un RUT pelado ni un correo.
  { pide: /\b(nombre|raz[óo]n\s+social|direcci[óo]n|domicilio|calle)\b/i, valido: v => !pareceRut(v) && !pareceCorreo(v) },
];

export function campoCalzaConLaEtiqueta(etiqueta: string, valor: string): boolean {
  if (!etiqueta || !valor) return true;
  const regla = REGLAS_FORMA.find(r => r.pide.test(etiqueta));
  return regla ? regla.valido(valor) : true;
}

// Las TRES partes sueltas de la fecha de hoy ("06", "08", "2026") solo tienen sentido dentro de una
// línea partida en casillas ("Fecha: __ / __ / __", "___ de ___ de ___") — y ese caso ya se
// resuelve entero y determinista en detectarTripletesFecha, sin pasar por la IA. Si el modelo
// propone una de ellas para una CELDA o una etiqueta suelta, es siempre un error de juicio: queda
// un número huérfano en el documento sin nada que lo explique. Caso real medido (1058086-43-LP26,
// corriendo con el modelo de respaldo): el título "PROPUESTA:" terminó completado con "06".
// `fecha_hoy` (la fecha larga, "6 de agosto de 2026") sí es un valor válido para una celda "FECHA".
const CAMPOS_SOLO_PARA_TRIPLETE_DE_FECHA = new Set<string>(['fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_mes_palabra']);

const DESCRIPCION_CAMPO: Partial<Record<keyof EmpresaCampos, string>> = {
  razon_social: 'Razón social / nombre de la empresa',
  rut: 'RUT de la empresa',
  direccion: 'Dirección comercial COMPLETA (calle + número + comuna) — úsalo SOLO si la casilla pide "Domicilio"/"Dirección" en UNA sola casilla. Si la casilla dice "Calle", "N°"/"Número", "Comuna" o "Ciudad" por separado, usa el campo específico de abajo, nunca este entero.',
  direccion_calle: 'Solo el NOMBRE DE LA CALLE del domicilio comercial (sin número) — casilla "Calle".',
  direccion_numero: 'Solo el NÚMERO/N° del domicilio comercial (sin el nombre de la calle) — casilla "N°"/"Número".',
  comuna: 'Comuna del domicilio comercial — casilla "Comuna".',
  ciudad: 'Ciudad del domicilio comercial — casilla "Ciudad".',
  region: 'Región CON la comuna al final, ej. "Región del Bío Bío, Concepción" — úsalo SOLO si la casilla junta "Región y comuna" o "Ciudad, Región" en una sola casilla. Si la casilla pide solo "Comuna" o solo "Ciudad", usa esos campos, no este.',
  giro: 'Giro comercial',
  tipo_persona_juridica: 'Tipo de persona jurídica',
  fecha_sociedad: 'Fecha/tipo/notaría de constitución (texto libre, todo junto)',
  fecha_escritura: 'Fecha de la escritura de constitución (solo la fecha)',
  notaria: 'Notaría donde se firmó la escritura',
  numero_repertorio: 'Número de repertorio de la escritura',
  fojas_numero_anio: 'Fojas/Número/Año de inscripción de la escritura',
  representante_nombre: 'Nombre completo del representante legal',
  representante_rut: 'RUT/cédula de identidad del representante legal',
  representante_cargo: 'Cargo del representante legal',
  email1: 'Correo electrónico de la empresa',
  telefono1: 'Teléfono de la empresa',
  banco_tipo_cuenta: 'Tipo de cuenta bancaria',
  banco_numero: 'Número de cuenta bancaria',
  banco_nombre: 'Nombre del banco',
  banco_email: 'Correo electrónico para pagos',
  banco_titular_nombre: 'Nombre del titular de la cuenta bancaria (puede ser distinto de la razón social)',
  banco_titular_rut: 'RUT/cédula de identidad del titular de la cuenta bancaria',
  fecha_hoy: 'Fecha de hoy en formato largo ("4 de agosto de 2026") — con la que se firma y presenta esta oferta',
  fecha_hoy_dia: 'Solo el DÍA de hoy (número) — para pies de firma partidos: "Fecha: __ /__ /__"',
  fecha_hoy_mes: 'Solo el MES de hoy (número) — la casilla del medio de "Fecha: __ /__ /__"',
  fecha_hoy_anio: 'Solo el AÑO de hoy (4 dígitos) — la última casilla de "Fecha: __ /__ /__"',
  fecha_hoy_mes_palabra: 'Solo el MES de hoy EN PALABRA ("agosto") — la casilla del medio de "___ de __ de ___" (NUNCA el número ahí)',
  licitacion_codigo: 'Código/ID de ESTA licitación en Mercado Público',
  licitacion_nombre: 'Nombre/título de ESTA licitación',
  licitacion_organismo: 'Nombre del organismo comprador (la institución que licita, no el oferente)',
  licitacion_organismo_rut: 'RUT del organismo comprador',
  licitacion_direccion: 'Dirección de la unidad compradora del organismo',
  licitacion_comuna: 'Comuna de la unidad compradora del organismo',
  licitacion_region: 'Región de la unidad compradora del organismo',
  licitacion_unidad_compradora: 'Nombre de la unidad/departamento que compra dentro del organismo',
  licitacion_monto_estimado: 'Presupuesto o monto estimado de ESTA licitación',
  licitacion_moneda: 'Moneda de ESTA licitación',
  licitacion_fecha_publicacion: 'Fecha de publicación de ESTA licitación',
  licitacion_fecha_cierre: 'Fecha de cierre de ESTA licitación',
};

const TAMANO_LOTE = 8;
const CANTIDAD_PARRAFOS_PREVIOS = 6;

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

// Cuántos lotes van a la IA AL MISMO TIEMPO. BUG REAL medido (1227338-6-LE26, 100 casillas → 13
// lotes): con `Promise.all` sobre todos los lotes, las 13 llamadas salían de golpe, Z.AI
// respondía 429 y la cadena de respaldo bajaba rung por rung hasta salirse de GLM y terminar
// resolviendo el documento ENTERO con deepseek-chat — el modelo que este pipeline justamente evita
// (ver el comentario de `modeloPreferido: glm-4.7` más abajo). No era un problema de prompt ni de
// detección: el documento se llenaba con el peor modelo disponible por saturar la cuota nosotros
// mismos. De a 3 el trabajo sigue siendo paralelo, sin gatillar el límite.
const LOTES_EN_PARALELO = 3;

async function enParaleloLimitado<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(trabajadores);
  return out;
}

function contextoPrevio(parrafos: Parrafo[], antesDeIndice: number): string[] {
  const out: string[] = [];
  for (let i = antesDeIndice - 1; i >= 0 && out.length < CANTIDAD_PARRAFOS_PREVIOS; i--) {
    const p = parrafos[i];
    if (p?.texto && !p.vacio) out.push(p.texto);
  }
  return out.reverse();
}

// ── Prompt (adaptado del prompt del usuario — mismo conocimiento de dominio, reglas de formato
// chilenas y regla de oro anti-alucinación; la SALIDA se simplifica al esquema real de este
// pipeline: cada lote resuelve una lista plana de casillas, las alertas de inadmisibilidad se
// calculan aparte en una sola pasada sobre las bases — ver resolverAlertasInadmisibilidad) ──────
const SYS_CAMPOS = `Eres un experto en licitaciones públicas chilenas (Mercado Público) que completa los ANEXOS que el organismo comprador entrega en Word para que los llene el oferente. Conoces la Ley N°19.886 de Bases sobre Contratos Administrativos de Suministro y Prestación de Servicios y la operatoria del portal: apertura de ofertas, evaluación por criterios ponderados, causales de inadmisibilidad, garantías, y las figuras de oferente persona natural, persona jurídica y Unión Temporal de Proveedores (UTP).

Te doy la FICHA de la empresa que postula y una lista NUMERADA de CASILLAS EN BLANCO detectadas en el documento, cada una con su etiqueta y el CONTEXTO real que la rodea (fila/columna de tabla, o el párrafo completo con la casilla marcada como 【CASILLA A LLENAR】).

Para cada casilla, decide su CATEGORÍA y su VALOR:

a) "perfil_empresa" | "perfil_representante_legal" | "perfil_contacto" | "perfil_bancario": el dato sale de la ficha DE LA EMPRESA — indica el NOMBRE EXACTO del campo de la ficha (ej. "representante_rut", "razon_social"), NUNCA reescribas el valor tú mismo. Ojo: dentro de una misma oración pueden pedirse VARIOS campos distintos de la MISMA persona (nombre en una casilla, cédula en otra, domicilio en otra) — cada casilla es un campo distinto, nunca repitas el mismo campo en dos casillas que piden cosas distintas.
b) "datos_licitacion": dato OBJETIVO de ESTA LICITACIÓN tal cual está publicada — código/ID, nombre del organismo comprador, RUT del organismo, dirección/comuna/región de la unidad compradora, presupuesto/monto estimado, moneda, fecha de publicación, fecha de cierre. Mismo criterio que a): indica el NOMBRE EXACTO del campo (ej. "licitacion_organismo", "licitacion_codigo"), nunca reescribas el valor. Distinto de c): acá el dato YA está fijado por el organismo que licita, no depende de lo que el oferente cotice o declare.
c) "especifico_licitacion": precio, cantidad, plazo, especificación técnica exigida, certificación, o cumplimiento técnico de un producto — NO SALE de la ficha de empresa ni de los datos objetivos de la licitación. Nunca le pongas valor: usa null (un paso aparte, sobre las Bases, intenta resolver estas después).
d) "declaracion_tercero": lo debe completar y firmar alguien externo al oferente (ej. un cliente anterior en un certificado de experiencia, otro integrante de una UTP, el organismo/mandante). Valor null.
e) "firma_fecha": SOLO una raya de firma manuscrita, o "Ciudad y fecha ___" pegado a ESA raya. Una declaración jurada que TERMINA en "declara bajo juramento que:" o similar NO es firma_fecha por sí sola — sus datos (nombre, cédula, domicilio) son perfil_* si los pide, igual que cualquier otro bloque. Valor null.
f) "no_aplica_al_oferente": encabezado/columna sin dato propio que pedir, bloque de Persona Natural o UTP (esta empresa postula como persona jurídica individual), o anexo de uso interno del organismo licitante ("USO DE LA ENTIDAD LICITANTE", pautas de evaluación internas). Valor null.
g) "decision_del_usuario": exige elegir entre opciones que no se infieren de datos objetivos (ej. qué nivel de programa de integridad declarar, si pertenece a un grupo empresarial) y no viene resuelto en ninguna ficha. Valor null.

TÍTULOS QUE NO SON CASILLAS: la detección es a propósito ruidosa y te va a pasar, mezclados con las casillas reales, encabezados y títulos de sección ("PROPUESTA:", "1. Detalle del suministro", "ANTECEDENTES GENERALES", "OFERTA ECONÓMICA:"). Un título ANUNCIA lo que viene abajo, no pide un dato: categoria="no_aplica_al_oferente", campo=null. La señal es simple — si al escribir el valor ahí la línea quedaría sin sentido leída en voz alta ("PROPUESTA: 06"), es un título. Ante la duda entre título y campo, elige título: una casilla de más que el humano llena es un costo menor que un dato suelto en medio del documento.

REGLA CLAVE — UNA SOLA PERSONA: el oferente, el representante legal, el encargado de la propuesta, el contacto para la licitación y el administrador de contrato son SIEMPRE la misma persona de la ficha. Si un bloque pide "Nombre completo", "Cargo", "Cédula de identidad", "Teléfono" o "Correo" bajo cualquiera de esos títulos (incluida una declaración jurada corrida: "Yo, don ___, cédula de identidad N° ___, en representación de ___"), se llena con los datos del representante legal / de la empresa según el dato pedido — no lo dejes pendiente por dudar de quién es.

DOS EJEMPLOS CONCRETOS DE DECLARACIÓN JURADA CORRIDA (el caso que MÁS se falla — analízalos con calma, casilla por casilla, NUNCA los trates como un solo bloque de firma):
1. "El proponente, por medio de su representante legal, don 【CASILLA A LLENAR】 declara bajo juramento lo siguiente:" → la casilla pide el NOMBRE del representante legal → categoria="perfil_representante_legal", valor=representante_nombre. Que la oración diga "declara bajo juramento" NO la vuelve firma_fecha: es el estilo legal del texto, no una raya de firma.
2. "Yo, 【CASILLA-1】 cédula de identidad N°【CASILLA-2】, con domicilio en 【CASILLA-3】, en representación de 【CASILLA-4】, RUT N° 【CASILLA-5】, declaro bajo juramento que:" — son 5 casillas en la MISMA oración, CADA UNA pide un campo DISTINTO, nunca repitas el campo de una en otra:
   CASILLA-1 (justo tras "Yo,") → categoria=perfil_representante_legal, campo=representante_nombre (el nombre de la persona que declara).
   CASILLA-2 (tras "cédula de identidad N°") → categoria=perfil_representante_legal, campo=representante_rut (el RUT de esa MISMA persona — NUNCA el nombre de nuevo).
   CASILLA-3 (tras "con domicilio en") → categoria=perfil_empresa, campo=direccion.
   CASILLA-4 (tras "en representación de") → categoria=perfil_empresa, campo=razon_social (a QUIÉN representa: la empresa).
   CASILLA-5 (tras "RUT N°", la segunda vez que aparece "RUT" en la oración) → categoria=perfil_empresa, campo=rut (el RUT de la EMPRESA, distinto del RUT de la persona en CASILLA-2).
   Ninguna de las cinco es firma_fecha. Lee la palabra INMEDIATAMENTE ANTES de cada casilla para no confundir cuál pide qué — no asumas que todas piden lo mismo solo porque están en la misma oración.

MARCADORES DEL ORGANISMO (léelos, son la instrucción literal): muchas casillas no son una raya de guiones sino un marcador con texto adentro, que te llega como 【CASILLA A LLENAR — el documento dice: "…"】. Ese texto dice EXACTAMENTE qué va ahí y manda sobre cualquier inferencia del contexto:
- "<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>" tras "el Oferente," → es el OFERENTE, o sea la EMPRESA que postula → perfil_empresa / razon_social (no el representante: al representante lo nombran aparte, con "don" o "representante legal de").
- "[Insertar Nombre o Razón Social]" → perfil_empresa/razon_social · "[Insertar RUT]" → perfil_empresa/rut · "[Insertar ID de Mercado Público]" → datos_licitacion/licitacion_codigo · "[Nombre Completo del Representante Legal]" → perfil_representante_legal/representante_nombre · "[Número de RUN]" → perfil_representante_legal/representante_rut · "[fecha]" → perfil_empresa/fecha_hoy · "[ciudad/país]" → perfil_empresa/region.
- Un marcador que es una INSTRUCCIÓN al oferente ("[indicar en esta casilla el número o nombre del documento que respalda…]", "[marcar con una X]") NO es un dato de la ficha: categoria="especifico_licitacion" o "decision_del_usuario" con valor null — lo llena el humano sabiendo qué documentos va a adjuntar. Nunca lo autocompletes ni lo dejes fuera: tiene que quedar visible como pendiente.

PIE DE FIRMA CON FECHA PARTIDA: día, mes y año de la fecha en que se presenta la oferta, categoria=perfil_empresa en las tres — NUNCA firma_fecha (la firma es la raya, la fecha se escribe). Hay DOS formatos, y la casilla del MES cambia de campo según cuál sea:
- Con barras, "Fecha: 【CASILLA-1】 / 【CASILLA-2】 / 【CASILLA-3】" → campo fecha_hoy_dia, fecha_hoy_mes (NÚMERO), fecha_hoy_anio.
- Con la palabra "de", "【CASILLA-1】 de 【CASILLA-2】 de 【CASILLA-3】" (ej. "Viña del Mar, ___ de ___ de ___") → campo fecha_hoy_dia, fecha_hoy_mes_palabra (EN PALABRA, "agosto" — jamás el número aquí, nadie escribe "3 de 08 de 2026"), fecha_hoy_anio.

REGLAS DE FORMATO CHILENAS:
- RUT: cópialo TAL CUAL viene en la ficha (no lo reformatees ni "corrijas").
- Fechas que el oferente completa (no una firma física): formato largo en español ("21 de agosto de 2026") — usa el campo fecha_hoy si la casilla pide "Fecha" pelada.
- Nunca inventes nacionalidad, estado civil, profesión, ciudad, capital social, número de empleados — si no está en la ficha, no lo pongas.

REGLA DE ORO ANTI-ALUCINACIÓN (no negociable): si no tienes un valor confirmado en alguna ficha (empresa o licitación) para una casilla de categoría a) o b), el valor es null — NUNCA lo inventes ni lo deduzcas. Es peor un dato equivocado en una declaración jurada que uno pendiente.

LA PRUEBA QUE APLICAS A CADA CASILLA: ¿la etiqueta MISMA nombra un dato de la empresa o de la licitación tal cual está publicada? Si describe otra cosa (característica de un producto, "Cumple Sí/No", "Observaciones", "Marca", "Modelo", "Página/Catálogo") es especifico_licitacion o no_aplica_al_oferente con valor null, SIEMPRE. La mayoría de las casillas de un anexo técnico NO llevan datos de la empresa ni de la licitación — devolver muchos null es la respuesta correcta, no un error tuyo.

Devuelve SOLO JSON, sin markdown ni texto adicional, respondiendo TODAS las casillas que te di, en orden:
{"campos":[{"id":<número>,"categoria":"<una de las 10>","campo":"<nombre exacto del campo de la ficha>"|null}]}`;

function formatearCandidatoCelda(c: CandidatoCelda, parrafos: Parrafo[], n: number): string {
  const partes: string[] = [];
  const compuesta = c.etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (compuesta) partes.push(`etiqueta: "${compuesta[2]}"`, `fila/bloque: "${compuesta[1]}"`);
  else partes.push(`etiqueta: "${c.etiqueta}"`);
  const previos = contextoPrevio(parrafos, c.indice - 1);
  if (previos.length) partes.push(`texto anterior: ${previos.map(p => `"${p.slice(0, 160)}"`).join(' / ')}`);
  return `${n}. ${partes.join(' — ')}`;
}

function formatearCandidatoInline(b: CandidatoInline, n: number): string {
  // Si el blanco venía como MARCADOR ("<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>", "[Insertar
  // RUT]"), su texto se conserva DENTRO del marcador de casilla en vez de borrarlo: es la
  // instrucción literal del organismo sobre qué va ahí, la mejor pista posible. Sin esto, el
  // marcador se reemplazaba por 【CASILLA A LLENAR】 a secas y el modelo perdía justo el dato que
  // desambigua (ej. "[Número de RUN]" vs "[Insertar RUT]" en la misma oración del anexo 11).
  const marca = b.textoMarcador ? `【CASILLA A LLENAR — el documento dice: "${b.textoMarcador.slice(0, 120)}"】` : '【CASILLA A LLENAR】';
  if (b.parrafoCompleto != null && b.posEnParrafo != null) {
    const marcado = b.parrafoCompleto.slice(0, b.posEnParrafo) + marca + b.parrafoCompleto.slice(b.posEnParrafo + b.largo);
    return `${n}. blanco dentro de una oración — oración completa: "${marcado.slice(0, 360)}"`;
  }
  return `${n}. blanco dentro de una oración — contexto: "${(b.contexto || '(sin contexto)').slice(0, 160)}"${b.textoMarcador ? ` — el documento dice: "${b.textoMarcador.slice(0, 120)}"` : ''}`;
}

interface ItemLote {
  n: number;
  ref: { tipo: 'celda'; c: CandidatoCelda } | { tipo: 'inline'; b: CandidatoInline };
  texto: string;
}

async function resolverLoteCampos(
  items: ItemLote[], empresa: EmpresaCampos, camposConDato: (keyof EmpresaCampos)[],
  postulaComoUTP = false,
): Promise<Map<number, Resolucion>> {
  const out = new Map<number, Resolucion>();
  const ficha = camposConDato
    .map(c => `- ${c}: "${String(empresa[c])}"   (${DESCRIPCION_CAMPO[c] ?? c})`)
    .join('\n');
  // Sin este contexto, la regla f) del prompt manda a null TODO bloque de UTP — que es lo correcto
  // por defecto (la empresa postula sola), pero deja el anexo de UTP vacío justo cuando el usuario
  // acaba de confirmar en la pantalla que esta vez sí se presenta en unión temporal.
  const contextoUTP = postulaComoUTP
    ? '\n\nCONTEXTO DE ESTA OFERTA: en ESTA licitación la empresa se presenta en UNIÓN TEMPORAL DE PROVEEDORES (UTP), como uno de sus integrantes. Por lo tanto la excepción "bloque de UTP → no_aplica_al_oferente" de la regla f) NO corre acá: un anexo o bloque de UTP que pida el nombre / RUT / domicilio del integrante que declara SÍ se llena con los datos de la ficha, igual que cualquier otro.'
    : '';
  const user = `FICHA DE LA EMPRESA QUE POSTULA:\n${ficha}${contextoUTP}\n\nCASILLAS (${items.length}):\n${items.map(i => i.texto).join('\n')}`;

  try {
    // modeloPreferido: 'glm-4.7' (salta el default 'flashx') — medido en pruebas reales: en
    // oraciones con varios blancos seguidos (declaración jurada corrida: nombre/cédula/domicilio/
    // representada/RUT, los 5 en la misma frase) flashx confundía qué campo iba en cuál, incluso
    // repitiendo el mismo campo en dos casillas distintas. Esto se escribe en declaraciones
    // juradas reales — vale la pena el modelo más cuidadoso (sigue siendo GLM, costo marginal).
    // soloGlm: true — sin esto, si glm-4.7 y sus respaldos GLM fallaban en racha, la cadena caía
    // en DeepSeek, exactamente el modelo que este comentario dice que confunde campos (auditoría
    // ago-2026). Con soloGlm, ante una degradación total de Z.AI el lote queda "pendiente" (motivo
    // visible) en vez de arriesgar un campo cruzado sin aviso.
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_CAMPOS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.campos) ? parsed.campos : [];
    const CATEGORIAS_VALIDAS = new Set<string>([
      'perfil_empresa', 'perfil_representante_legal', 'perfil_contacto', 'perfil_bancario', 'datos_licitacion',
      'especifico_licitacion', 'declaracion_tercero', 'firma_fecha', 'no_aplica_al_oferente',
      'decision_del_usuario',
    ]);

    for (const r of arr) {
      if (!r) continue;
      const item = items.find(i => i.n === Number(r.id));
      if (!item) continue;
      const categoria: CategoriaCampo = CATEGORIAS_VALIDAS.has(r.categoria) ? r.categoria : 'decision_del_usuario';
      const etiqueta = item.ref.tipo === 'celda' ? item.ref.c.etiqueta : (item.ref.b.contexto || '');
      const campo: string = typeof r.campo === 'string' ? r.campo : '';

      // GUARDARRAÍL: no basta con que la CATEGORÍA sea plausible — el CAMPO que nombró la IA
      // tiene que (1) pertenecer al grupo permitido para esa categoría (ver
      // CAMPOS_PERMITIDOS_POR_CATEGORIA — evita que "cédula de identidad" reciba el NOMBRE del
      // representante porque ambos son "perfil_representante_legal") y (2) tener dato real en la
      // ficha. El VALOR sale SIEMPRE de `empresa[campo]` directo — la IA nunca reescribe texto,
      // así que no puede "mejorarlo" ni inventarlo.
      const esCelda = item.ref.tipo === 'celda';
      if (CATEGORIAS_PERFIL.includes(categoria) && campo && !(esCelda && CAMPOS_SOLO_PARA_TRIPLETE_DE_FECHA.has(campo))) {
        const permitidos = CAMPOS_PERMITIDOS_POR_CATEGORIA[categoria] || [];
        const valorFicha = permitidos.includes(campo as keyof EmpresaCampos) ? empresa[campo as keyof EmpresaCampos] : null;
        if (valorFicha != null && String(valorFicha).trim()) {
          // Último filtro antes de escribir: que el valor tenga la FORMA de lo que la casilla pide
          // (ver campoCalzaConLaEtiqueta). Un RUT bajo "NOMBRE" no se escribe aunque el dato sea real.
          if (campoCalzaConLaEtiqueta(etiqueta, String(valorFicha))) {
            out.set(item.n, { tipo: 'auto', valor: String(valorFicha), categoria, evidencia: etiqueta || null });
            continue;
          }
          out.set(item.n, {
            tipo: 'pendiente', categoria,
            motivo: `El dato propuesto ("${String(valorFicha).slice(0, 40)}") no tiene la forma de lo que pide esta casilla — revísalo a mano.`,
          });
          continue;
        }
      }
      out.set(item.n, { tipo: 'pendiente', categoria, motivo: MOTIVO_POR_DEFECTO[categoria] || 'No se pudo confirmar el dato con la ficha actual.' });
    }
    // Cualquier item que el modelo no haya respondido (recorte de respuesta, formato raro) queda
    // pendiente con un motivo genérico — nunca se pierde en silencio.
    for (const item of items) {
      if (!out.has(item.n)) out.set(item.n, { tipo: 'pendiente', categoria: 'decision_del_usuario', motivo: 'No se pudo clasificar automáticamente esta casilla.' });
    }
  } catch (error) {
    console.error('[anexos-ia-motor] Falló un lote, esas casillas quedan pendientes:', String(error).slice(0, 200));
    for (const item of items) out.set(item.n, { tipo: 'pendiente', categoria: 'decision_del_usuario', motivo: 'No se pudo consultar la IA para esta casilla (reintenta el análisis).' });
  }
  return out;
}

// ── Paso 1b: casillas "especifico_licitacion" que las BASES sí responden ─────────────────────
// Pedido explícito del usuario (4-ago-2026): "cuando pida especificaciones técnicas las puede
// sacar desde las bases". Hasta ahora TODA casilla categoría especifico_licitacion (cantidad,
// plazo, especificación exigida) quedaba SIEMPRE en null en el paso anterior — a propósito,
// porque no sale de la ficha de empresa. Este paso se corre DESPUÉS, solo sobre las que quedaron
// pendientes con esa categoría, y busca si el texto de las BASES declara un valor objetivo para
// ellas (ej. "el plazo de entrega es de 15 días corridos") — un origen de datos totalmente
// distinto (texto libre de un PDF, no una ficha estructurada), así que usa su propio prompt, más
// estricto, y NUNCA toca perfil_*/datos_licitacion (esos ya se resolvieron o quedaron pendientes
// arriba con su propio motivo — cruzarlos también contra las bases solo agregaría riesgo de
// error sin necesidad, ya tienen de dónde salir).
//
// Lo que SIGUE sin resolver acá, a propósito: una casilla "Cumple Sí/No" o "Marca"/"Modelo" pide
// que EL OFERENTE declare algo sobre SU PROPIO producto — las bases describen el REQUISITO, no la
// respuesta del oferente. El prompt de abajo lo deja explícito para que el modelo no confunda
// "las bases piden tal característica" con "el oferente confirma que la tiene".
const SYS_BASES_CAMPOS = `Eres un experto en licitaciones públicas chilenas. Te doy el texto de las BASES (administrativas y/o técnicas) de una licitación y una lista NUMERADA de CASILLAS de un anexo que NO se pudieron resolver antes (piden un dato propio de esta oferta/licitación: cantidad, plazo, presupuesto, especificación técnica exigida — no un dato de la empresa).

Para cada casilla, busca si las BASES declaran LITERALMENTE un valor objetivo que la responda (ej. "el plazo de entrega es de 15 días corridos", "la cantidad requerida es de 500 unidades", "el presupuesto disponible es de $30.000.000"). Si lo encuentras, complétala con ESE valor tal cual aparece en las bases — no lo reformatees, no lo completes con supuestos, no hagas cálculos.

NUNCA completes:
- Una casilla que pide que EL OFERENTE declare algo sobre SU PROPIO producto o servicio (ej. "¿Cumple? Sí/No", "Marca", "Modelo", "Cumple con la funcionalidad", "Observaciones del proveedor") — las bases describen lo EXIGIDO, no si el oferente lo cumple; eso lo decide el oferente, nunca tú.
- Una casilla donde las bases no dicen el dato de forma explícita — no lo infieras, no lo estimes, no lo calcules a partir de otros datos.

REGLA DE ORO ANTI-ALUCINACIÓN (no negociable): si tienes cualquier duda, o el dato no está LITERAL en las bases, el valor es null. Es peor un dato equivocado en una oferta que uno pendiente.

Devuelve SOLO JSON, sin markdown ni texto adicional, respondiendo TODAS las casillas que te di, en orden:
{"campos":[{"id":<número>,"valor":"<texto tal cual aparece en las bases>"|null,"evidencia":"<frase corta de las bases que lo confirma>"|null}]}`;

async function resolverLoteDesdeBases(items: ItemLote[], basesTexto: string): Promise<Map<number, Resolucion>> {
  const out = new Map<number, Resolucion>();
  const user = `BASES (extracto):\n${basesTexto.slice(0, 14_000)}\n\nCASILLAS (${items.length}):\n${items.map(i => i.texto).join('\n')}`;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_BASES_CAMPOS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.campos) ? parsed.campos : [];
    for (const r of arr) {
      if (!r) continue;
      const item = items.find(i => i.n === Number(r.id));
      if (!item) continue;
      const valor = typeof r.valor === 'string' ? r.valor.trim() : '';
      if (!valor) continue; // sigue pendiente con el motivo que ya traía — no se pisa con nada
      const evidencia = typeof r.evidencia === 'string' && r.evidencia.trim() ? r.evidencia.trim() : null;
      out.set(item.n, { tipo: 'auto', valor, categoria: 'especifico_licitacion', evidencia });
    }
  } catch (error) {
    console.error('[anexos-ia-motor] Falló un lote de bases, esas casillas siguen pendientes:', String(error).slice(0, 200));
  }
  return out;
}

// Recibe SOLO lo que quedó pendiente con categoría especifico_licitacion del paso anterior —
// nunca vuelve a mandar lo ya resuelto ni lo que quedó pendiente por otro motivo (firma, tercero,
// no aplica, decisión del usuario: nada de eso lo responden las bases).
export async function resolverEspecificacionesDesdeBasesConIA(
  pendientesCelda: CandidatoCelda[],
  pendientesInline: CandidatoInline[],
  parrafos: Parrafo[],
  basesTexto: string,
): Promise<{ celda: Map<number, Resolucion>; inline: Map<string, Resolucion> }> {
  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();
  if (!basesTexto || !basesTexto.trim()) return { celda, inline };
  if (!pendientesCelda.length && !pendientesInline.length) return { celda, inline };

  let contador = 0;
  const items: ItemLote[] = [];
  for (const c of pendientesCelda) {
    const n = ++contador;
    items.push({ n, ref: { tipo: 'celda', c }, texto: formatearCandidatoCelda(c, parrafos, n) });
  }
  for (const b of pendientesInline) {
    const n = ++contador;
    items.push({ n, ref: { tipo: 'inline', b }, texto: formatearCandidatoInline(b, n) });
  }

  const lotes = enLotes(items, TAMANO_LOTE);
  const resueltosPorLote = await enParaleloLimitado(lotes, LOTES_EN_PARALELO, lote => resolverLoteDesdeBases(lote, basesTexto));
  for (const mapa of resueltosPorLote) {
    for (const [n, resolucion] of mapa) {
      const item = items.find(i => i.n === n);
      if (!item) continue;
      if (item.ref.tipo === 'celda') celda.set(item.ref.c.indice, resolucion);
      else inline.set(`${item.ref.b.indiceRun}:${item.ref.b.posEnTexto}`, resolucion);
    }
  }
  return { celda, inline };
}

// ── Paso 1: barrido de riesgos de inadmisibilidad sobre el texto de las bases ────────────────
const SYS_BASES = `Eres un experto en licitaciones públicas chilenas. Te doy el texto de las BASES administrativas/técnicas de una licitación y la lista de ANEXOS que el oferente debe completar. Busca cláusulas de causal de inadmisibilidad, rechazo, o declaración de oferta desierta ligadas a: certificaciones obligatorias de producto, garantías exigidas, topes máximos (ej. plazo de entrega), u otro requisito documental duro.

Para cada riesgo real que encuentres, indica: el riesgo en una frase, qué dato lo resuelve, y si ese dato típicamente ya está disponible en la ficha de la empresa o el costeo (certificaciones de producto y plazos NUNCA lo están — pon disponible:false para esos).

Si no encuentras ningún riesgo real, devuelve una lista vacía — no inventes riesgos genéricos.

Devuelve SOLO JSON: {"alertas":[{"riesgo":"...","datoQueLoResuelve":"...","disponible":true|false}]}`;

export async function resolverAlertasInadmisibilidad(basesTexto: string, tituloAnexos: string[]): Promise<AlertaInadmisibilidad[]> {
  if (!basesTexto || !basesTexto.trim()) return [];
  const user = `ANEXOS DE ESTA LICITACIÓN: ${tituloAnexos.join(', ') || '(no identificados)'}\n\nBASES (extracto):\n${basesTexto.slice(0, 14_000)}`;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_BASES }, { role: 'user', content: user }],
      temperature: 0.1, stream: false, max_tokens: 2_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 90_000 });
    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.alertas) ? parsed.alertas : [];
    return arr
      .filter((a: any) => a && typeof a.riesgo === 'string' && a.riesgo.trim())
      .map((a: any) => ({
        riesgo: String(a.riesgo).trim(),
        datoQueLoResuelve: String(a.datoQueLoResuelve || '').trim(),
        disponible: a.disponible !== false,
      }));
  } catch (error) {
    console.error('[anexos-ia-motor] Falló el barrido de bases (Paso 1), se omite sin bloquear el resto:', String(error).slice(0, 200));
    return [];
  }
}

// ── Sección de anexo pegada como IMAGEN/FOTO (no hay texto real que editar) ───────────────────
// Caso real (1019-79-LP26, ANEXO N°7 "Autorización pagos a través de bancos"): el organismo pegó
// un formulario ESCANEADO dentro del .docx en vez de escribirlo como texto de Word. Ahí no hay
// ningún <w:t> que editar — el motor normal ni se entera de que existe (0 candidatos). Este paso
// NUNCA escribe nada en el documento: solo lee el texto que salió del OCR de la imagen (ver
// anexos-imagen-escaneada.ts) y le dice al usuario QUÉ pide el formulario y CON QUÉ DATO de su
// ficha lo llenaría, para que lo copie a mano (a papel, o al portal externo si el organismo lo
// exige aparte — ver detectarNotaFormularioExterno).
export interface CampoSeccionEscaneada { etiqueta: string; valor: string | null; campo: string | null }

const SYS_IMAGEN_ESCANEADA = `Eres un experto en licitaciones públicas chilenas. Te paso el texto que salió del OCR de una IMAGEN ESCANEADA pegada dentro de un anexo Word (un formulario o declaración que el organismo comprador exige, pero que llegó como foto/escaneo en vez de texto editable). NO se puede escribir nada dentro de esa imagen — tu única tarea es identificar QUÉ casillas o datos pide el formulario, para que el sistema le muestre al usuario los valores exactos que le corresponden y los copie a mano (a papel o a un formulario externo).

Para cada casilla o dato real que el formulario pida, indica:
- "etiqueta": el nombre del campo tal como aparece ("Nombre del Banco", "N° de Cuenta Corriente", "Tipo de Cuenta")
- "campo": el NOMBRE EXACTO del campo de la ficha de empresa que lo resuelve (de la lista de abajo), o null si es un dato que la ficha NO tiene (firma manuscrita, fecha de hoy, un dato específico de esta licitación puntual, una decisión del oferente)

Ignora títulos, instrucciones o texto legal que no sea una casilla real a completar. Si el OCR salió incompleto o ilegible en partes, igual identifica lo que SÍ se entiende — no descartes el formulario completo por eso.

Campos disponibles en la ficha de empresa:
{CAMPOS}

Devuelve SOLO JSON: {"campos":[{"etiqueta":"...","campo":"..."|null}]}`;

export async function identificarCamposDeSeccionEscaneada(
  textoOcr: string, empresa: EmpresaCampos,
): Promise<CampoSeccionEscaneada[]> {
  if (!textoOcr || !textoOcr.trim()) return [];
  const camposConDato = (Object.keys(empresa) as (keyof EmpresaCampos)[])
    .filter(c => c !== 'firma_url' && c !== 'timbre_url' && empresa[c] != null && String(empresa[c]).trim());
  if (!camposConDato.length) return [];

  const listaCampos = camposConDato.map(c => `- ${c}: ${DESCRIPCION_CAMPO[c] || c}`).join('\n');
  const sys = SYS_IMAGEN_ESCANEADA.replace('{CAMPOS}', listaCampos);
  const user = `TEXTO OCR DE LA IMAGEN:\n${textoOcr.slice(0, 6_000)}`;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.1, stream: false, max_tokens: 1_500,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });
    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.campos) ? parsed.campos : [];
    return arr
      .filter((c: any) => c && typeof c.etiqueta === 'string' && c.etiqueta.trim())
      .map((c: any) => {
        const campo = typeof c.campo === 'string' ? c.campo.trim() : null;
        // Guardarraíl anti-invención de siempre: el VALOR sale SIEMPRE de la ficha real, nunca
        // de lo que "escriba" el modelo — si el nombre de campo no existe de verdad, queda null.
        const valor = campo && camposConDato.includes(campo as keyof EmpresaCampos)
          ? String(empresa[campo as keyof EmpresaCampos])
          : null;
        return { etiqueta: String(c.etiqueta).trim().slice(0, 160), campo: valor ? campo : null, valor };
      });
  } catch (error) {
    console.error('[anexos-ia-motor] Falló identificar campos de sección escaneada, se omite sin bloquear el resto:', String(error).slice(0, 200));
    return [];
  }
}

// ── Orquestador ────────────────────────────────────────────────────────────────────────────
export async function resolverAnexoConIA(entrada: EntradaMotor): Promise<ResultadoMotor> {
  const { candidatos, blancosInline, parrafos, empresa, basesTexto, tituloAnexos, postulaComoUTP } = entrada;

  const camposConDato = (Object.keys(empresa) as (keyof EmpresaCampos)[])
    // firma_url/timbre_url son URLs de imágenes, no texto que se escriba en una casilla — si se le
    // muestran al modelo termina proponiéndolas como "valor" de algún campo.
    .filter(c => c !== 'firma_url' && c !== 'timbre_url' && empresa[c] != null && String(empresa[c]).trim());

  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();

  const [alertasInadmisibilidad] = await Promise.all([
    resolverAlertasInadmisibilidad(basesTexto || '', tituloAnexos || []),
  ]);

  if (!camposConDato.length || (!candidatos.length && !blancosInline.length)) {
    return { celda, inline, alertasInadmisibilidad, checklistPendientes: alertasInadmisibilidad.filter(a => !a.disponible).map(a => a.riesgo) };
  }

  // Casillas ya resueltas por la ESTRUCTURA del documento (`campoFijo` — hoy: los datos que
  // cuelgan de una firma que nombra a su firmante, ver asignarCamposDeBloqueFirma en
  // anexos-detectar.ts). No se le preguntan a la IA: la respuesta no depende de ningún juicio y
  // preguntarla es justamente lo que hacía que seis "RUT:" idénticos salieran distintos entre sí.
  const candidatosParaIA: CandidatoCelda[] = [];
  for (const c of candidatos) {
    const campo = c.campoFijo as keyof EmpresaCampos | undefined;
    const valor = campo && CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA.includes(campo) ? empresa[campo] : null;
    if (campo && valor != null && String(valor).trim() && campoCalzaConLaEtiqueta(c.etiqueta, String(valor))) {
      celda.set(c.indice, {
        tipo: 'auto', valor: String(valor),
        categoria: campo.startsWith('representante_') ? 'perfil_representante_legal' : 'perfil_empresa',
        evidencia: c.etiqueta,
      });
    } else {
      candidatosParaIA.push(c);
    }
  }

  let n = 0;
  const items: ItemLote[] = [
    ...candidatosParaIA.map((c): ItemLote => ({ n: ++n, ref: { tipo: 'celda', c }, texto: '' })),
    ...blancosInline.map((b): ItemLote => ({ n: ++n, ref: { tipo: 'inline', b }, texto: '' })),
  ];
  for (const item of items) {
    item.texto = item.ref.tipo === 'celda'
      ? formatearCandidatoCelda(item.ref.c, parrafos, item.n)
      : formatearCandidatoInline(item.ref.b, item.n);
  }

  const resultados = await enParaleloLimitado(
    enLotes(items, TAMANO_LOTE), LOTES_EN_PARALELO,
    lote => resolverLoteCampos(lote, empresa, camposConDato, postulaComoUTP),
  );

  const checklistSet = new Set<string>();
  for (const a of alertasInadmisibilidad) if (!a.disponible) checklistSet.add(a.riesgo);

  for (const mapa of resultados) {
    for (const [n2, res] of mapa) {
      const item = items.find(i => i.n === n2)!;
      if (item.ref.tipo === 'celda') celda.set(item.ref.c.indice, res);
      else inline.set(`${item.ref.b.indiceRun}:${item.ref.b.posEnTexto}`, res);
      if (res.tipo === 'pendiente' && res.categoria === 'decision_del_usuario') checklistSet.add(res.motivo);
    }
  }

  return { celda, inline, alertasInadmisibilidad, checklistPendientes: [...checklistSet] };
}
