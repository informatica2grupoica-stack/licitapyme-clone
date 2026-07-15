// Prueba end-to-end del fix de reasignación (unique_negocio): PATCH /api/negocios/168 → usuario 7.
import { cargarEnv } from './regresion/_env';
cargarEnv();
import { SignJWT } from 'jose';

async function main() {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ userId: 1, email: 'informatica2.grupoica@gmail.com', nombre: 'Alexis Tobar', empresa: null, rol: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('600s').sign(secret);
  const res = await fetch('http://localhost:54449/api/negocios/168', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'licitapyme_session=' + token },
    body: JSON.stringify({ asignado_a: 7 }),
  });
  console.log('status:', res.status);
  console.log((await res.text()).slice(0, 500));
}
main().catch(e => { console.error(e); process.exit(1); });
