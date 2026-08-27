// app/lib/ficha-tecnica.ts
// FICHA TÉCNICA PROPIA — el documento que NOSOTROS presentamos, armado desde lo que exigen las bases.
//
// POR QUÉ EXISTE (26-ago-2026, idea del usuario): hasta ahora la ficha técnica era siempre algo que
// llegaba de afuera — el proveedor la mandaba y el Auditor la comparaba contra las exigencias. Eso
// deja dos huecos: (1) el Anexo de oferta técnica que hay que PRESENTAR se armaba a mano, y (2) no
// había una referencia propia contra la cual leer lo que manda el proveedor.
//
// Este módulo da vuelta el orden: primero se genera NUESTRA ficha desde las exigencias ya
// clasificadas (checklist_comercial_caracteristicas: descripción, tipo PISO/TECHO/EXACTO/RANGO,
// valor exigido, unidad), y esa ficha es a la vez el entregable y la vara de comparación. Donde la
// ficha del proveedor difiera, se corrige a mano — pero la diferencia se ve, que es el punto.
//
// NO INVENTA NADA. Una columna "ofertado" sin dato se imprime vacía, con su casilla para completar:
// una ficha que se rellena sola con valores plausibles es exactamente lo que no se puede presentar
// a un organismo público. Ver [[feedback_datos_reales_nunca_inventados]] en el criterio del
// proyecto: el vacío honesto siempre antes que el dato inventado.
//
// El PDF lo produce generarInformePdf (HTML → chromium → A4), el mismo motor del Informe Técnico.
// Las imágenes (logo, firma, timbre) viajan como data: URI porque ese motor carga el HTML con
// setContent y sin recursos externos.

import { normalizarValorParaDocumento } from '@/app/lib/valor-ofertado-normalizar';

export interface EspecificacionFicha {
  descripcion: string;
  tipo: string | null;                    // PISO | TECHO | EXACTO | RANGO
  valorRequeridoTexto: string | null;
  valorRequeridoNumero: number | null;
  valorRequeridoNumeroMax: number | null;
  unidadRequerida: string | null;
  valorOfertadoTexto: string | null;
  valorOfertadoNumero: number | null;
  unidadOfertada: string | null;
}

export interface ProductoOfertadoLinea {
  /** Nombre de ESTE producto dentro de una línea-paquete (migración 82, caso real 2446-240-LE26:
   *  "Hidrolavadora H300" + "Vacuolavadora DB51 Dimer" bajo la misma línea de precio). null en el
   *  caso normal de un solo producto por línea — ahí no hace falta repetir el título de la línea. */
  nombre?: string | null;
  marca: string | null;
  modelo: string | null;
  fabricante: string | null;
  paisFabricacion: string | null;
  anioFabricacion: string | null;
  garantiaMeses: number | null;
  /** true = una persona lo confirmó; false/undefined = todavía es lo que se leyó de la ficha, sin
   *  revisar. Se usa para decidir si el dato se imprime tal cual o con un aviso al lado. */
  confirmado?: boolean;
  /** Foto del producto, como data: URI — sacada de la ficha del proveedor (ver
   *  ficha-imagen-extraer.ts) o subida a mano. null/undefined = todavía no hay foto. */
  imagenDataUri?: string | null;
  /** true = una persona confirmó que ESTA foto corresponde al producto (o la subió ella misma).
   *  Independiente de `confirmado` (migration-81): probado contra fichas reales, la extracción
   *  automática a veces trae la imagen equivocada, así que confirmar el texto no confirma la
   *  foto y viceversa. */
  imagenConfirmada?: boolean;
}

export interface LineaFicha {
  linea: number | null;
  titulo: string;
  cantidad: number | null;
  unidad: string | null;
  especificaciones: EspecificacionFicha[];
  /** Marca/modelo/fabricante/foto de cada producto de ESTA línea — normalmente uno solo; más de
   *  uno cuando la línea real es un paquete (migración 82). Vacío o ausente si no se cargó nada
   *  (ver producto-ofertado.ts). No confundir con marcaModeloReferencia del informe, que es lo que
   *  PIDEN las bases, no lo que ofertamos. */
  productosOfertados?: ProductoOfertadoLinea[];
}

export interface EmpresaFicha {
  razonSocial: string;
  rut: string | null;
  giro: string | null;
  direccion: string | null;
  email: string | null;
  telefono: string | null;
  representanteNombre: string | null;
  representanteRut: string | null;
  representanteCargo: string | null;
  logoDataUri: string | null;
  firmaDataUri: string | null;
  timbreDataUri: string | null;
}

export interface DatosFichaTecnica {
  licitacionCodigo: string;
  licitacionNombre: string | null;
  organismo: string | null;
  empresa: EmpresaFicha;
  lineas: LineaFicha[];
  generadoPor: string | null;
  /** Fecha ya formateada por el llamador — este módulo es puro y no lee el reloj. */
  fechaTexto: string;
}

const esc = (x: unknown): string => String(x ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number | null): string =>
  n == null ? '' : Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));

/**
 * El requisito en una sola frase legible: "Mínimo 1.200 W", "Entre 10 y 20 kg", "Exactamente 82 piezas".
 *
 * Se prefiere SIEMPRE la cita textual de las bases cuando existe (`valorRequeridoTexto`): es lo que
 * el organismo escribió, y reescribirlo con nuestras palabras en un documento que se presenta a
 * evaluación es arriesgado. El armado por tipo/número es el respaldo para cuando solo quedó el
 * dato numérico clasificado.
 */
export function textoRequisito(e: EspecificacionFicha): string {
  if (e.valorRequeridoTexto && e.valorRequeridoTexto.trim()) return e.valorRequeridoTexto.trim();
  const u = e.unidadRequerida ? ` ${e.unidadRequerida}` : '';
  const v = num(e.valorRequeridoNumero);
  if (!v) return '';
  switch (e.tipo) {
    case 'PISO':   return `Mínimo ${v}${u}`;
    case 'TECHO':  return `Máximo ${v}${u}`;
    case 'RANGO':  return e.valorRequeridoNumeroMax != null
      ? `Entre ${v} y ${num(e.valorRequeridoNumeroMax)}${u}`
      : `Desde ${v}${u}`;
    case 'EXACTO': return `${v}${u}`;
    default:       return `${v}${u}`;
  }
}

/**
 * Lo que ofertamos, o cadena vacía si todavía no hay dato (nunca se rellena con un supuesto).
 *
 * El texto pasa por normalizarValorParaDocumento porque el valor guardado viene tal cual de la
 * ficha del proveedor, que suele ser una traducción del inglés: "0.001 to 999,900 cd/m2" leído a
 * la chilena cambia el orden de magnitud, y "Obediente B" (de "Class B compliant") confunde al
 * evaluador. El valor CRUDO queda intacto en la base como evidencia; acá solo se imprime limpio.
 */
export function textoOfertado(e: EspecificacionFicha): string {
  if (e.valorOfertadoTexto && e.valorOfertadoTexto.trim()) {
    return normalizarValorParaDocumento(e.valorOfertadoTexto);
  }
  const v = num(e.valorOfertadoNumero);
  if (!v) return '';
  return `${v}${e.unidadOfertada ? ` ${e.unidadOfertada}` : ''}`;
}

/** Cuántas casillas quedaron sin completar — el aviso que la pantalla muestra antes de presentar. */
export function especificacionesSinCompletar(lineas: LineaFicha[]): number {
  return lineas.reduce((n, l) => n + l.especificaciones.filter(e => !textoOfertado(e)).length, 0);
}

function tablaLinea(l: LineaFicha): string {
  // DOS FORMAS DE LA MISMA TABLA, según lo que se sepa de la línea:
  //
  //  · CLASIFICADA (alguien ya validó la línea): 4 columnas, con el valor exigido en su propia
  //    columna — "Potencia" | "Mínimo 1.200 W".
  //  · SIN CLASIFICAR (lo habitual antes de validar: el texto viene del informe tal como lo dicen
  //    las bases): 3 columnas. La especificación completa ES la exigencia, así que separarla en
  //    dos dejaría una columna entera en blanco en TODAS las filas — se lee como si faltara un
  //    dato, cuando en realidad no falta nada.
  //
  // Se decide por línea y no por documento: en una misma ficha puede haber una línea ya validada
  // y otra que no.
  const clasificada = l.especificaciones.some(e => textoRequisito(e));

  const filas = l.especificaciones.map((e, i) => {
    const ofertado = textoOfertado(e);
    const celdaOfertado = `<td class="of${ofertado ? '' : ' vacia'}">${ofertado ? esc(ofertado) : ''}</td>`;
    return clasificada
      ? `<tr>
      <td class="n">${i + 1}</td>
      <td>${esc(e.descripcion)}</td>
      <td class="req">${esc(textoRequisito(e))}</td>
      ${celdaOfertado}
    </tr>`
      : `<tr>
      <td class="n">${i + 1}</td>
      <td>${esc(e.descripcion)}</td>
      ${celdaOfertado}
    </tr>`;
  }).join('');

  const cabeceraCantidad = [
    l.cantidad != null ? `Cantidad: ${num(l.cantidad)}` : '',
    l.unidad || '',
  ].filter(Boolean).join(' ');

  // Un producto (lo normal): sus datos van tal cual, como siempre. Varios productos (línea-paquete,
  // migración 82): cada uno con su propio subtítulo, foto y tabla "Información de la oferta" —
  // sin el subtítulo repetido no habría forma de saber cuál marca/modelo es de cuál producto.
  const productos = l.productosOfertados || [];
  const bloquesProducto = productos.map(p => `
    ${productos.length > 1 && p.nombre ? `<p class="producto-nombre">${esc(p.nombre)}</p>` : ''}
    ${imagenProducto(p)}
    ${tablaProductoOfertado(p)}`).join('');

  return `<section class="linea">
    <h2>${l.linea != null ? `Línea ${l.linea} — ` : ''}${esc(l.titulo)}</h2>
    ${cabeceraCantidad ? `<p class="cant">${esc(cabeceraCantidad)}</p>` : ''}
    ${bloquesProducto}
    ${l.especificaciones.length === 0
      ? '<p class="sin">Sin especificaciones técnicas registradas para esta línea.</p>'
      : `<table class="specs">
          <thead><tr><th class="n">#</th>${clasificada
            ? '<th>Característica</th><th>Exigido en las bases</th>'
            : '<th>Especificación exigida en las bases</th>'}<th>Ofertado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>`}
  </section>`;
}

/**
 * Foto del producto — mismo lugar donde la trae la ficha de un proveedor típico: bajo el título,
 * antes de la tabla de especificaciones (ver el ejemplo que originó esto: Tecnomaq).
 *
 * OJO, VERIFICADO CON FICHAS REALES (27-ago-2026): la extracción automática (ver
 * ficha-imagen-extraer.ts) elige "la imagen más grande de la página", y eso a veces NO es la foto
 * del producto — en una prueba contra 15 fichas de proveedor ya cargadas, 2 de 4 casos revisados
 * a mano trajeron una textura decorativa de marketing o una franja de logos de certificación en
 * vez del equipo. Por eso, mientras nadie la haya confirmado (mismo `confirmado` que ya gatea
 * marca/modelo/fabricante), se imprime con un aviso en vez del pie neutro "Imagen referencial" —
 * mismo criterio que tablaProductoOfertado(): no se oculta el dato leído automáticamente, pero
 * tampoco se presenta como si fuera definitivo.
 */
export function imagenProducto(p: ProductoOfertadoLinea | null | undefined): string {
  if (!p?.imagenDataUri) return '';
  const pie = p.imagenConfirmada
    ? 'Imagen referencial'
    : '⚠ Imagen leída automáticamente de la ficha del proveedor — confirmar que corresponde al equipo antes de presentar.';
  return `<div class="foto-producto">
    <img src="${p.imagenDataUri}" alt="" />
    <p class="foto-ref${p.imagenConfirmada ? '' : ' sin-confirmar'}">${esc(pie)}</p>
  </div>`;
}

/**
 * "Información de la oferta" — marca/modelo/fabricante/país/año/garantía del producto de ESTA
 * línea. Es exactamente lo que piden los formularios técnicos del organismo (ver
 * project_formulario_n3_matriz_cumplimiento_ago2026), y hasta ahora no había dónde imprimirlo.
 *
 * Si NO hay dato cargado, no se muestra ninguna tabla — no tiene sentido imprimir 5 filas vacías
 * cuando nadie subió todavía la ficha del proveedor. Si hay ALGÚN dato pero no está confirmado por
 * una persona, se avisa con una nota: presentar sin revisar lo que leyó una máquina es un riesgo.
 */
function tablaProductoOfertado(p: ProductoOfertadoLinea | null | undefined): string {
  if (!p) return '';
  const filas = ([
    ['Marca', p.marca], ['Modelo', p.modelo], ['Fabricante', p.fabricante],
    ['País de fabricación', p.paisFabricacion], ['Año de fabricación', p.anioFabricacion],
    ['Garantía técnica', p.garantiaMeses != null ? `${p.garantiaMeses} meses` : null],
  ] as Array<[string, string | null]>).filter(([, v]) => v && String(v).trim());
  if (!filas.length) return '';
  return `<table class="oferta">
      <tbody>${filas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody>
    </table>
    ${p.confirmado ? '' : '<p class="sin-confirmar">⚠ Dato leído automáticamente de la ficha del proveedor — revisar antes de presentar.</p>'}`;
}

export function construirFichaTecnicaHtml(d: DatosFichaTecnica): string {
  const e = d.empresa;
  const datosEmpresa: Array<[string, string | null]> = [
    ['Razón social', e.razonSocial],
    ['RUT', e.rut],
    ['Giro', e.giro],
    ['Dirección', e.direccion],
    ['Correo', e.email],
    ['Teléfono', e.telefono],
  ];

  // La firma va SOBRE la línea (la línea es el renglón donde se firma) y el timbre AL LADO, en su
  // propia columna.
  //
  // La primera versión ponía las dos imágenes en `position:absolute` sobre el mismo punto, para
  // imitar el sello encima de la firma. En el papel quedaron una encima de la otra e ilegibles
  // (lo reportó el usuario al ver el primer PDF). Acá se usa flujo normal con una caja de alto
  // fijo para la firma: aunque las imágenes vengan de cualquier tamaño, no pueden solaparse —
  // el layout lo impide por construcción, no por ajuste de márgenes.
  const bloqueFirma = `<div class="firma">
    <div class="firma-col">
      <div class="firma-espacio">
        ${e.firmaDataUri ? `<img class="firma-img" src="${e.firmaDataUri}" alt="" />` : ''}
      </div>
      <div class="firma-linea"></div>
      <p class="firma-nombre">${esc(e.representanteNombre || e.razonSocial)}</p>
      ${e.representanteRut ? `<p class="firma-dato">RUT ${esc(e.representanteRut)}</p>` : ''}
      ${e.representanteCargo ? `<p class="firma-dato">${esc(e.representanteCargo)}</p>` : ''}
      <p class="firma-dato">${esc(e.razonSocial)}</p>
    </div>
    ${e.timbreDataUri ? `<div class="timbre-col"><img class="timbre-img" src="${e.timbreDataUri}" alt="" /></div>` : ''}
  </div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
<title>Ficha Técnica — ${esc(d.licitacionCodigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #18181b;
         font-size: 10.5px; line-height: 1.45; margin: 0; }
  header { display: flex; align-items: flex-start; gap: 14px; border-bottom: 2px solid #0f766e;
           padding-bottom: 10px; margin-bottom: 14px; }
  header .logo { max-height: 56px; max-width: 190px; object-fit: contain; }
  header .tit { flex: 1; }
  header h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .2px; }
  header .sub { color: #52525b; font-size: 10px; margin: 0; }
  header .cod { color: #0f766e; font-weight: 700; font-size: 10px; margin: 3px 0 0; }
  table.kv { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  table.kv th { text-align: left; width: 110px; color: #52525b; font-weight: 600;
                padding: 3px 8px 3px 0; vertical-align: top; font-size: 10px; }
  table.kv td { padding: 3px 0; }
  section.linea { margin-bottom: 16px; page-break-inside: avoid; }
  section.linea h2 { font-size: 11.5px; margin: 0 0 2px; padding: 5px 8px; background: #f4f4f5;
                     border-left: 3px solid #0f766e; }
  p.cant { margin: 0 0 5px 8px; color: #71717a; font-size: 9.5px; }
  /* Subtítulo de CADA producto dentro de una línea-paquete (varios productos, migración 82) —
     sin esto no se distingue de cuál producto es la marca/modelo/foto que sigue. */
  p.producto-nombre { margin: 10px 0 4px 8px; font-weight: 700; font-size: 10.5px; color: #18181b; }
  .foto-producto { text-align: center; margin: 4px 0 8px; page-break-inside: avoid; }
  .foto-producto img { max-height: 150px; max-width: 60%; object-fit: contain; }
  .foto-producto .foto-ref { margin: 3px 0 0; color: #a1a1aa; font-size: 8.5px; font-style: italic; }
  .foto-producto .foto-ref.sin-confirmar { color: #b45309; font-weight: 600; font-style: normal; }
  table.oferta { border-collapse: collapse; margin: 0 0 4px 8px; }
  table.oferta th { text-align: left; color: #52525b; font-weight: 600; padding: 2px 10px 2px 0;
                    font-size: 9.5px; white-space: nowrap; }
  table.oferta td { padding: 2px 0; font-weight: 600; }
  p.sin-confirmar { margin: 0 0 6px 8px; color: #b45309; font-size: 9px; font-weight: 600; }
  p.sin { margin: 0 0 5px 8px; color: #a1a1aa; font-style: italic; }
  table.specs { border-collapse: collapse; width: 100%; }
  table.specs th, table.specs td { border: 1px solid #e4e4e7; padding: 4px 6px; vertical-align: top; }
  table.specs thead th { background: #fafafa; font-size: 9.5px; text-transform: uppercase;
                         letter-spacing: .3px; color: #52525b; }
  table.specs td.n, table.specs th.n { width: 22px; text-align: center; color: #a1a1aa; }
  table.specs td.req { width: 27%; }
  table.specs td.of  { width: 27%; }
  /* Casilla sin dato: se imprime VACÍA y con fondo, para que se vea que falta completarla.
     Nunca se rellena con un valor plausible. */
  table.specs td.of.vacia { background: #fffbeb; min-height: 16px; }
  /* Firma y timbre en COLUMNAS SEPARADAS, en flujo normal. Nada de position:absolute acá: la
     primera versión los superponía a propósito y en el papel quedaron ilegibles. */
  .firma { margin-top: 30px; page-break-inside: avoid; display: flex; align-items: flex-end; gap: 34px; }
  .firma-col { width: 250px; text-align: center; }
  /* Alto fijo: la firma se apoya sobre la línea sin empujarla, venga del tamaño que venga. */
  .firma-espacio { height: 52px; display: flex; align-items: flex-end; justify-content: center; }
  .firma-img { max-height: 52px; max-width: 210px; object-fit: contain; }
  .timbre-col { width: 110px; display: flex; align-items: flex-end; justify-content: center; }
  .timbre-img { max-height: 92px; max-width: 110px; object-fit: contain; }
  .firma-linea { border-top: 1px solid #18181b; margin-bottom: 4px; }
  .firma-nombre { margin: 0; font-weight: 700; }
  .firma-dato { margin: 0; color: #52525b; font-size: 9.5px; }
  footer { margin-top: 22px; border-top: 1px solid #e4e4e7; padding-top: 6px;
           color: #a1a1aa; font-size: 8.5px; }
</style></head><body>
<header>
  ${e.logoDataUri ? `<img class="logo" src="${e.logoDataUri}" alt="" />` : ''}
  <div class="tit">
    <h1>Ficha Técnica de la Oferta</h1>
    <p class="sub">${esc(d.licitacionNombre || '')}${d.organismo ? ` · ${esc(d.organismo)}` : ''}</p>
    <p class="cod">${esc(d.licitacionCodigo)}</p>
  </div>
</header>

<table class="kv">
  ${datosEmpresa.filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
</table>

${d.lineas.map(tablaLinea).join('')}

${bloqueFirma}

<footer>
  Documento generado por LICITANK el ${esc(d.fechaTexto)}${d.generadoPor ? ` · ${esc(d.generadoPor)}` : ''}.
  Las columnas "Exigido en las bases" se transcriben del análisis de las bases de la licitación
  ${esc(d.licitacionCodigo)}; las casillas de "Ofertado" que aparezcan en blanco deben completarse
  antes de presentar.
</footer>
</body></html>`;
}
