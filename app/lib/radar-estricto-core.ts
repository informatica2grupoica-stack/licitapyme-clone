// app/lib/radar-estricto-core.ts — Filtro de ruido del radar de las EMPRESAS-CLIENTE (PURO, sin base de datos).
//
// El emparejador común (text-match.ts) acepta una palabra de varios términos aunque cada término esté en un lugar distinto: «disco» en
// un ítem y «corte» en otro. En la prueba real con una ferretería eso traía insumos quirúrgicos y reactivos (2026-11-27). Estas dos
// reglas se aplican DESPUÉS de que el emparejador común dijo que sí, y solo a empresas-cliente: el radar de Grupo ICA no cambia.
//   1. Los términos no se pueden armar juntando PRODUCTOS DISTINTOS: tienen que salir de un mismo producto (con su categoría y el
//      título de la compra) o de una misma frase de la descripción.
//   2. Si la empresa no vende nada de salud, no cuentan los productos que Mercado Público clasifica como médicos o de laboratorio.
// Una palabra completa en el TÍTULO pasa siempre. Ante la duda se deja pasar: esconder una oportunidad es peor que mostrar una de más.
import { indexarLicitacion, evaluarKeyword, normalizar } from '@/app/lib/text-match';

export interface LicitacionParaFiltro {
  Nombre?: string; Descripcion?: string;
  Items?: Array<{ NombreProducto?: string; Descripcion?: string; Categoria?: string }>;
}

const CATEGORIA_SALUD = /^(equipamiento y suministros medicos|medicamentos|equipamiento para laboratorios)/;
const PALABRA_SALUD = /medic|quirurg|clinic|hospital|dental|odontolog|farmac|laboratori|enfermer|salud|ortoped|cateter|dialisis|anestes|reactivo|cirug|desfibrila|camilla|silla de rueda|anatomic|auxilio|rehabilita|kinesi/;

/** ¿La empresa vende cosas de salud? Basta con que alguna de sus palabras clave lo diga. */
export function vendeSalud(palabras: string[]): boolean {
  return palabras.some(p => PALABRA_SALUD.test(normalizar(p)));
}

const esDeSalud = (categoria: string | undefined) => CATEGORIA_SALUD.test(normalizar(categoria || ''));
const calza = (texto: string, keyword: string) => !!texto.trim() && evaluarKeyword(indexarLicitacion({ nombre: texto }), keyword).match;

export function pasaFiltroDeRuido(lic: LicitacionParaFiltro, keyword: string, empresaDeSalud: boolean): boolean {
  const items = lic.Items ?? [];
  const titulo = lic.Nombre || '';
  if (calza(titulo, keyword)) return true;
  // Una compra donde TODO es médico no le sirve a quien no vende salud.
  if (!empresaDeSalud && items.length > 0 && items.every(i => esDeSalud(i.Categoria))) return false;
  if ((lic.Descripcion || '').split(/[\n\r.;]+/).some(frase => calza(frase, keyword))) return true;
  return items.some(i => (empresaDeSalud || !esDeSalud(i.Categoria))
    && calza(`${titulo} ${i.NombreProducto || ''} ${i.Descripcion || ''} ${i.Categoria || ''}`, keyword));
}

const CLIENTE_ICA = 1;

/** Para un barrido: recibe TODAS las palabras positivas y dice si una coincidencia ya aceptada se deja. Grupo ICA siempre sí. */
export function filtroPorEmpresa(positivas: Array<{ cliente_id: number; keyword: string }>) {
  const porEmpresa = new Map<number, string[]>();
  for (const k of positivas) { const l = porEmpresa.get(k.cliente_id); if (l) l.push(k.keyword); else porEmpresa.set(k.cliente_id, [k.keyword]); }
  const salud = new Map([...porEmpresa].map(([id, palabras]) => [id, vendeSalud(palabras)]));
  return (kw: { cliente_id: number; keyword: string }, lic: LicitacionParaFiltro): boolean =>
    kw.cliente_id === CLIENTE_ICA || pasaFiltroDeRuido(lic, kw.keyword, salud.get(kw.cliente_id) ?? false);
}
