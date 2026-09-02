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
import { bloqueReglasAprendidasAnexo } from '@/app/lib/anexos-feedback';
import { resolverDeterminista, clasificarPendiente } from '@/app/lib/anexos-determinista';

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
  // La PROFESIÓN u OFICIO del representante ("Empresaria", "Ingeniero Constructor"): NO es lo mismo
  // que su CARGO en la empresa ("Gerente"), y hay anexos que piden las dos en el mismo bloque.
  // OPCIONAL a propósito: la columna la crea migration-69 y hasta que esté aplicada (y agregada al
  // SELECT de anexos-datos.ts) el valor llega vacío y la casilla queda PENDIENTE — que es el
  // comportamiento correcto, nunca un dato inventado.
  representante_profesion?: string | null;
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
  // Caso real (1042-9-LE26): "del 20___" dentro de una oración larga — el organismo ya imprimió el
  // "20" del año y el blanco es solo lo que falta ("26"). Igual que fecha_hoy_mes_palabra, en la
  // práctica solo lo pide campoDeFechaEnFormula; nunca pasa por este motor de IA.
  fecha_hoy_anio_corto?: string | null;
  // El OTRO formato de fecha partida, igual de común: "___ de ___ de ___" (con la palabra "de"
  // en vez de barras) — ahí la casilla del medio pide el MES EN PALABRA ("agosto"), no el número.
  // En la práctica este trío lo resuelve detectarTripletesFecha (anexos-detectar.ts) sin pasar por
  // este motor; el campo queda documentado igual por si algún caso raro cae al camino normal.
  fecha_hoy_mes_palabra?: string | null;
  // Caso real (4777-24-LE26): el año ya viene impreso fijo en la plantilla ("LA UNIÓN, ___ DE
  // 2026.-") y queda un solo blanco para "día + de + mes en palabra" — a diferencia de los cuatro
  // campos de arriba, este SÍ se lee completo por sí solo ("06 de agosto"), así que es válido
  // como respuesta de una celda suelta, no solo dentro de un triplete — ver
  // CAMPOS_SOLO_PARA_TRIPLETE_DE_FECHA más abajo, que a propósito NO lo incluye.
  fecha_hoy_dia_mes?: string | null;
  // Dirección partida (6-ago-2026, caso real 4777-24-LE26): un formulario "Domicilio: Calle ___
  // N°: ___ Comuna: ___ Ciudad: ___" son CUATRO casillas — sin esto, el único campo disponible era
  // `direccion` entera, y el motor la repetía completa en las cuatro (o, peor, elegía cualquier
  // otro campo con tal de llenar algo). `null` si `direccion` no trae una marca "N°"/"Nº" clara
  // que permita separar sin adivinar — ver calleYNumeroDeDireccion en anexos-derivados.ts.
  direccion_calle?: string | null;
  direccion_numero?: string | null;
  // Oficina/departamento del domicilio, suelto de `direccion` (31-ago-2026, medido por el auditor
  // de generalización en 3 licitaciones): varios formularios de identificación parten el domicilio
  // en "Calle | N° | DPTO./OF. | Comuna". Sin este campo, la casilla de oficina quedaba pendiente
  // aunque el dato ya está en la ficha ("Barros Arana N°492 Of.78, Concepción" → "78"). `null` si
  // la dirección no trae una marca de oficina/depto explícita — misma regla anti-invención que
  // calleYNumeroDeDireccion: sin marca clara, pendiente, nunca un corte adivinado.
  direccion_oficina?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  // Nombres/Apellidos del representante legal, sueltos de `representante_nombre` (10-ago-2026,
  // caso real 1426039-8-LE26): una tabla "Nombres | Apellidos" son DOS casillas — sin esto, el
  // único campo disponible era el nombre completo, y el motor lo repetía igual en las dos. `null`
  // si `representante_nombre` no tiene una cantidad de palabras que se pueda partir sin adivinar
  // (1 palabra, o 5+) — ver nombresYApellidosDe en anexos-derivados.ts.
  representante_nombres?: string | null;
  representante_apellidos?: string | null;
  // Socio/Accionista + % de participación (14-ago-2026, pedido explícito del usuario, ver
  // instructivo interno "Presentacion_Creacion_Anexos_FINAL_CON_EJEMPLOS.pdf" punto 4): la ficha
  // de empresa no guarda un registro societario real (varios socios, cada uno con su %) — cuando
  // un anexo pide "Nombre Socio/Accionista" y "Porcentaje de Derechos o Participación" sin que
  // haya otro dato más específico, la política de la empresa (documentada, no una suposición
  // nuestra) es usar al representante legal como socio único al 100%. Si más adelante se necesita
  // una ficha societaria real con varios socios, esto deja de ser un campo derivado y pasa a ser
  // una tabla propia — por ahora resuelve el caso que se da en la práctica.
  socio_nombre?: string | null;
  socio_participacion?: string | null;
  // Programa de Integridad / Compliance (14-ago-2026, mismo instructivo interno, punto 5): TODOS
  // los anexos que preguntan si la empresa cuenta con Programa de Integridad se responden "SÍ" —
  // política de la empresa, no un dato que varíe por licitación. Antes esta pregunta quedaba
  // SIEMPRE en decision_del_usuario (ver el comentario de esa categoría más abajo) y había que
  // marcarla a mano en cada anexo de cada licitación. Ojo: esto SOLO resuelve la pregunta
  // SÍ/NO de "¿cuenta con...?" — una casilla que pide DESCRIBIR el programa (en qué consiste, qué
  // políticas incluye) sigue siendo decision_del_usuario, ese texto no es un booleano fijo.
  programa_integridad_respuesta?: string | null;
  // Política fija de la empresa, igual que la anterior — ver NACIONALIDAD_POR_DEFECTO en
  // anexos-derivados.ts. Si algún día existe la columna en `empresas`, ese valor manda.
  nacionalidad?: string | null;
  // Datos de ESTA LICITACIÓN (tampoco son columnas de `empresas` — se resuelven en
  // anexos-datos.ts llamando a Mercado Público por el código de la licitación que se está
  // rellenando, ver obtenerLicitacionParaAnexo). Van en el MISMO objeto que la ficha de empresa
  // — no porque sean "de la empresa", sino porque el guardarraíl de categoría por categoría
  // (CAMPOS_PERMITIDOS_POR_CATEGORIA, categoría datos_licitacion) ya evita que se crucen con los
  // campos de la empresa; meterlos aparte hubiera significado duplicar toda esa maquinaria para
  // un objeto paralelo. 100% determinista, igual que fecha_hoy — la IA nunca los inventa, solo
  // elige NOMBRARLOS cuando una casilla los pide.
  licitacion_codigo?: string | null;
  // El código PARTIDO en sus tres tramos (31-ago-2026, caso real 2495-17-B226, FORMULARIO ADMI-1):
  // varios organismos imprimen los guiones y dejan tres blancos —"ID N° ____-____-______"— así que
  // no hay dónde escribir "2495-17-B226" entero. Es el mismo caso que la fecha partida en día/mes/
  // año. Se derivan por split del código real, nunca se inventan: si el código no viene o no tiene
  // exactamente tres tramos, los tres quedan en null y las casillas siguen pendientes.
  licitacion_codigo_p1?: string | null;
  licitacion_codigo_p2?: string | null;
  licitacion_codigo_p3?: string | null;
  licitacion_nombre?: string | null;
  licitacion_organismo?: string | null;
  licitacion_organismo_rut?: string | null;
  licitacion_direccion?: string | null;
  licitacion_comuna?: string | null;
  // Comuna + fecha de firma EN UNA SOLA CASILLA — caso real (medido en el barrido de 300
  // documentos reales, 2-sep-2026, 6 licitaciones: "<Ciudad>, <día/mes/año>" y "CIUDAD, FECHA" como
  // encabezado de UNA celda de tabla que pide los dos datos juntos, no dos celdas separadas). Al
  // revés de RE_LOCALIDAD_FIRMA / campoDeFechaEnFormula (que resuelven "En ___ a 12 de agosto" o
  // "Santiago, ___" como blancos INLINE dentro de una frase), acá el organismo ya fusionó los dos
  // datos en el RÓTULO de una celda de tabla, así que hace falta un campo propio con el valor ya
  // combinado. `null` si la licitación no trae comuna del organismo — nunca se inventa la mitad
  // que falta.
  licitacion_comuna_y_fecha?: string | null;
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
  'razon_social', 'rut', 'direccion', 'direccion_calle', 'direccion_numero', 'direccion_oficina', 'comuna', 'ciudad',
  'region', 'giro', 'tipo_persona_juridica',
  'fecha_sociedad', 'fecha_escritura', 'notaria', 'numero_repertorio', 'fojas_numero_anio',
  'representante_nombre', 'representante_rut', 'representante_cargo',
  'representante_nombres', 'representante_apellidos',
  'email1', 'telefono1',
  'fecha_hoy', 'fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_anio_corto', 'fecha_hoy_mes_palabra', 'fecha_hoy_dia_mes',
  'socio_nombre', 'socio_participacion', 'programa_integridad_respuesta', 'nacionalidad',
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

// `campo`: QUÉ campo de la ficha se usó para llenar la casilla. Opcional porque no todas las
// resoluciones salen de la ficha (bases y órdenes de compra devuelven un texto que no corresponde
// a ninguna columna). Lo necesita el REPASO (anexos-repaso-ia.ts): sin el nombre del campo, el
// revisor tendría que adivinar de dónde salió el valor comparándolo contra la ficha entera, y dos
// campos con el mismo contenido (ej. razón social = titular de la cuenta) lo harían inauditable.
export interface ResolucionAuto { tipo: 'auto'; valor: string; categoria: CategoriaCampo; evidencia: string | null; campo?: string }
// `alternativas`: casilla genuinamente ambigua entre DOS datos reales de la ficha (hoy solo el caso
// representante_nombre vs. razon_social — ver resolverDeterminista, sección "NOMBRE pelado
// ambiguo"). La pantalla precarga la primera como sugerencia y deja cambiar a la segunda con un
// clic, en vez de un blanco ciego sin ninguna pista.
export interface ResolucionPendiente {
  tipo: 'pendiente'; categoria: CategoriaCampo; motivo: string;
  alternativas?: { campo: string; etiqueta: string; valor: string }[];
}
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
  // Hay una sección UTP omitida en el documento (independiente de postulaComoUTP) — ver
  // contextoProponenteUTP en resolverLoteCampos.
  haySeccionUtpOmitida?: boolean;
  // Reglas aprendidas del feedback loop (ver anexos-feedback.ts) — correcciones del experto sobre
  // casillas mal resueltas antes, destiladas por TIPO de etiqueta (no por documento). Se inyectan
  // en el prompt de cada lote con prioridad máxima.
  reglasAprendidas?: string[];
  // Las MISMAS correcciones del experto, pero traducidas a (etiqueta → campo de la ficha) para que
  // las pueda aplicar el motor DETERMINISTA — que es el que está encendido por defecto. Sin esto,
  // `reglasAprendidas` solo llegaba al prompt del Paso 2, apagado desde el 17-ago-2026: las
  // correcciones se guardaban y no cambiaban ningún anexo (auditoría 28-ago-2026).
  overridesAprendidos?: { etiqueta: string; campo: string }[];
  // No correr el barrido de riesgos sobre las bases (Paso 1). Lo usa `generarAnexoFinal`, que
  // descarta ese resultado — ver el comentario de `omitirAlertas` en anexos-rellenar.ts.
  omitirAlertas?: boolean;
}

export interface ResultadoMotor {
  /**
   * Campos de la ficha de la empresa que este documento pide y están vacíos — ver
   * `faltantesFicha` en anexos-determinista.ts. Viaja hasta la pantalla para que se puedan
   * completar ANTES de generar el anexo, no después de abrirlo y ver el hueco.
   */
  faltantesFicha?: { campo: string; nombre: string; etiqueta: string; origen: 'ficha' | 'licitacion' }[];
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
const CAMPOS_SOLO_PARA_TRIPLETE_DE_FECHA = new Set<string>(['fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_anio_corto', 'fecha_hoy_mes_palabra']);

export const DESCRIPCION_CAMPO: Partial<Record<keyof EmpresaCampos, string>> = {
  razon_social: 'Razón social / nombre de la empresa',
  rut: 'RUT de la empresa',
  direccion: 'Dirección comercial COMPLETA (calle + número + comuna) — úsalo SOLO si la casilla pide "Domicilio"/"Dirección" en UNA sola casilla. Si la casilla dice "Calle", "N°"/"Número", "Comuna" o "Ciudad" por separado, usa el campo específico de abajo, nunca este entero.',
  direccion_calle: 'Solo el NOMBRE DE LA CALLE del domicilio comercial (sin número) — casilla "Calle".',
  direccion_numero: 'Solo el NÚMERO/N° del domicilio comercial (sin el nombre de la calle) — casilla "N°"/"Número".',
  direccion_oficina: 'Solo la OFICINA/DEPARTAMENTO del domicilio comercial (sin calle ni número) — casilla "Of.", "Oficina", "Dpto.", "Depto.".',
  comuna: 'Comuna del domicilio comercial — casilla "Comuna".',
  ciudad: 'Ciudad del domicilio comercial — casilla "Ciudad".',
  region: 'Región CON la comuna al final, ej. "Región del Bío Bío, Concepción" — úsalo SOLO si la casilla junta "Región y comuna" o "Ciudad, Región" en una sola casilla. Si la casilla pide solo "Comuna" o solo "Ciudad", usa esos campos, no este.',
  giro: 'Giro comercial — en algunos formularios la casilla dice "Rubro Comercial" o "Rubro" en vez de "Giro": es el MISMO dato, no lo dejes pendiente por la etiqueta distinta.',
  tipo_persona_juridica: 'Tipo de persona jurídica',
  fecha_sociedad: 'Fecha/tipo/notaría de constitución (texto libre, todo junto)',
  fecha_escritura: 'Fecha de la escritura de constitución (solo la fecha)',
  notaria: 'Notaría donde se firmó la escritura',
  numero_repertorio: 'Número de repertorio de la escritura',
  fojas_numero_anio: 'Fojas/Número/Año de inscripción de la escritura',
  representante_nombre: 'Nombre completo del representante legal (nombres + apellidos juntos) — úsalo SOLO si la casilla pide "Nombre completo"/"Nombre" en UNA sola casilla. Si la casilla dice "Nombres" y "Apellidos" por separado, usa los campos específicos de abajo, nunca este entero.',
  representante_rut: 'RUT/cédula de identidad del representante legal',
  representante_cargo: 'Cargo del representante legal',
  representante_profesion: 'Profesión u oficio del representante legal (distinto de su cargo)',
  representante_nombres: 'Solo los NOMBRES (de pila) del representante legal, sin apellidos — casilla "Nombres".',
  representante_apellidos: 'Solo los APELLIDOS del representante legal, sin nombres — casilla "Apellidos".',
  email1: 'Correo electrónico de la empresa',
  telefono1: 'Teléfono de la empresa',
  banco_tipo_cuenta: 'Tipo de cuenta bancaria',
  banco_numero: 'Número de cuenta bancaria',
  banco_nombre: 'Nombre del banco',
  banco_email: 'Correo electrónico para pagos',
  banco_titular_nombre: 'Nombre del titular de la cuenta bancaria (puede ser distinto de la razón social) — dentro de un bloque "DATOS BANCARIOS PARA TRANSFERENCIA", la casilla suele decir simplemente "NOMBRE TITULAR" o "TITULAR" sin la palabra "cuenta" ni "banco" al lado — igual es este campo.',
  banco_titular_rut: 'RUT/cédula de identidad del titular de la cuenta bancaria — mismo criterio: dentro de "DATOS BANCARIOS" la casilla puede decir solo "RUT TITULAR" o "RUT".',
  fecha_hoy: 'Fecha con la que se firma y presenta esta oferta, en formato largo ("4 de agosto de 2026") — la fecha de CIERRE de esta licitación cuando se conoce (política de la empresa), si no la fecha real de hoy',
  fecha_hoy_dia: 'Solo el DÍA de hoy (número) — para pies de firma partidos: "Fecha: __ /__ /__"',
  fecha_hoy_mes: 'Solo el MES de hoy (número) — la casilla del medio de "Fecha: __ /__ /__"',
  fecha_hoy_anio: 'Solo el AÑO de hoy (4 dígitos) — la última casilla de "Fecha: __ /__ /__"',
  fecha_hoy_anio_corto: 'Solo los ÚLTIMOS 2 DÍGITOS del año de hoy — cuando el "20" ya viene impreso en la plantilla, ej. "…del 20___"',
  fecha_hoy_mes_palabra: 'Solo el MES de hoy EN PALABRA ("agosto") — la casilla del medio de "___ de __ de ___" (NUNCA el número ahí)',
  fecha_hoy_dia_mes: 'Día + mes en palabra de HOY, SIN año ("06 de agosto") — para una casilla SUELTA (no un triplete) donde el año ya viene impreso fijo en la plantilla, ej. "LA UNIÓN, ___ DE 2026"',
  socio_nombre: 'Nombre del Socio/Accionista — por política de la empresa, el representante legal (socio único). Casilla "Nombre Socio/Accionista".',
  socio_participacion: 'Porcentaje de Derechos o Participación del socio — siempre "100%" (socio único). Casilla "Porcentaje de Derechos"/"% de Participación".',
  programa_integridad_respuesta: '"SÍ" — respuesta fija a "¿Cuenta con Programa de Integridad/Compliance?" o equivalente (código de ética, Directiva N°31 ChileCompra). Política de la empresa: SIEMPRE se responde que sí.',
  nacionalidad: 'Nacionalidad del oferente / del representante legal. Política fija de la empresa: siempre "Chilena".',
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

ANEXO O SECCIÓN CONDICIONAL COMPLETA (caso particular de la regla f, caso real 4777-24-LE26): si el TÍTULO del anexo o de la sección (no una frase suelta a mitad de párrafo) indica explícitamente que ese bloque entero solo aplica bajo una condición que el oferente no cumple — ej. "FORMATO IDENTIFICACIÓN UNIÓN TEMPORAL DE PROVEEDORES (SOLO SI CORRESPONDE)" cuando la empresa postula sola, o "ANEXO PERSONA NATURAL" cuando postula una persona jurídica — TODAS las casillas de ese anexo/sección van a no_aplica_al_oferente con valor null, INCLUIDAS las que pidan "nombre del proponente", "RUT del oferente", "representante legal del proponente" o cualquier fecha/encabezado que preceda a esos datos ("REGIÓN:", "PROVINCIA:", "COMUNA:", "FECHA:"). Señal para reconocerlo: el título trae "(SOLO SI CORRESPONDE)", "EN CASO DE UNIÓN TEMPORAL", "SI POSTULA COMO PERSONA NATURAL" o equivalente, y aparece ANTES de las casillas como encabezado de sección — no en medio de una oración. Esto prima sobre la sinonimia proponente=oferente y sobre la regla de "una sola persona" de más abajo: esas dos solo aplican a una casilla suelta dentro de un párrafo mixto que menciona UTP de pasada, NUNCA cuando el título mismo del bloque marca la condición de exclusión.
g) "decision_del_usuario": exige elegir entre opciones que no se infieren de datos objetivos (ej. DESCRIBIR en qué consiste el programa de integridad de la empresa, si pertenece a un grupo empresarial) y no viene resuelto en ninguna ficha. Valor null. Ojo: la pregunta SÍ/NO de "¿cuenta con Programa de Integridad?" NO es decision_del_usuario — ver PROGRAMA DE INTEGRIDAD más abajo, esa sí se resuelve sola.

CASILLA SIN CONTEXTO: si el contexto que te llega para una casilla está vacío o es solo la casilla misma, sin ninguna palabra real alrededor (ni etiqueta, ni oración, ni fila de tabla), no hay información suficiente para clasificarla con certeza → categoria="especifico_licitacion", campo=null. Nunca la fuerces a perfil_* por descarte, ni a firma_fecha, ni a no_aplica_al_oferente: "sin contexto" no es lo mismo que "es un título" o "no aplica", es un dato que el humano debe revisar directamente en el documento.

TÍTULOS QUE NO SON CASILLAS: la detección es a propósito ruidosa y te va a pasar, mezclados con las casillas reales, encabezados y títulos de sección ("PROPUESTA:", "1. Detalle del suministro", "ANTECEDENTES GENERALES", "OFERTA ECONÓMICA:"). Un título ANUNCIA lo que viene abajo, no pide un dato: categoria="no_aplica_al_oferente", campo=null. La señal es simple — si al escribir el valor ahí la línea quedaría sin sentido leída en voz alta ("PROPUESTA: 06"), es un título. Ante la duda entre título y campo, elige título: una casilla de más que el humano llena es un costo menor que un dato suelto en medio del documento.

REGLA CLAVE — QUIÉN ES QUIÉN. Es la regla que más se falla y la que más caro sale. En un anexo chileno conviven SIEMPRE dos entidades distintas, y confundirlas mete un dato falso en una declaración jurada:

  · El OFERENTE / PROPONENTE / POSTULANTE / PROVEEDOR / CONTRATISTA **es la EMPRESA**.
    Sus datos propios: razon_social · rut (el de la empresa, 76.xxx.xxx-x) · direccion · giro ·
    tipo_persona_juridica · fecha_escritura · notaria · numero_repertorio · fojas_numero_anio.

  · El REPRESENTANTE LEGAL / APODERADO / DECLARANTE / FIRMANTE **es una PERSONA de carne y hueso**
    (en esta operación: Santiago Osvaldo López Palavecino o Lidia Valenzuela, según la empresa).
    Sus datos propios: representante_nombre · representante_rut (su CÉDULA DE IDENTIDAD, un número
    completamente distinto al de la empresa) · representante_cargo · representante_profesion.

EL ERROR CONCRETO A EVITAR (ocurrió de verdad en 2495-17-B226): un formulario de identificación trae
la sección "1. DATOS DEL PROPONENTE" (Nombre o Razón Social / RUT / Dirección / Teléfono / Email) y
justo debajo la sección "2. REPRESENTANTE LEGAL O APODERADO" (Nombre / Profesión / RUT / Cargo).
Los DOS bloques tienen una casilla rotulada "RUT" y esperan DOS NÚMEROS DISTINTOS:
  · el "RUT" de la sección 1 es rut (de la EMPRESA),
  · el "RUT" de la sección 2 es representante_rut (la CÉDULA de la persona).
Decide SIEMPRE por el ENCABEZADO DE SU PROPIA SECCIÓN, nunca por la casilla vecina ni por el
formulario completo. Si el encabezado de la sección habla de la empresa (proponente, oferente, datos
del proveedor, identificación del oferente), el dato es de la EMPRESA. Si habla de la persona
(representante legal, apoderado, quien suscribe, declarante), el dato es de la PERSONA.

MISMA REGLA PARA EL NOMBRE: "Nombre o Razón Social" bajo el encabezado del proponente es
razon_social. "Nombre" pelado bajo el encabezado del representante legal es representante_nombre.
Nunca pongas la razón social donde se pide el nombre de la persona, ni al revés.

LO QUE SÍ COMPARTEN, y es lo ÚNICO que comparten: el TELÉFONO y el CORREO. El encargado de la
propuesta, el contacto para la licitación y el administrador de contrato son la misma persona del
representante legal y usan el teléfono y el correo de la empresa, así que telefono1/email1 sirven
para todos esos bloques — nunca los dejes pendientes por dudar de quién es el titular.
CONSISTENCIA DENTRO DEL MISMO BLOQUE (no negociable): si en un bloque de contacto ya resolviste el
TELÉFONO/CELULAR con telefono1, el E-MAIL/CORREO de ese mismo bloque se resuelve con email1 con el
mismo criterio — nunca uno pendiente y el otro no.

DECLARACIÓN JURADA CORRIDA: cuando el texto va de corrido ("Yo, don ___, cédula de identidad N° ___,
con domicilio en ___, en representación de ___, RUT N° ___"), la regla de arriba se aplica palabra
por palabra: lo que sigue a "Yo," / "don" / "comparece" es la PERSONA; lo que sigue a "en
representación de" / "mi representada" / "la empresa" es la EMPRESA. La misma oración pide los dos
RUT, y son distintos.

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

PIE DE FIRMA CON FECHA: día, mes y/o año de la fecha en que se presenta la oferta, categoria=perfil_empresa siempre — NUNCA firma_fecha (la firma es la raya, la fecha se escribe). Hay varios formatos:
- Partida en tres con barras, "Fecha: 【CASILLA-1】 / 【CASILLA-2】 / 【CASILLA-3】" → campo fecha_hoy_dia, fecha_hoy_mes (NÚMERO), fecha_hoy_anio.
- Partida en tres con la palabra "de", "【CASILLA-1】 de 【CASILLA-2】 de 【CASILLA-3】" (ej. "Viña del Mar, ___ de ___ de ___") → campo fecha_hoy_dia, fecha_hoy_mes_palabra (EN PALABRA, "agosto" — jamás el número aquí, nadie escribe "3 de 08 de 2026"), fecha_hoy_anio.
- Suelta SIN partir, un solo blanco tras "FECHA:" que no está dividido en día/mes/año y no está pegado a una raya de firma manuscrita → campo fecha_hoy (fecha larga completa, "06 de agosto de 2026"). Excepción: si esa "FECHA:" cae dentro de un ANEXO O SECCIÓN CONDICIONAL COMPLETA que no corresponde (regla f de arriba), prima la exclusión → no_aplica_al_oferente.
- Con el AÑO ya fijo como texto literal en la plantilla y UN solo blanco para el resto (ej. "LA UNIÓN, 【CASILLA】 DE 2026.-") → ese blanco pide "día + de + mes en palabra" → campo fecha_hoy_dia_mes (formato "06 de agosto", SIN año — el año ya está impreso, no lo repitas).

PROGRAMA DE INTEGRIDAD: cuando una casilla pregunta, en cualquier formato (SI___NO___, casillero a marcar, "Cumple: Sí/No"), si la empresa CUENTA CON un Programa de Integridad, política de integridad, código de ética para proveedores, o adhiere a la Directiva N°31 de ChileCompra → categoria=perfil_empresa, campo=programa_integridad_respuesta (siempre resuelve "SÍ", es política fija de la empresa). Esto es DISTINTO de una casilla que pide DESCRIBIR el programa (en qué consiste, qué políticas incluye, un texto libre) — esa sigue siendo decision_del_usuario, valor null.

SOCIO/ACCIONISTA: cuando un anexo pide identificar socios o accionistas con su porcentaje de participación ("Nombre Socio/Accionista", "RUT Socio", "Porcentaje de Derechos o Participación") y no hay ningún otro dato en el documento que indique una sociedad con varios socios distintos → categoria=perfil_empresa, campo=socio_nombre para el nombre y campo=socio_participacion para el porcentaje (la empresa opera con socio único, el representante legal, al 100%). Si la casilla pide el RUT del socio, usa representante_rut (es la misma persona).

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
  postulaComoUTP = false, reglasAprendidas: string[] = [], haySeccionUtpOmitida = false,
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
  // Caso DISTINTO del de arriba: la empresa NO postula en UTP (postulaComoUTP=false, el bloque UTP
  // sigue sin corresponder), pero el sistema YA filtró de este lote las casillas de UTP que
  // genuinamente piden datos de OTRA empresa (la tabla de integrantes, nunca llega acá) — lo que
  // SÍ llega son casillas sueltas que piden el nombre/RUT/representante legal del "PROPONENTE" u
  // "OFERENTE" MISMO. BUG REAL (4777-24-LE26, 6-ago-2026): sin este aviso, la IA veía el contexto
  // cercano ("UNIÓN TEMPORAL DE PROVEEDORES") y aplicaba la regla f) igual, aunque el candidato
  // que le llegó no era de un integrante — "proponente" es sinónimo de "oferente" en estos
  // formularios, la MISMA empresa de la ficha, se postule sola o en unión.
  const contextoProponenteUTP = !postulaComoUTP && haySeccionUtpOmitida
    ? '\n\nCONTEXTO: este documento tiene un bloque de "Unión Temporal de Proveedores" (UTP) que NO corresponde presentar en esta oferta (la empresa postula sola). El sistema YA excluyó de esta lista lo que genuinamente pide datos de OTRA empresa (una tabla de integrantes) — si de todas formas ves, entre las casillas de abajo, una suelta (no una fila de tabla) que pide el nombre/RUT/representante legal del "PROPONENTE" u "OFERENTE" y el párrafo cercano menciona "Unión Temporal de Proveedores", NO la mandes a no_aplica_al_oferente por eso: "proponente" es sinónimo de "oferente", la MISMA empresa de la ficha — resuélvela normal (perfil_empresa/perfil_representante_legal). Esto NO aplica si la casilla nombra explícitamente a un integrante/socio distinto.'
    : '';
  const user = `FICHA DE LA EMPRESA QUE POSTULA:\n${ficha}${contextoUTP}${contextoProponenteUTP}${bloqueReglasAprendidasAnexo(reglasAprendidas)}\n\nCASILLAS (${items.length}):\n${items.map(i => i.texto).join('\n')}`;

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

// ── Paso 1c: casillas "especifico_licitacion" de EXPERIENCIA — candidatos desde OC reales ─────
// (14-ago-2026, pedido explícito del usuario, instructivo interno "Presentacion_Creacion_Anexos_
// FINAL_CON_EJEMPLOS.pdf" punto 8). Igual que resolverEspecificacionesDesdeBasesConIA (Paso 1b):
// se corre DESPUÉS, solo sobre lo que sigue pendiente con categoría especifico_licitacion tras
// intentarlo contra las bases — una tabla de "Experiencia del Oferente" (N° OC, fecha, cliente,
// objeto, monto) no la resuelven las bases (piden un dato NUESTRO, no algo que el organismo haya
// publicado), la resuelve la base real de Órdenes de Compra ya cruzada por RUT/nombre (ver
// ocsParaExperiencia en ordenes-compra.ts).
//
// DIFERENCIA CLAVE con Paso 1b — el instructivo pide explícitamente verificar PERTINENCIA ("no
// basta con que exista una OC; debe ser pertinente a la experiencia que se está acreditando"), así
// que este prompt es más cauto: exige que el prompt del anexo (rubro/objeto que pide la
// licitación) calce con el objeto de la OC candidata, y deja explícito que ante la duda es mejor
// null que una OC no pertinente. El resultado NUNCA se trata como confirmado: ver `via:
// 'ordenes_compra'` en anexos-rellenar.ts, que lo pinta distinto en la UI para que un humano
// confirme antes de presentar (mismo criterio que 'bases', nunca 'ia' puro).
const SYS_OC_EXPERIENCIA = `Eres un experto en licitaciones públicas chilenas. Te doy una lista de ÓRDENES DE COMPRA REALES ya emitidas a esta empresa (con estado "Aceptada" o "Recepción conforme" — ya confirmadas, sirven como experiencia acreditable) y una lista NUMERADA de CASILLAS de una tabla de "Experiencia del Oferente" de un anexo que NO se pudieron resolver antes.

Cada casilla pide UN dato de UNA fila de esa tabla (ej. "Fecha del documento", "N° de Orden de Compra", "Cliente o mandante", "Descripción/objeto de la contratación", "Monto"). Tu trabajo:
1. Para cada casilla, identifica a qué FILA de la tabla pertenece (por el contexto que te doy — número de fila, o casillas vecinas de la misma fila que ya se resolvieron).
2. Asigna una OC REAL de la lista a esa fila — la MISMA OC para todas las casillas de una misma fila (no mezcles datos de dos OC distintas en una sola fila).
3. Completa la casilla con el dato de ESA OC que corresponda a lo que pide la etiqueta.

REGLA DE PERTINENCIA (la más importante, no la saltes): antes de usar una OC, compara su "Objeto" con lo que la licitación/anexo indica que la experiencia debe acreditar (rubro, tipo de producto o servicio). Si el contexto no te da pistas de qué rubro se pide, o el objeto de la OC no calza razonablemente con ese rubro, NO la uses — deja la casilla en null. Es preferible una fila vacía que una OC que no acredita la experiencia real que se pide.

NUNCA inventes un dato que no esté en la lista de OC que te di. Nunca reutilices la misma OC en dos filas DISTINTAS si hay más de una disponible (usa OC distintas para acreditar experiencia variada, salvo que solo tengas una).

Devuelve SOLO JSON, sin markdown ni texto adicional, respondiendo TODAS las casillas que te di, en orden:
{"campos":[{"id":<número>,"valor":"<el dato tal cual, sin reformatear>"|null,"evidencia":"<código de la OC usada, ej. \\"1234-56-SE26\\">"|null}]}`;

async function resolverLoteDesdeOrdenesCompra(items: ItemLote[], ocsTexto: string): Promise<Map<number, Resolucion>> {
  const out = new Map<number, Resolucion>();
  const user = `ÓRDENES DE COMPRA REALES (Aceptada/Recepción conforme):\n${ocsTexto.slice(0, 6_000)}\n\nCASILLAS DE LA TABLA DE EXPERIENCIA (${items.length}):\n${items.map(i => i.texto).join('\n')}`;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_OC_EXPERIENCIA }, { role: 'user', content: user }],
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
    console.error('[anexos-ia-motor] Falló un lote de OC de experiencia, esas casillas siguen pendientes:', String(error).slice(0, 200));
  }
  return out;
}

// Recibe SOLO lo que quedó pendiente con categoría especifico_licitacion TRAS el Paso 1b (bases) —
// mismo criterio de "nunca vuelve a mandar lo ya resuelto" que ese paso. Si el llamador no filtra
// por contexto de "experiencia" antes de pasar los pendientes acá (queda a criterio del llamador,
// igual que Paso 1b), el propio prompt ya exige que la etiqueta calce con una tabla de experiencia
// antes de proponer nada — una casilla de "Plazo de entrega" simplemente vuelve con valor null.
export async function resolverExperienciaDesdeOrdenesCompra(
  pendientesCelda: CandidatoCelda[],
  pendientesInline: CandidatoInline[],
  parrafos: Parrafo[],
  ocsTexto: string,
): Promise<{ celda: Map<number, Resolucion>; inline: Map<string, Resolucion> }> {
  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();
  if (!ocsTexto || !ocsTexto.trim()) return { celda, inline };
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

  // Sin lotes de a TAMANO_LOTE acá a propósito: partir una tabla de experiencia en pedazos de 8
  // casillas podría separar filas relacionadas en llamadas distintas, perdiendo el contexto que
  // el modelo necesita para no repetir/mezclar OC entre filas. Una tabla de experiencia real rara
  // vez supera unas pocas decenas de casillas, así que un solo lote (o unos pocos, si es enorme)
  // es manejable sin volver a trocear por 8.
  const lotes = enLotes(items, TAMANO_LOTE * 3);
  const resueltosPorLote = await enParaleloLimitado(lotes, LOTES_EN_PARALELO, lote => resolverLoteDesdeOrdenesCompra(lote, ocsTexto));
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
// FIRMA MANUSCRITA (14-ago-2026, pedido explícito del usuario, instructivo interno
// "Presentacion_Creacion_Anexos_FINAL_CON_EJEMPLOS.pdf" punto 3): algunas bases exigen que
// determinados documentos vengan firmados "de puño y letra" (manuscrita, no digital/electrónica)
// como requisito de admisibilidad — y el Anexo Creator estampa la firma guardada (`firma_url`)
// igual en cualquier raya de firma, sin saber si ESE anexo puntual exige la manuscrita. Antes este
// barrido de riesgos no buscaba esta cláusula en absoluto (solo certificaciones/garantías/topes),
// así que el aviso nunca aparecía — el documento salía "listo" con una firma que, si las bases
// exigen puño y letra, no sirve para presentar. `disponible:false` siempre para este riesgo: es
// una firma física, ningún dato de la ficha lo resuelve, tiene que firmarlo un humano en papel.
const SYS_BASES = `Eres un experto en licitaciones públicas chilenas. Te doy el texto de las BASES administrativas/técnicas de una licitación y la lista de ANEXOS que el oferente debe completar. Busca cláusulas de causal de inadmisibilidad, rechazo, o declaración de oferta desierta ligadas a: certificaciones obligatorias de producto, garantías exigidas, topes máximos (ej. plazo de entrega), exigencia de FIRMA MANUSCRITA/de puño y letra (no digital ni electrónica) en algún documento u anexo específico, u otro requisito documental duro.

Para cada riesgo real que encuentres, indica: el riesgo en una frase, qué dato lo resuelve, y si ese dato típicamente ya está disponible en la ficha de la empresa o el costeo (certificaciones de producto, plazos, y exigencias de firma manuscrita NUNCA lo están — pon disponible:false para esos).

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
      // Mismo modelo que el resto del motor de anexos (31-ago-2026). Esta llamada era una de las
      // TRES del camino de anexos que quedaron sin fijar modelo, así que caía en el principal
      // (`glm-4.7-flashx`) — el que se cuelga. Medido en vivo durante la auditoría de este día:
      // 43 s colgado y después "Request timed out", con 90 s de espera máxima antes de que la
      // cadena de respaldo se active. El usuario lo reportó como "a veces se cuelga". Fijar
      // glm-4.7 lo saca del camino; la cadena (4.5-air → 4.7 → 5.2) sigue disponible si este falla.
    }, { timeoutMs: 90_000, modeloPreferido: 'glm-4.7', soloGlm: true });
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
      // Ver el comentario de resolverAlertasInadmisibilidad: misma corrección, misma razón.
    }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true });
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
  const { candidatos, blancosInline, parrafos, empresa, basesTexto, tituloAnexos, postulaComoUTP, haySeccionUtpOmitida, reglasAprendidas, overridesAprendidos, omitirAlertas } = entrada;

  const camposConDato = (Object.keys(empresa) as (keyof EmpresaCampos)[])
    // firma_url/timbre_url son URLs de imágenes, no texto que se escriba en una casilla — si se le
    // muestran al modelo termina proponiéndolas como "valor" de algún campo.
    .filter(c => c !== 'firma_url' && c !== 'timbre_url' && empresa[c] != null && String(empresa[c]).trim());

  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();

  const alertasInadmisibilidad = omitirAlertas
    ? []
    : await resolverAlertasInadmisibilidad(basesTexto || '', tituloAnexos || []);

  if (!camposConDato.length || (!candidatos.length && !blancosInline.length)) {
    return { celda, inline, faltantesFicha: [], alertasInadmisibilidad, checklistPendientes: alertasInadmisibilidad.filter(a => !a.disponible).map(a => a.riesgo) };
  }

  // ── PASO 1: motor DETERMINISTA (anexos-determinista.ts) ──────────────────────────────────
  // Es el camino PRINCIPAL desde el 17-ago-2026. Resuelve `campoFijo` (estructura del documento),
  // el diccionario de etiquetas inequívocas, las etiquetas peladas desambiguadas por bloque, la
  // declaración jurada corrida y las reglas fijas de política. Lo que resuelve acá NUNCA se le
  // pregunta a nadie: la respuesta no depende de ningún juicio, no varía entre corridas y no se
  // cae por un 429 del proveedor.
  const det = resolverDeterminista({ candidatos, blancosInline, parrafos, empresa, overridesAprendidos });
  for (const [i, r] of det.celda) celda.set(i, r);
  for (const [k, r] of det.inline) inline.set(k, r);

  const candidatosParaIA = det.celdaSinResolver;
  const blancosParaIA = det.inlineSinResolver;

  // ── PASO 2: respaldo IA, APAGADO por defecto ─────────────────────────────────────────────
  // `ANEXOS_IA_RESPALDO=1` lo enciende para la cola que el diccionario no cubre (etiquetas
  // redactadas de forma no anticipada). Apagado, el motor es 100% código: lo no resuelto queda
  // pendiente con un motivo legible, que es exactamente lo que el humano necesita ver.
  //
  // Regla dura en ambos modos: la IA solo AGREGA. Nunca pisa lo que el determinista ya resolvió
  // —por eso arranca desde `celdaSinResolver`, no desde la lista completa.
  if (process.env.ANEXOS_IA_RESPALDO !== '1') {
    for (const c of candidatosParaIA) {
      celda.set(c.indice, { tipo: 'pendiente', ...clasificarPendiente(c.etiqueta) });
    }
    for (const b of blancosParaIA) {
      inline.set(`${b.indiceRun}:${b.posEnTexto}`, { tipo: 'pendiente', ...clasificarPendiente(b.textoMarcador || b.contexto || '') });
    }
    const checklist = [...celda.values(), ...inline.values()]
      .filter((r): r is ResolucionPendiente => r.tipo === 'pendiente' && r.categoria === 'decision_del_usuario')
      .map(r => r.motivo);
    return { celda, inline, faltantesFicha: det.faltantesFicha, alertasInadmisibilidad, checklistPendientes: [...new Set(checklist)] };
  }

  // BUG REAL (1426039-8-LE26, 10-ago-2026): `candidatos` llega como [...candidatosCelda (patrón 1),
  // ...camposConDosPuntos (patrón 5)] — dos listas pegadas, NO en orden de aparición en el
  // documento. "NOMBRE O RAZÓN SOCIAL:" y "R.U.T:" (patrón 5, dos filas seguidas de la MISMA
  // tabla) terminaron en LOTES DISTINTOS porque toda la lista de patrón 1 se interponía en el
  // medio — "R.U.T" quedó SOLO en un lote de 1, sin "NOMBRE O RAZÓN SOCIAL" al lado para anclar
  // el contexto, y la IA (probado aislándolo) lo clasificó "no_aplica_al_oferente — uso interno
  // del organismo" en vez de perfil_empresa/rut. Emparejado con su vecino real (mismo bloque,
  // mismo lote), resuelve bien. Ordenar por posición en el documento ANTES de trocear en lotes
  // mantiene juntas las casillas que están juntas en el papel — no cambia ninguna categoría ni
  // guardarraíl, solo qué comparte lote con qué.
  const candidatosOrdenados = [...candidatosParaIA].sort((a, b) => a.indice - b.indice);
  let n = 0;
  const items: ItemLote[] = [
    ...candidatosOrdenados.map((c): ItemLote => ({ n: ++n, ref: { tipo: 'celda', c }, texto: '' })),
    ...blancosParaIA.map((b): ItemLote => ({ n: ++n, ref: { tipo: 'inline', b }, texto: '' })),
  ];
  for (const item of items) {
    item.texto = item.ref.tipo === 'celda'
      ? formatearCandidatoCelda(item.ref.c, parrafos, item.n)
      : formatearCandidatoInline(item.ref.b, item.n);
  }

  const resultados = await enParaleloLimitado(
    enLotes(items, TAMANO_LOTE), LOTES_EN_PARALELO,
    lote => resolverLoteCampos(lote, empresa, camposConDato, postulaComoUTP, reglasAprendidas || [], haySeccionUtpOmitida),
  );

  // Los riesgos de inadmisibilidad NO se repiten acá a propósito (13-ago-2026, feedback del
  // usuario: "las amarillas no me sirven para nada"). Antes esta lista se sembraba con
  // `alertasInadmisibilidad.filter(a => !a.disponible)` — exactamente el mismo conjunto que ya se
  // muestra, palabra por palabra, en el recuadro ROJO de arriba (ver AlertasInadmisibilidad en
  // AnexoRellenoModal.tsx, que filtra por el mismo `!a.disponible`). El resultado era un bloque
  // amarillo que solo repetía el rojo, sin agregar ni una línea nueva. El checklist queda para lo
  // que NO tiene otro lugar donde aparecer: las casillas que la IA no pudo decidir sola y necesitan
  // un criterio del usuario (categoria decision_del_usuario).
  const checklistSet = new Set<string>();

  for (const mapa of resultados) {
    for (const [n2, res] of mapa) {
      const item = items.find(i => i.n === n2)!;
      if (item.ref.tipo === 'celda') celda.set(item.ref.c.indice, res);
      else inline.set(`${item.ref.b.indiceRun}:${item.ref.b.posEnTexto}`, res);
      if (res.tipo === 'pendiente' && res.categoria === 'decision_del_usuario') checklistSet.add(res.motivo);
    }
  }

  return { celda, inline, faltantesFicha: det.faltantesFicha, alertasInadmisibilidad, checklistPendientes: [...checklistSet] };
}
