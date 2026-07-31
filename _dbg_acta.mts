import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { obtenerFichaHTML, MP_UA, fetchMPConReintentos, combinarCookies, extraerCookies } from './app/lib/mp-adjuntos';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
const [rows]: any = await pool.query(
  `SELECT licitacion_codigo, url_acta FROM adjudicacion_cache WHERE url_acta IS NOT NULL AND url_acta <> '' LIMIT 3`);
await pool.end();
console.log('actas en cache:', rows.length);
if (!rows.length) { console.log('sin url_acta cacheada'); process.exit(0); }

const codigo = rows[0].licitacion_codigo;
const actaUrl = String(rows[0].url_acta).replace(/^http:/, 'https:');
console.log('usando', codigo, '\n', actaUrl.slice(0, 140));

const f = await obtenerFichaHTML(codigo);
let cookies = f.cookies;
async function get(u: string, ref = f.referer) {
  const res = await fetchMPConReintentos(u, { method: 'GET', headers: { 'User-Agent': MP_UA, Referer: ref, Cookie: cookies, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  cookies = combinarCookies(cookies, extraerCookies(res));
  return { status: res.status, html: res.ok ? await res.text() : '', url: res.url };
}
const dec = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const txt = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/gi, ' ').replace(/\s+/g, ' ').trim();

const r = await get(actaUrl);
console.log(`\n=== ACTA  HTTP${r.status} ${r.html.length}b  tr=${(r.html.match(/<tr[\s>]/gi) || []).length}`);
console.log('  title:', r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim());
console.log('  frames:', [...r.html.matchAll(/<(?:iframe|frame)[^>]+src=["']([^"']+)["']/gi)].map(m => m[1].split('?')[0]));
console.log('  parent.*.location:', [...dec(r.html).matchAll(/parent\.\w+\.location\s*=\s*'([^']+)'/g)].map(m => m[1].split('?')[0]));
console.log('  openPopUp:', [...new Set([...dec(r.html).matchAll(/openPopUp\('([^']+)'/g)].map(m => m[1].split('?')[0]))].slice(0, 10));
console.log('  .aspx:', [...new Set([...r.html.matchAll(/([A-Za-z0-9_]+\.aspx)/g)].map(m => m[1]))].slice(0, 15));
console.log('  ImageButtons:', [...new Set([...r.html.matchAll(/<input[^>]*type="image"[^>]*name="([^"]+)"[^>]*>/gi)].map(m => m[1]))].slice(0, 10));
console.log('  adjuntos?:', /adjunt|anexo|attachment/i.test(r.html));
console.log('\n  TEXTO:', txt(r.html).slice(0, 1800));
console.log('=== FILAS DWNL ===');
let i=0;
for (const tr of r.html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  if (!/DWNL\$grdId/.test(tr[1])) continue;
  const celdas = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;?/gi,' ').replace(/\s+/g,' ').trim());
  const ctl = tr[1].match(/name="(DWNL\$grdId\$ctl\d+\$\w+)"/)?.[1];
  console.log('  ' + JSON.stringify(celdas).slice(0,300) + '   ctl=' + ctl);
  if (++i >= 7) break;
}
console.log('=== encabezado tabla ===');
for (const tr of r.html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const c = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => x[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  if (c.some(x => /^Anexo$/i.test(x))) { console.log('  ' + JSON.stringify(c)); break; }
}
