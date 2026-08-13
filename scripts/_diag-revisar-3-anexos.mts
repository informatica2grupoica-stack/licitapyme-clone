import { abrirDocx, listarParrafos } from '../app/lib/anexos-docx';
import { readFileSync } from 'node:fs';

const archivos = [
  ['N1', 'C:/Users/droku/Downloads/1786640382819_ANEXO_FORMULARIO_N1_IDENTIFICACION_DEL_PROPONENTE.docx'],
  ['N2', 'C:/Users/droku/Downloads/1786640439125_ANEXO_FORMULARIO_N2_ACEPTACI_N_DE_BASES_Y_CONOCIMIENTO_DE_LEY_DE_CONTRATACIONES_P_BLIC.docx'],
  ['N5', 'C:/Users/droku/Downloads/1786640507130_ANEXO_FORMULARIO_N5_PLAZOS_DE_ENTREGA_Y_GARANTIA_TECNICA.docx'],
] as const;

for (const [nombre, ruta] of archivos) {
  const buffer = readFileSync(ruta);
  const { xml } = await abrirDocx(buffer);
  const parrafos = listarParrafos(xml);
  console.log(`\n========== ${nombre} (${parrafos.length} párrafos) ==========`);
  parrafos.forEach((p, i) => {
    if (p.texto.trim()) console.log(`${i}${p.centrado ? ' [centrado]' : ''}${p.bordeInferior ? ' [borde-inf]' : ''}: ${p.texto.slice(0, 200)}`);
  });
}
