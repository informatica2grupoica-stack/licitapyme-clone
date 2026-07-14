// Carga .env.local / .env al process.env (igual patrón que el resto de scripts).
import { readFileSync } from 'fs';
export function cargarEnv(): void {
  for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
    try {
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* ok */ }
  }
}
