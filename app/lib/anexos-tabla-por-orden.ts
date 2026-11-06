// app/lib/anexos-tabla-por-orden.ts
// LA TABLA DE OFERTA CON SOLO EL N.º DE ÍTEM, llenada desde el costeo POR ORDEN.
//
// Caso real 2013-22-LE26 (Universidad Arturo Prat), Anexo 6 «Carta oferta»: «ITEM | DESCRIPCIÓN |
// CANTIDAD | VALOR TOTAL NETO» con 7 filas numeradas 1-7 y todo lo demás en blanco, más el pie
// «TOTAL NETO / 19 % IVA / TOTAL IMPUESTO INCLUIDO / valor en palabras». Ninguna fila trae un
// nombre contra el cual cruzar el costeo, así que salía entera vacía.
//
// Regla del dueño (06-nov-2026): el ítem N del papel es la línea N del costeo; el nombre es el del
// costeo, la cantidad y el valor neto también. Misma idea que anexos-oferta-tecnica-tabla.ts.
//
// Salvaguardas — si alguna falla NO se escribe nada, queda en blanco para el equipo:
//   · la tabla no tiene columna de precio unitario (esa tiene su propio motor);
//   · las filas de datos son exactamente 1..N y N = cantidad de líneas del costeo;
//   · TODAS las casillas por llenar de TODAS las filas están vacías (si el organismo ya escribió algo
//     en una fila, esa tabla no se toca);
//   · todas las líneas del costeo traen cantidad.
//
// Módulo PURO (sin DB, sin red, sin IA).
import type { TablaCruda, CeldaTablaCruda } from '@/app/lib/anexos-detectar';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';
import { nombreDeProductoParaAnexo } from '@/app/lib/anexos-oferta-tecnica-tabla';
import { montoEnPalabras } from '@/app/lib/anexos-monto-oferta';

export interface RellenoPorOrden { paraId: string; indiceGlobal: number; valor: string; etiqueta: string; total?: 'neto' | 'bruto'; iva?: boolean }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const RE_COL_ITEM = /^(?:item|items|linea|lineas|n[°ºo.]?|nro\.?|numero)$/;
const RE_COL_DESC = /^(?:descripcion|detalle|producto|productos|bien|bienes|insumo|insumos|articulo|articulos)$/;
const RE_COL_CANT = /^cantidad(?:es)?$/;
const RE_COL_BRUTO = /total.*(?:iva\s*inclu|impuesto\s*inclu|con\s*iva|bruto)|(?:iva\s*inclu|con\s*iva|bruto).*total/;
const RE_COL_NETO = /total.*neto|neto.*total/;
const fmt = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);

const llenable = (c?: CeldaTablaCruda): c is CeldaTablaCruda =>
  !!c && c.indiceGlobal != null && !!c.ultimoParaId && c.texto.trim() === '';

export function resolverTablaPorOrden(tablas: TablaCruda[], items: ItemCosteoPrecio[]): RellenoPorOrden[] {
  const out: RellenoPorOrden[] = [];
  if (!items.length || items.some(it => !it.cantidad || it.cantidad <= 0 || !(it.precioUnitario > 0))) return out;
  for (const t of tablas) {
    if (t.filas.length < items.length + 1) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    if (header.some(h => esCandidatoDePrecioUnitario(`x — ${h}`))) continue;
    const hn = header.map(norm);
    const iItem = hn.findIndex(h => RE_COL_ITEM.test(h));
    const iDesc = hn.findIndex(h => RE_COL_DESC.test(h));
    const iCant = hn.findIndex(h => RE_COL_CANT.test(h));
    const iBruto = hn.findIndex(h => RE_COL_BRUTO.test(h));
    const iNeto = hn.findIndex(h => RE_COL_NETO.test(h) && !RE_COL_BRUTO.test(h));
    if (iItem < 0 || iNeto < 0) continue;

    // Filas de datos: las que empiezan con un número, desde la fila 1, hasta que deje de serlo.
    const datos: CeldaTablaCruda[][] = [];
    for (const f of t.filas.slice(1)) {
      if (!/^\d{1,3}$/.test(f.celdas[iItem]?.texto.trim() ?? '')) break;
      datos.push(f.celdas);
    }
    if (datos.length !== items.length) continue;
    if (!datos.every((c, i) => Number(c[iItem].texto.trim()) === i + 1)) continue;

    const columnas = [iDesc, iCant, iNeto, iBruto].filter(i => i >= 0);
    if (!datos.every(c => c.length === header.length && columnas.every(i => llenable(c[i])))) continue;

    const filas: RellenoPorOrden[] = [];
    let neto = 0;
    datos.forEach((c, i) => {
      const it = items[i];
      const netoLinea = Math.round(it.cantidad! * it.precioUnitario);
      neto += netoLinea;
      const rotulo = `${i + 1}`;
      const poner = (col: number, valor: string) => filas.push({ paraId: c[col].ultimoParaId!, indiceGlobal: c[col].indiceGlobal!, valor, etiqueta: `${rotulo} — ${header[col]}` });
      if (iDesc >= 0) poner(iDesc, nombreDeProductoParaAnexo(it.descripcion));
      if (iCant >= 0) poner(iCant, fmt(it.cantidad!));
      poner(iNeto, fmt(netoLinea));
    });

    // Pie: filas que siguen a las de datos.
    const resto = t.filas.slice(1 + datos.length);
    let pct = 19;
    for (const f of resto) {
      const m = norm(f.celdas.map(c => c.texto).join(' ')).match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
      if (m) { pct = Number(m[1].replace(',', '.')); break; }
    }
    const iva = Math.round(neto * pct / 100);
    const bruto = neto + iva;
    // Si hay columna con IVA por línea, se calcula con el mismo porcentaje del documento.
    if (iBruto >= 0) {
      datos.forEach((c, i) => {
        const brutoLinea = Math.round(items[i].cantidad! * items[i].precioUnitario) * (100 + pct) / 100;
        filas.push({ paraId: c[iBruto].ultimoParaId!, indiceGlobal: c[iBruto].indiceGlobal!, valor: fmt(Math.round(brutoLinea)), etiqueta: `${i + 1} — ${header[iBruto]}` });
      });
    }
    const celdaDelPie = (celdas: CeldaTablaCruda[]): CeldaTablaCruda | null => {
      if (celdas.length === header.length && llenable(celdas[iNeto])) return celdas[iNeto];
      for (let i = celdas.length - 1; i >= 0; i--) if (llenable(celdas[i])) return celdas[i];
      return null;
    };
    let pendientePalabras = false;
    for (const f of resto) {
      const rotulo = norm(f.celdas.map(c => c.texto).filter(Boolean).join(' '));
      if (pendientePalabras) {
        pendientePalabras = false;
        const palabras = montoEnPalabras(bruto);
        const c = f.celdas.length === 1 && llenable(f.celdas[0]) ? f.celdas[0] : null;
        if (c && palabras) filas.push({ paraId: c.ultimoParaId!, indiceGlobal: c.indiceGlobal!, valor: palabras, etiqueta: 'Valor de la oferta en palabras' });
        continue;
      }
      if (/en (?:palabras|letras)/.test(rotulo)) { pendientePalabras = true; continue; }
      const c = celdaDelPie(f.celdas);
      if (!c || !rotulo) continue;
      const poner = (valor: number, extra: Partial<RellenoPorOrden>) =>
        filas.push({ paraId: c.ultimoParaId!, indiceGlobal: c.indiceGlobal!, valor: fmt(valor), etiqueta: f.celdas.map(x => x.texto).filter(Boolean).join(' ').slice(0, 80), ...extra });
      if (/inclu|con iva|bruto/.test(rotulo) && /total/.test(rotulo)) poner(bruto, { total: 'bruto' });
      else if (/^(?:valor )?total,? neto$|^neto$/.test(rotulo)) poner(neto, { total: 'neto' });
      else if (/\b(?:iva|impuesto)\b/.test(rotulo) && !/total/.test(rotulo)) poner(iva, { iva: true });
    }
    out.push(...filas);
  }
  return out;
}
