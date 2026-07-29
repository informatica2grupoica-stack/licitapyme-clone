// app/lib/anexos-dividir.ts
// Divide un anexo YA RELLENADO que trae varios formularios pegados en un solo .docx (patrón
// real visto en documentos de Mercado Público: "FORMULARIO N°1", "FORMULARIO N°1-A",
// "FORMULARIO N°2"…) en un .docx independiente por formulario. Se corre DESPUÉS de rellenar
// (anexos-rellenar.ts) — así el relleno ve el documento completo de una sola vez (un campo
// nunca queda a medias por estar "cortado" en otro fragmento), y esto solo separa el resultado
// final en archivos, sin tocar contenido.
//
// Cada fragmento clona el .docx completo (mismos estilos/tema/imágenes) y le cambia SOLO
// word/document.xml al rango de párrafos de ese formulario + el <w:sectPr> final original (el
// margen/tamaño de página) — así cada archivo abre igual de bien que el original, no una
// versión "pelada".
//
// Si el documento no tiene al menos 2 encabezados "FORMULARIO N°X", no se divide — sigue
// generando un solo archivo como antes (ver `< 2` abajo). Documentos sin ese patrón (la
// mayoría) no se ven afectados.
import JSZip from 'jszip';

export interface FormularioDetectado { titulo: string; indiceInicio: number; indiceFin: number }

const RE_ENCABEZADO_FORMULARIO = /^FORMULARIO\s*N[°ºO]?\.?\s*\d+/i;
const LARGO_MAX_ENCABEZADO = 80; // evita falsos positivos: una oración larga que MENCIONA "Formulario N°1" no es un encabezado

interface ParrafoCrudo { textoPlano: string; xmlCompleto: string }

function listarParrafosCrudos(xml: string): ParrafoCrudo[] {
  const out: ParrafoCrudo[] = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const cuerpo = m[1];
    const texto = [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(x => x[1]).join('').trim();
    out.push({ textoPlano: texto, xmlCompleto: m[0] });
  }
  return out;
}

export function detectarFormularios(xml: string): FormularioDetectado[] {
  const parrafos = listarParrafosCrudos(xml);
  const encabezados: { indice: number; titulo: string }[] = [];
  parrafos.forEach((p, i) => {
    if (p.textoPlano.length <= LARGO_MAX_ENCABEZADO && RE_ENCABEZADO_FORMULARIO.test(p.textoPlano)) {
      encabezados.push({ indice: i, titulo: p.textoPlano });
    }
  });
  return encabezados.map((h, i) => ({
    titulo: h.titulo,
    indiceInicio: h.indice,
    indiceFin: (encabezados[i + 1]?.indice ?? parrafos.length) - 1,
  }));
}

// "FORMULARIO N°1-A: IDENTIFICACIÓN..." → "N1-A" (para el nombre de archivo)
function sufijoDeArchivo(titulo: string): string {
  const m = titulo.match(/FORMULARIO\s*N[°ºO]?\.?\s*(\d+(?:-[A-Z])?)/i);
  const base = m ? `N${m[1]}` : titulo.slice(0, 20);
  return base.replace(/[^\w-]/g, '_');
}

export interface FormularioDividido { nombreSufijo: string; titulo: string; buffer: Buffer }

export async function dividirPorFormularios(bufferBase: Buffer, xml: string): Promise<FormularioDividido[]> {
  const parrafos = listarParrafosCrudos(xml);
  const formularios = detectarFormularios(xml);
  if (formularios.length < 2) return []; // 0 o 1 no amerita dividir — se mantiene un solo archivo

  const aperturaBodyMatch = xml.match(/<w:body[^>]*>/);
  if (!aperturaBodyMatch) return [];
  const aperturaBody = aperturaBodyMatch[0];
  const preBody = xml.slice(0, aperturaBodyMatch.index);

  // El <w:sectPr> final (margen/tamaño/orientación de página) es hijo directo de <w:body>,
  // justo antes de </w:body> — se repite igual en cada fragmento para que abran igual de bien.
  const sectPrMatch = xml.match(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';

  const resultados: FormularioDividido[] = [];
  for (const f of formularios) {
    const cuerpo = parrafos.slice(f.indiceInicio, f.indiceFin + 1).map(p => p.xmlCompleto).join('');
    const xmlFragmento = `${preBody}${aperturaBody}${cuerpo}${sectPr}</w:body></w:document>`;

    const zip = await JSZip.loadAsync(bufferBase);
    zip.file('word/document.xml', xmlFragmento);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    resultados.push({ nombreSufijo: sufijoDeArchivo(f.titulo), titulo: f.titulo, buffer });
  }
  return resultados;
}
