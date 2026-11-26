// Cotización de venta de una empresa del grupo (por defecto Inversiones Claro ARZ SpA) a otra, con su logo, en el mismo formato
// de la OC. Datos de las empresas desde la tabla `empresas` (nada de datos escritos aquí).
// Uso (con el túnel SSH 3307 abierto, desde la raíz del repo):
//   npx tsx --env-file=.env.local scripts/cotizacion-claro.mts --desc "Vacuolavadora ... DB51" --cant 3 --neto 2000000 \
//     [--emisor 76.902.659-2] [--cliente 78.388.175-6] [--folio COT-2026-001] [--validez 30] [--out docs/cotizaciones/x.pdf]
// --neto es el precio UNITARIO neto (sin IVA). Solo lee la base; no escribe nada.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { generarPdfOc } from '../app/lib/compras-oc-pdf';
import { logoDeEmpresaPorRut } from '../app/lib/compras-oc-propia';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const desc = arg('desc'); const cant = Number(arg('cant', '1')); const neto = Number(arg('neto'));
if (!desc || !(neto > 0) || !(cant > 0)) { console.error('Faltan --desc, --cant o --neto'); process.exit(1); }
const rutEmisor = arg('emisor', '76.902.659-2')!, rutCliente = arg('cliente', '78.388.175-6')!;
const validez = Number(arg('validez', '30'));
const hoy = new Date().toISOString().slice(0, 10);
const folio = arg('folio', `COT-${hoy.slice(0, 4)}-${hoy.slice(5, 7)}${hoy.slice(8, 10)}`)!;

const c = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [[em]]: any = await c.query('SELECT * FROM empresas WHERE rut = ? LIMIT 1', [rutEmisor]);
const [[cl]]: any = await c.query('SELECT * FROM empresas WHERE rut = ? LIMIT 1', [rutCliente]);
await c.end();
if (!em || !cl) { console.error('Empresa no encontrada en `empresas`'); process.exit(1); }

const subtotal = neto * cant, iva = Math.round(subtotal * 0.19);
const doc = {
  folio, fecha: hoy, estado: null,
  emisor: { razonSocial: em.razon_social.toUpperCase(), rut: em.rut, giro: em.giro || '', direccion: em.direccion || '', telefono: em.telefono1 || '', email: em.email1 || '' },
  proveedor: { nombre: cl.razon_social, rut: cl.rut, giro: cl.giro, direccion: cl.direccion, comuna: null, telefono: cl.telefono1, email: cl.email1, contacto: null },
  fechaEntrega: null, direccionEnvioFactura: null, direccionDespacho: null, metodoDespacho: null, formaPago: null, centroCosto: null, referencia: null,
  items: [{ codigo: null, descripcion: desc, cantidad: cant, precio: neto, descuento: 0, subtotal, imagenUrl: null }],
  subtotal, descuentoPorcentaje: 0, descuento: 0, neto: subtotal, iva, total: subtotal + iva,
  condiciones: `Valores netos en pesos chilenos; el IVA (19%) se suma al facturar.\nValidez de la cotizacion: ${validez} dias corridos desde su fecha.`,
  generadoPor: null,
};
const logo = logoDeEmpresaPorRut(em.rut) ?? undefined;
const bytes = await generarPdfOc(doc, { logo, firma: null, titulo: 'COTIZACION', frase: 'Ponemos a su disposicion la siguiente cotizacion: ', rotuloPie: 'COTIZACION' });
const out = arg('out', `docs/cotizaciones/${folio}.pdf`)!;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);
console.log(out, `neto ${subtotal} iva ${iva} total ${subtotal + iva}`);
