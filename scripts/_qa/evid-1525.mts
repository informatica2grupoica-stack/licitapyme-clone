// Solo lectura: lo que dice la factura de Electrocom sobre el fieltro.
const pool = ((await import('@/app/lib/db')) as any).default;
const [rows] = await pool.query(`SELECT folio, referencia, facturas_json FROM obuma_compras WHERE folio='4054' AND proveedor_rut LIKE '96%' LIMIT 2`) as any;
const barra = String.fromCharCode(92);
for (const r of rows) { console.log('OC', r.folio, r.referencia); console.log(String(r.facturas_json).slice(0, 1200).split(barra + '/').join('/')); }
const texto = rows.map((r: any) => String(r.facturas_json ?? '').split(barra + '/').join('/')).join(' ');
const urls = [...new Set(texto.split('"').filter((x: string) => x.startsWith('http') && x.toLowerCase().includes('xml')))] as string[];
console.log('enlaces xml:', urls.length);
for (const u of urls.slice(0, 4)) {
  const s: string = await fetch(u).then(x => x.arrayBuffer()).then(b => new TextDecoder('latin1').decode(b)).catch(e => 'ERR ' + e.message);
  const folio = s.split('<Folio>')[1]?.split('<')[0];
  const lineas = s.split('<Detalle>').slice(1).map(x => x.split('</Detalle>')[0]).filter(x => x.toLowerCase().includes('fieltro'));
  console.log('XML folio', folio, 'lineas fieltro', lineas.length); for (const l of lineas) console.log(l.split('\n').join(' '));
}
process.exit(0);
