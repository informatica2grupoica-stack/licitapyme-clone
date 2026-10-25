// app/lib/evaluar-empresa-rut.ts
// Evalúa una empresa-cliente NUEVA por su RUT con lo que realmente vendió en Mercado Público, y le sugiere
// palabras clave y perfil a la medida (para que su Radar y su viabilidad partan afinados desde el día 1).
//
// Cadena (todo API pública de MP, verificado con Comercial MP 78.388.175-6 → código 2105932):
//   1. BuscarProveedor: RUT → código interno de proveedor (los listados NO aceptan el RUT).
//   2. ordenesdecompra.json?fecha=D&CodigoProveedor=X día por día hacia atrás hasta juntar ~50 OC
//      (la API no tiene rango de fechas; una empresa chica tiene ~1 OC cada 4 días → ~200 llamadas).
//   3. Detalle de cada OC: ítems con producto ONU, categoría y especificación del proveedor, montos, comprador.
//   4. Acta de cada licitación de origen: las líneas adjudicadas a ESE RUT (lo que ganó compitiendo).
//   5. IA (Kimi): sugiere palabras clave (las mejores + todas las posibles por rubro), negativas y el perfil.
// Nada se aplica solo: el admin de la empresa lo elige al configurar su empresa la primera vez que entra (/mi-empresa).
// Va en serie con pausa (la API responde 10500 si se la aprieta); tarda minutos → se corre en segundo plano.
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { crearChatIA, iaTextoConfigurada, MODELO_TEXTO } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';

const OBJETIVO_OC = 50;
const MAX_DIAS = 300;
const PAUSA_MS = 1_200;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const GENERICAS = new Set(['sistema', 'sistemas', 'equipo', 'equipos', 'placa', 'carro', 'camara', 'cámara', 'monitor', 'mueble', 'muebles', 'herramientas',
  'adquisicion', 'adquisición', 'insumos', 'materiales', 'servicio', 'servicios', 'productos', 'articulos', 'artículos', 'implementos', 'accesorios', 'kit']);

/** "78388175-6" / "78.388.175-6" → "78.388.175-6" (el formato que acepta BuscarProveedor). */
export function formatearRut(rut: string): string {
  const s = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return '';
  const cuerpo = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${s.slice(-1)}`;
}

async function guardarEstado(clienteId: number, estado: string, progreso: string, resultado?: unknown) {
  await pool.query(
    `INSERT INTO cliente_evaluacion (cliente_id, estado, progreso, resultado) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE estado = VALUES(estado), progreso = VALUES(progreso), resultado = COALESCE(VALUES(resultado), resultado)`,
    [clienteId, estado, progreso.slice(0, 500), resultado === undefined ? null : JSON.stringify(resultado)]);
}

export async function leerEvaluacion(clienteId: number) {
  const [rows] = await pool.query('SELECT estado, progreso, resultado, updated_at, aplicado_at FROM cliente_evaluacion WHERE cliente_id = ?', [clienteId]);
  const r = (rows as any[])[0];
  if (!r) return null;
  return { ...r, resultado: typeof r.resultado === 'string' ? JSON.parse(r.resultado) : r.resultado };
}

interface Linea { producto: string; categoria: string; detalle: string; monto: number; origen: 'OC' | 'ACTA' }

/** Corre la evaluación completa y aplica lo propuesto a la empresa. No lanza: deja el error en cliente_evaluacion. */
export async function evaluarEmpresaPorRut(clienteId: number, rutCrudo: string): Promise<void> {
  const rut = formatearRut(rutCrudo);
  try {
    if (!rut) throw new Error('RUT no válido');
    const mp = getMercadoPublicoClient();
    await guardarEstado(clienteId, 'EN_CURSO', 'Buscando la empresa en Mercado Público…');
    const prov = await mp.buscarProveedorPorRut(rut);
    if (!prov) throw new Error(`Mercado Público no tiene un proveedor con RUT ${rut}`);

    // 2. Barrido de OC hacia atrás.
    const codigosOC: string[] = [];
    let dias = 0;
    for (; dias < MAX_DIAS && codigosOC.length < OBJETIVO_OC; dias++) {
      const f = new Date(); f.setDate(f.getDate() - dias);
      try {
        for (const oc of await mp.listarOrdenesCompraPorProveedor(prov.codigo, f))
          if (oc.Codigo && !codigosOC.includes(oc.Codigo)) codigosOC.push(oc.Codigo);
      } catch { /* día que falló: se sigue, no vale la pena frenar por uno */ }
      if (dias % 10 === 0) await guardarEstado(clienteId, 'EN_CURSO', `Revisando órdenes de compra: ${dias} días, ${codigosOC.length} encontradas`);
      await dormir(PAUSA_MS);
    }
    if (!codigosOC.length) throw new Error(`Sin órdenes de compra en los últimos ${dias} días`);

    // 3. Detalle de cada OC.
    const lineas: Linea[] = [];
    const licitaciones = new Set<string>();
    const compradores = new Map<string, number>(), regiones = new Map<string, number>();
    const totales: number[] = [];
    for (const [i, cod] of codigosOC.entries()) {
      if (i % 5 === 0) await guardarEstado(clienteId, 'EN_CURSO', `Leyendo órdenes de compra: ${i}/${codigosOC.length}`);
      const oc: any = await mp.obtenerOrdenCompra(cod);
      await dormir(PAUSA_MS);
      if (!oc) continue;
      if (Number(oc.Total) > 0) totales.push(Number(oc.Total));
      if (oc.CodigoLicitacion) licitaciones.add(String(oc.CodigoLicitacion));
      const org = oc.Comprador?.NombreOrganismo; if (org) compradores.set(org, (compradores.get(org) || 0) + 1);
      const reg = oc.Comprador?.RegionUnidad; if (reg) regiones.set(reg, (regiones.get(reg) || 0) + 1);
      for (const it of oc.Items?.Listado || [])
        lineas.push({ producto: String(it.Producto || ''), categoria: String(it.Categoria || ''), detalle: String(it.EspecificacionProveedor || it.EspecificacionComprador || '').slice(0, 160), monto: Number(it.Total) || 0, origen: 'OC' });
    }

    // 4. Actas: líneas adjudicadas a este RUT en cada licitación de origen.
    const rutPlano = rut.replace(/\./g, '').toUpperCase();
    let actas = 0;
    for (const [i, cod] of [...licitaciones].entries()) {
      if (i % 5 === 0) await guardarEstado(clienteId, 'EN_CURSO', `Leyendo actas de adjudicación: ${i}/${licitaciones.size}`);
      const lic = await mp.obtenerPorCodigo(cod);
      await dormir(PAUSA_MS);
      if (!lic) continue;
      const ganadas = (lic.Items || []).filter(it => String(it.RutProveedorAdjudicado || '').replace(/\./g, '').toUpperCase() === rutPlano);
      if (ganadas.length) actas++;
      for (const it of ganadas)
        lineas.push({ producto: it.NombreProducto, categoria: String(it.Categoria || ''), detalle: String(it.Descripcion || '').slice(0, 160), monto: (it.MontoUnitario || 0) * (it.CantidadAdjudicada || it.Cantidad || 1), origen: 'ACTA' });
    }

    // 5. IA (Kimi): sugerencias para que el admin de la empresa elija al configurar su empresa. NO se aplica nada aquí.
    await guardarEstado(clienteId, 'EN_CURSO', `Analizando ${lineas.length} líneas vendidas con IA…`);
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);
    totales.sort((a, b) => a - b);
    const lista = lineas.slice(0, 400).map(l => `- [${l.origen}] ${l.producto} | ${l.categoria.split(' / ').slice(-1)[0]} | ${l.detalle}`).join('\n');
    const propuesta = await proponerConIA(prov.nombre, lista, top(compradores, 10), top(regiones, 8));
    const p10 = totales[Math.floor(totales.length * 0.1)] ?? null, p90 = totales[Math.floor(totales.length * 0.9)] ?? null;
    const regionesTop = [...regiones.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.trim());

    await guardarEstado(clienteId, 'LISTO', `${codigosOC.length} OC en ${dias} días y ${actas} actas con líneas ganadas`, {
      rut, codigoProveedor: prov.codigo, nombreMP: prov.nombre, diasRevisados: dias, ordenes: codigosOC.length, licitaciones: licitaciones.size, actasConLineasGanadas: actas,
      lineas: lineas.length, montoTipico: { p10, p90 }, compradores: top(compradores, 10), regiones: top(regiones, 8), modelo: propuesta.modelo,
      sugeridas: propuesta.sugeridas, posibles: propuesta.posibles, negativas: propuesta.negativas, resumen: propuesta.resumen,
      perfil: { ...propuesta.perfil, monto_min: p10, monto_max: p90, regiones: regionesTop.join(', ') },
    });
  } catch (e) {
    console.error('[evaluar-empresa]', clienteId, String(e).slice(0, 300));
    await guardarEstado(clienteId, 'ERROR', String((e as Error)?.message || e)).catch(() => {});
  }
}

async function proponerConIA(nombre: string, lista: string, compradores: string[], regiones: string[]) {
  if (!iaTextoConfigurada()) throw new Error('La IA no está disponible');
  const sistema = 'Eres experto en compras públicas de Chile (Mercado Público). A partir de lo que una empresa YA vendió al Estado, le recomiendas ' +
    'las palabras clave con que su radar debe encontrar licitaciones nuevas y el perfil con que la IA juzgará si le conviene postular. Responde SOLO un objeto JSON.';
  const usuario =
`EMPRESA: ${nombre}
LO QUE VENDIÓ (órdenes de compra [OC] y líneas que ganó en actas de adjudicación [ACTA]; formato: producto | categoría ONU | especificación):
${lista}

Principales compradores: ${compradores.join('; ') || '—'}
Regiones de los compradores: ${regiones.join('; ') || '—'}

Devuelve: {"resumen":"2-3 frases: qué vende, a quién y qué se repite más","sugeridas":["..."],"posibles":[{"rubro":"...","palabras":["..."]}],"negativas":["..."],"perfil":{"descripcion":"2-3 frases de qué vende","rubros":"rubros separados por coma","productos_si":"productos/servicios que SÍ vende, separados por coma","productos_no":"lo que claramente NO vende y podría confundirse","reglas":"0-2 reglas útiles para decidir si postular, sacadas de los datos (p. ej. tipo de comprador); vacío si no hay"}}
Reglas de palabras: términos de 1 a 3 palabras, en minúscula y singular, como aparecen en los NOMBRES de licitaciones ("mobiliario escolar", "camilla", "horno"); ni marcas ni modelos; nada tan genérico que traiga de todo ("sistema", "equipos", "adquisición", "insumos", "placa", "carro").
- "sugeridas" (15 a 25): las MEJORES, de lo que más se repite y más vende; son las que recomiendas activar ya.
- "posibles" (40 a 80 en total, agrupadas por rubro): TODAS las razonables para ampliar el radar dentro de sus mismos rubros, incluidas sinónimos y productos vecinos que una empresa así también vende (p. ej. si vende hornos: "horno convector", "cocina industrial"). No repitas las sugeridas.
- "negativas" (5 a 15): términos que aparecerían junto a sus palabras pero son de otro rubro (p. ej. "arriendo", "mantención", "obra civil" si solo vende productos).
No inventes rubros que no estén en la lista.`;
  const resp: any = await conModuloIA('otros', async () => crearChatIA({
    model: MODELO_TEXTO, temperature: 0.3,
    messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
  }, { proveedorPreferido: 'kimi', timeoutMs: 240_000 }))();
  const txt = String(resp?.choices?.[0]?.message?.content ?? '').replace(/```json|```/gi, '');
  const raw = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const limpiar = (v: unknown, n: number) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 3 && x.length <= 60))].slice(0, n);
  // La IA igual cuela palabras sueltas que traen de todo (probado con Comercial MP: «sistema», «placa», «carro») y plurales repetidos.
  const filtrar = (l: string[]) => l.filter((k, _, todas) => !GENERICAS.has(k) && !(k.endsWith('s') && todas.includes(k.replace(/e?s$/, ''))));
  const sugeridas = filtrar(limpiar(raw.sugeridas, 25));
  const vistas = new Set(sugeridas);
  const posibles = (Array.isArray(raw.posibles) ? raw.posibles : []).slice(0, 12).map((g: any) => ({
    rubro: String(g?.rubro || 'Otros').trim(),
    palabras: filtrar(limpiar(g?.palabras, 30)).filter(k => !vistas.has(k) && (vistas.add(k), true)),
  })).filter((g: { palabras: string[] }) => g.palabras.length);
  const p = raw.perfil || {};
  return {
    modelo: String(resp?.model || ''), resumen: String(raw.resumen || ''), sugeridas, posibles, negativas: limpiar(raw.negativas, 15),
    perfil: { descripcion: String(p.descripcion || ''), rubros: String(p.rubros || ''), productos_si: String(p.productos_si || ''), productos_no: String(p.productos_no || ''), reglas: String(p.reglas || '') },
  };
}
