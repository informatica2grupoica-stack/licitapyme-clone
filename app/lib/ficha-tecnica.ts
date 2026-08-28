// app/lib/ficha-tecnica.ts
// FICHA TÉCNICA PROPIA — el documento que NOSOTROS presentamos, armado desde lo que exigen las bases.
//
// POR QUÉ EXISTE (26-ago-2026, idea del usuario): hasta ahora la ficha técnica era siempre algo que
// llegaba de afuera — el proveedor la mandaba y el Auditor la comparaba contra las exigencias. Eso
// deja dos huecos: (1) el Anexo de oferta técnica que hay que PRESENTAR se armaba a mano, y (2) no
// había una referencia propia contra la cual leer lo que manda el proveedor.
//
// FORMATO (27-ago-2026, pedido explícito del usuario con un ejemplo real de Tecnomaq): UNA FICHA
// POR PRODUCTO, cada una en su propia página, con el nombre grande, la marca/modelo debajo, la
// foto centrada con el pie "Imagen referencial" y la tabla de especificaciones de DOS columnas
// (característica | lo que ofertamos). Antes se imprimía una sola tabla por LÍNEA con todo
// mezclado: en una línea-paquete (2+ productos, ver migración 82/83) salían las dos fotos juntas
// arriba y después las 31 características de ambos equipos revueltas, sin forma de saber cuál era
// de cuál — exactamente lo que el usuario reportó.
//
// NO INVENTA NADA. Una casilla de valor ofertado sin dato se imprime VACÍA con fondo ámbar: una
// ficha que se rellena sola con valores plausibles es exactamente lo que no se puede presentar a
// un organismo público. Ver [[feedback_datos_reales_nunca_inventados]] en el criterio del
// proyecto: el vacío honesto siempre antes que el dato inventado.
//
// El PDF lo produce generarInformePdf (HTML → chromium → A4), el mismo motor del Informe Técnico.
// Las imágenes (logo, firma, timbre, fotos de producto) viajan como data: URI porque ese motor
// carga el HTML con setContent y sin recursos externos.

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

/**
 * UN producto ofertado, con TODO lo suyo: identidad (marca/modelo/foto) y SUS especificaciones.
 *
 * Una línea normal trae un solo producto. Una línea-paquete (migración 82/83, caso real
 * 2446-240-LE26: "Hidrolavadora H300" + "Vacuolavadora DB51 Dimer" bajo la misma línea de precio)
 * trae varios, y cada uno se imprime como su propia ficha — con sus propias características, que
 * es lo que `producto_index` distingue en checklist_comercial_caracteristicas.
 */
export interface ProductoFicha {
  /** Título grande de la ficha. En una línea de un solo producto es el título de la línea. */
  nombre: string;
  marca: string | null;
  modelo: string | null;
  fabricante: string | null;
  paisFabricacion: string | null;
  anioFabricacion: string | null;
  garantiaMeses: number | null;
  /** true = una persona confirmó marca/modelo; false/undefined = todavía es lo que se leyó de la
   *  ficha del proveedor, sin revisar. Decide si el dato se imprime tal cual o con un aviso. */
  confirmado?: boolean;
  /** Foto del producto, como data: URI — sacada de la ficha del proveedor (ver
   *  ficha-imagen-extraer.ts) o subida a mano. null/undefined = todavía no hay foto. */
  imagenDataUri?: string | null;
  /** true = una persona confirmó que ESTA foto corresponde al producto (o la subió ella misma).
   *  Independiente de `confirmado` (migración 81): probado contra fichas reales, la extracción
   *  automática a veces trae la imagen equivocada, así que confirmar el texto no confirma la
   *  foto y viceversa. */
  imagenConfirmada?: boolean;
  especificaciones: EspecificacionFicha[];
  cantidad: number | null;
  unidad: string | null;
}

export interface LineaFicha {
  linea: number | null;
  /** Título de la línea de la licitación — se usa como trazabilidad ("Línea 1") y, cuando la línea
   *  trae un solo producto, como nombre de su ficha. */
  titulo: string;
  productos: ProductoFicha[];
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
 *
 * NO se imprime en la ficha que se presenta (ver el formato Tecnomaq arriba: ahí va lo que se
 * OFERTA, no lo que se pidió). Se mantiene porque es la única definición del proyecto de cómo se
 * lee un requisito PISO/TECHO/EXACTO/RANGO, y la usa quien necesite mostrar la exigencia —
 * incluidos los tests que fijan ese comportamiento.
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
  return lineas.reduce((n, l) =>
    n + l.productos.reduce((m, p) => m + p.especificaciones.filter(e => !textoOfertado(e)).length, 0), 0);
}

/** Todos los productos del documento, en orden, con la línea a la que pertenece cada uno. */
function productosEnOrden(lineas: LineaFicha[]): Array<{ linea: LineaFicha; producto: ProductoFicha }> {
  return lineas.flatMap(linea => linea.productos.map(producto => ({ linea, producto })));
}

/**
 * Foto del producto — centrada bajo el título, como en la ficha de proveedor que originó el
 * formato (Tecnomaq).
 *
 * OJO, VERIFICADO CON FICHAS REALES (27-ago-2026): la extracción automática (ver
 * ficha-imagen-extraer.ts) elige "la imagen más grande de la página", y eso a veces NO es la foto
 * del producto — en una prueba contra 15 fichas de proveedor ya cargadas, 2 de 4 casos revisados
 * a mano trajeron una textura decorativa de marketing o una franja de logos de certificación en
 * vez del equipo. Por eso, mientras nadie la haya confirmado, se imprime con un aviso en vez del
 * pie neutro "Imagen referencial": no se oculta lo que leyó la máquina, pero tampoco se presenta
 * como si fuera definitivo.
 */
export function imagenProducto(p: ProductoFicha | null | undefined): string {
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
 * "Información de la oferta" — fabricante/país/año/garantía. Es lo que piden los formularios
 * técnicos del organismo (ver project_formulario_n3_matriz_cumplimiento_ago2026). Marca y modelo
 * NO van acá: ya son el subtítulo de la ficha, y repetirlos sería ruido.
 *
 * Si NO hay ningún dato, no se imprime la sección — no tiene sentido mostrar filas vacías cuando
 * nadie subió todavía la ficha del proveedor. Si hay algún dato pero no está confirmado por una
 * persona, se avisa: presentar sin revisar lo que leyó una máquina es un riesgo.
 */
function seccionInformacionOferta(p: ProductoFicha): string {
  const filas = ([
    ['Fabricante', p.fabricante],
    ['País de fabricación', p.paisFabricacion],
    ['Año de fabricación', p.anioFabricacion],
    ['Garantía técnica', p.garantiaMeses != null ? `${p.garantiaMeses} meses` : null],
  ] as Array<[string, string | null]>).filter(([, v]) => v && String(v).trim());
  if (!filas.length) return '';
  return `<h3 class="sec">Información de la oferta</h3>
    <table class="specs">
      <tbody>${filas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody>
    </table>`;
}

/**
 * UNA ficha, la de un producto: número, nombre, marca/modelo, foto, especificaciones.
 *
 * La tabla de especificaciones es de DOS columnas —característica | lo que ofertamos—, como la
 * ficha de proveedor que se tomó de modelo. Lo EXIGIDO por las bases no se imprime acá: este es el
 * documento que se presenta (declara lo que ofrecemos), no la planilla de auditoría — esa vive en
 * el modal del Auditor Técnico, con las dos columnas enfrentadas.
 */
function fichaDeProducto(p: ProductoFicha, linea: LineaFicha, numero: number): string {
  const marcaModelo = [p.marca, p.modelo].filter(Boolean).join(' ');
  const cantidad = [
    p.cantidad != null ? `Cantidad: ${num(p.cantidad)}` : '',
    p.unidad || '',
  ].filter(Boolean).join(' ');

  const filas = p.especificaciones.map(e => {
    const ofertado = textoOfertado(e);
    return `<tr>
      <th>${esc(e.descripcion)}</th>
      <td class="${ofertado ? '' : 'vacia'}">${ofertado ? esc(ofertado) : ''}</td>
    </tr>`;
  }).join('');

  return `<section class="ficha">
    <p class="ficha-num">${linea.linea != null ? `Línea ${linea.linea} · ` : ''}Ficha técnica ${String(numero).padStart(2, '0')}</p>
    <h2 class="prod-nombre">${esc(p.nombre)}</h2>
    ${marcaModelo ? `<p class="prod-modelo">${esc(marcaModelo)}</p>` : ''}
    ${cantidad ? `<p class="prod-cant">${esc(cantidad)}</p>` : ''}
    ${p.confirmado === false && marcaModelo
      ? '<p class="sin-confirmar">⚠ Marca/modelo leídos automáticamente de la ficha del proveedor — revisar antes de presentar.</p>'
      : ''}
    ${imagenProducto(p)}
    <h3 class="sec">Especificaciones técnicas</h3>
    ${p.especificaciones.length === 0
      ? '<p class="sin">Sin especificaciones técnicas registradas para este producto.</p>'
      : `<table class="specs"><tbody>${filas}</tbody></table>`}
    ${seccionInformacionOferta(p)}
  </section>`;
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

  const fichas = productosEnOrden(d.lineas)
    .map(({ linea, producto }, i) => fichaDeProducto(producto, linea, i + 1))
    .join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
<title>Ficha Técnica — ${esc(d.licitacionCodigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #18181b;
         font-size: 10.5px; line-height: 1.45; margin: 0; }
  header { display: flex; align-items: flex-start; gap: 14px; border-bottom: 2px solid #0f766e;
           padding-bottom: 10px; margin-bottom: 12px; }
  header .logo { max-height: 56px; max-width: 190px; object-fit: contain; }
  header .tit { flex: 1; }
  header h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .2px; }
  header .sub { color: #52525b; font-size: 10px; margin: 0; }
  header .cod { color: #0f766e; font-weight: 700; font-size: 10px; margin: 3px 0 0; }
  table.kv { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
  table.kv th { text-align: left; width: 110px; color: #52525b; font-weight: 600;
                padding: 3px 8px 3px 0; vertical-align: top; font-size: 10px; }
  table.kv td { padding: 3px 0; }

  /* ── UNA FICHA POR PRODUCTO, cada una en su propia página (formato Tecnomaq) ──────────────
     La primera comparte página con el encabezado y los datos de la empresa; el resto arranca
     en página nueva, para que ningún producto quede partido entre dos hojas. */
  section.ficha { page-break-inside: avoid; }
  section.ficha + section.ficha { page-break-before: always; padding-top: 4px; }
  .ficha-num { margin: 0 0 2px; font-size: 9.5px; font-weight: 700; color: #71717a;
               text-transform: uppercase; letter-spacing: .6px;
               border-bottom: 2px solid #0f766e; padding-bottom: 5px; }
  .prod-nombre { font-size: 15.5px; font-weight: 800; margin: 9px 0 1px; line-height: 1.25;
                 text-transform: uppercase; letter-spacing: .1px; }
  .prod-modelo { font-size: 12px; font-weight: 800; color: #0f766e; margin: 0;
                 text-transform: uppercase; letter-spacing: .3px; }
  .prod-cant { margin: 3px 0 0; color: #71717a; font-size: 9.5px; }
  h3.sec { font-size: 11px; font-weight: 800; color: #0f766e; text-transform: uppercase;
           letter-spacing: .5px; margin: 14px 0 6px; }
  p.sin { margin: 0 0 5px; color: #a1a1aa; font-style: italic; }
  p.sin-confirmar { margin: 5px 0 0; color: #b45309; font-size: 9px; font-weight: 600; }

  /* Foto centrada + pie, igual que la ficha de proveedor que se tomó de modelo. */
  .foto-producto { text-align: center; margin: 12px 0 4px; page-break-inside: avoid; }
  .foto-producto img { max-height: 170px; max-width: 62%; object-fit: contain; }
  .foto-producto .foto-ref { margin: 5px 0 0; color: #a1a1aa; font-size: 8.5px; font-style: italic; }
  .foto-producto .foto-ref.sin-confirmar { color: #b45309; font-weight: 600; font-style: normal; }

  /* Especificaciones: DOS columnas (característica | lo ofertado), filas alternadas. */
  table.specs { border-collapse: collapse; width: 100%; }
  table.specs th, table.specs td { border: 1px solid #e4e4e7; padding: 5px 8px; vertical-align: top; }
  table.specs th { text-align: left; width: 42%; font-weight: 700; background: #fafafa; }
  table.specs tr:nth-child(even) th { background: #f4f4f5; }
  table.specs tr:nth-child(even) td { background: #fafafa; }
  /* Casilla sin dato: se imprime VACÍA y con fondo, para que se vea que falta completarla.
     Nunca se rellena con un valor plausible. */
  table.specs td.vacia { background: #fffbeb; }

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
           color: #a1a1aa; font-size: 8.5px; font-style: italic; }
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

${fichas}

${bloqueFirma}

<footer>
  Documento generado por LICITANK el ${esc(d.fechaTexto)}${d.generadoPor ? ` · ${esc(d.generadoPor)}` : ''}.
  Las fotografías son referenciales y no contractuales; corresponden al modelo ofertado o a una
  unidad equivalente. Las casillas de valor ofertado que aparezcan en blanco deben completarse
  antes de presentar.
</footer>
</body></html>`;
}
