import { ejecutarPareoGlobal } from '@/app/lib/compras-pareo-global';
const r = await ejecutarPareoGlobal(1356, undefined, true);
console.log(JSON.stringify(r, null, 1));
process.exit(0);
