// Prototipo Frente E, paso 9 — arreglo al hallazgo del documento 3: no todos los .docx reales
// traen w14:paraId en sus párrafos (depende de con qué versión/modo se guardó en Word). Sin
// eso, la técnica de "encontrar el párrafo por su ID" no tiene de dónde agarrarse.
//
// Arreglo: agregar los w14:paraId que falten ANTES de detectar/rellenar nada. Es seguro —
// agregar un atributo a un párrafo no cambia su contenido, su conteo, ni nada visible; Word
// los usa para su propio control de cambios y los genera solo la próxima vez que alguien
// guarda el archivo. Si el documento no declaraba el namespace w14 (porque nunca lo usó),
// también hay que agregarlo en la raíz o Word rechazaría el archivo por un prefijo sin definir.
function idAleatorio(usados) {
  let id;
  do { id = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0'); }
  while (usados.has(id));
  usados.add(id);
  return id;
}

export function normalizarParaIds(xml) {
  const usados = new Set([...xml.matchAll(/w14:paraId="([0-9A-Fa-f]+)"/g)].map(m => m[1].toUpperCase()));
  let agregados = 0;

  // 1) Namespace: si no está declarado y hace falta, agregarlo al elemento raíz <w:document ...>.
  if (!/xmlns:w14=/.test(xml)) {
    xml = xml.replace(/<w:document /, '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ');
  }

  // 2) Cada <w:p ...> SIN w14:paraId recibe uno nuevo (y un w14:textId, que Word siempre trae
  // junto). Se procesa con reemplazo función-por-match para no pisar atributos existentes.
  xml = xml.replace(/<w:p\b([^>]*)>/g, (m, attrs) => {
    if (/w14:paraId=/.test(attrs)) return m; // ya lo tenía, no tocar
    const paraId = idAleatorio(usados);
    agregados++;
    return `<w:p${attrs} w14:paraId="${paraId}" w14:textId="77777777">`;
  });

  return { xml, agregados };
}
