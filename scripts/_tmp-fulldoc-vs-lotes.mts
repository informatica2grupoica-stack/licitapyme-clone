// Prueba: ¿el problema es el TROCEO EN LOTES DE 8, o el VOCABULARIO RESTRINGIDO a los 16 campos
// de la ficha? Aísla la variable: misma IA, mismo prompt, mismo guardarraíl — la única diferencia
// es mandar TODAS las casillas del documento en una sola llamada (como al pegar el Word entero en
// un chat) en vez de trocear de a 8.
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');
const { normalizarParaIds, abrirDocx } = await import('@/app/lib/anexos-docx');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { esMatchCoherente } = await import('@/app/lib/anexos-diccionario');
const { crearChatIA } = await import('@/app/lib/gemini');
const { parseJsonIA } = await import('@/app/lib/json-ia');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
     FROM empresas WHERE id = 1`);
const empresa = conCamposDerivados(empRows[0]);

const [docs]: any = await pool.query(`SELECT documento_url_local FROM documentos_cache WHERE id = 21202`);
const buffer = Buffer.from(await (await fetch(docs[0].documento_url_local)).arrayBuffer());
const { xml: crudo } = await abrirDocx(buffer);
const { xml } = normalizarParaIds(crudo);
const analisis = analizarAnexo(xml);
const parrafos = analisis.parrafos;

const camposConDato = (Object.keys(empresa) as any[]).filter(c => c !== 'firma_url' && empresa[c] != null && String(empresa[c]).trim());
const ficha = camposConDato.map((c: any) => `- ${c}: "${String(empresa[c])}"`).join('\n');

const CANTIDAD_PARRAFOS_PREVIOS = 6;
function contextoPrevio(antesDeIndice: number): string[] {
  const out: string[] = [];
  for (let i = antesDeIndice - 1; i >= 0 && out.length < CANTIDAD_PARRAFOS_PREVIOS; i--) {
    const p = parrafos[i];
    if (p?.texto && !p.vacio) out.push(p.texto);
  }
  return out.reverse();
}
function formatearCandidato(c: any, n: number): string {
  const partes: string[] = [];
  const compuesta = c.etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (compuesta) partes.push(`etiqueta: "${compuesta[2]}"`, `fila/bloque: "${compuesta[1]}"`);
  else partes.push(`etiqueta: "${c.etiqueta}"`);
  const previos = contextoPrevio(c.indice - 1);
  if (previos.length) partes.push(`texto anterior: ${previos.map((p: string) => `"${p.slice(0, 160)}"`).join(' / ')}`);
  return `${n}. ${partes.join(' — ')}`;
}

const SYS = `Eres un experto en licitaciones públicas chilenas (Mercado Público) que completa los ANEXOS que el organismo comprador entrega en Word para que los llene el oferente.

Te doy la FICHA de la empresa y TODAS las casillas en blanco del documento COMPLETO (6 formularios pegados). Decide para cada una qué dato de la ficha corresponde, o ninguno.

REGLA CLAVE — UNA SOLA PERSONA: el oferente, representante legal, encargado de la propuesta, contacto y administrador de contrato son la MISMA persona de la ficha.

NO LLENAR: bloques de Persona Natural o UTP; terceros ajenos (otro integrante UTP, cliente anterior, socio); datos que no están en la ficha; encabezados/columnas genéricas; precios/cantidades/plazos/cumplimiento técnico; ciudad en "Ciudad y fecha".

La etiqueta debe NOMBRAR explícitamente el dato. Si describe otra cosa (producto, requisito técnico, "Cumple Sí/No", "Observaciones", "Marca"), es null.

Devuelve SOLO JSON: {"casillas":[{"id":<n>,"campo":"<campo>"|null}]}`;

async function correr(nombre: string, candidatos: any[]) {
  const user = `FICHA:\n${ficha}\n\nCASILLAS (${candidatos.length}):\n${candidatos.map((c, i) => formatearCandidato(c, i + 1)).join('\n')}`;
  const t0 = Date.now();
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
    temperature: 0, stream: false, max_tokens: 16000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 120_000 });
  const ms = Date.now() - t0;
  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  console.log(`  [debug] longitud respuesta=${txt.length} chars, finish_reason=${completion.choices?.[0]?.finish_reason}`);
  const parsed: any = parseJsonIA(txt) || {};
  const arr = Array.isArray(parsed.casillas) ? parsed.casillas : [];
  const validos = new Set(camposConDato);
  let ok = 0, incoherentes = 0;
  const resultado: any[] = [];
  for (const r of arr) {
    if (!r) continue;
    const item = candidatos[Number(r.id) - 1];
    if (!item || !validos.has(r.campo)) continue;
    if (!esMatchCoherente(item.etiqueta, r.campo)) { incoherentes++; continue; }
    ok++;
    resultado.push({ etiqueta: item.etiqueta, campo: r.campo });
  }
  console.log(`\n=== ${nombre} === (${ms}ms, ${candidatos.length} casillas enviadas)`);
  console.log(`  resueltas=${ok}  incoherentes-bloqueadas=${incoherentes}  crudas-devueltas=${arr.length}`);
  resultado.forEach(r => console.log(`   ✓ "${r.etiqueta.slice(0, 60)}" → ${r.campo}`));
  return resultado;
}

// TODO el documento en una sola llamada — como pegar el Word entero en un chat.
await correr('UN SOLO LLAMADO (documento completo)', analisis.candidatosCelda);

await pool.end();