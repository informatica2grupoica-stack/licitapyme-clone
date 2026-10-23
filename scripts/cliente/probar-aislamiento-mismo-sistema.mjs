// Prueba de punta a punta del MISMO sistema con varias empresas (multi-cliente), contra un servidor LOCAL apuntando al ESPEJO.
//
//   1) levantar el servidor de pruebas (NO usar el .env.local de producción):
//        DB_HOST=127.0.0.1 DB_PORT=3308 DB_USER=licitank DB_PASSWORD=licitank_local DB_NAME=licitank_dev npx next dev -p 3100
//   2) node scripts/cliente/probar-aislamiento-mismo-sistema.mjs [http://localhost:3100]
//
// Siembra 3 empresas: Grupo ICA (1, ya existe) y dos clientes de prueba (Radar+Negocios, 1 usuario admin cada uno), todo repetible.
// Verifica: login por email en el MISMO /login, módulos bloqueados (UI y servidor), y que ninguna empresa ve ni toca datos de otra.
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const BASE = process.argv[2] || 'http://localhost:3100';
const PASS = 'Prueba-Multi-1';
const db = await mysql.createConnection({ host: '127.0.0.1', port: 3308, user: 'licitank', password: 'licitank_local', database: 'licitank_dev', multipleStatements: true });
const [[{ dbn }]] = await db.query('SELECT DATABASE() AS dbn');
if (dbn !== 'licitank_dev') { console.error('Solo corre contra el espejo licitank_dev.'); process.exit(1); }

let fallos = 0, total = 0;
const ok = (cond, texto) => { total++; if (cond) console.log(`  ✓ ${texto}`); else { fallos++; console.log(`  ✗ ${texto}`); } };
const seccion = (t) => console.log(`\n${t}`);

// ── Siembra repetible ────────────────────────────────────────────────────────────────────────────
const CODIGOS = ['TEST-001-LE26', 'TEST-002-LE26', 'TEST-003-LP26', 'TEST-005-LE26', 'TEST-006-LE26', 'TEST-007-LE26'];
const EMAILS = ['ica.prueba@local.test', 'a1.prueba@local.test', 'b1.prueba@local.test'];

async function limpiar() {
  const [us] = await db.query('SELECT id FROM usuarios WHERE email IN (?)', [EMAILS]);
  const uids = us.map(u => u.id);
  const [cs] = await db.query("SELECT id FROM clientes WHERE nombre IN ('Prueba A SpA', 'Prueba B Ltda')");
  const cids = cs.map(c => c.id);
  if (cids.length) {
    for (const t of ['alertas_licitaciones', 'palabras_clave', 'negocios', 'etiquetas', 'licitaciones_descartadas', 'comentarios_licitacion', 'historial_eventos', 'actividad_usuario', 'puente_radar', 'favoritos', 'empresas'])
      await db.query(`DELETE FROM ${t} WHERE cliente_id IN (?)`, [cids]).catch(() => {});
    await db.query('DELETE FROM documentos_cache WHERE licitacion_codigo LIKE ?', ['c%:TEST-%']).catch(() => {});
  }
  if (uids.length) {
    for (const t of ['alertas_licitaciones', 'palabras_clave', 'negocios', 'historial_eventos', 'actividad_usuario', 'comentarios_licitacion'])
      await db.query(`DELETE FROM ${t} WHERE ${t === 'comentarios_licitacion' || t === 'actividad_usuario' || t === 'historial_eventos' ? 'usuario_id' : t === 'negocios' ? 'asignado_a' : 'usuario_id'} IN (?)`, [uids]).catch(() => {});
    await db.query('DELETE FROM login_intentos').catch(() => {});
    await db.query('DELETE FROM usuarios WHERE id IN (?)', [uids]);
  }
  if (cids.length) await db.query('DELETE FROM clientes WHERE id IN (?)', [cids]);
  await db.query("DELETE FROM documentos_cache WHERE documento_nombre LIKE 'prueba-multi-%'").catch(() => {});
}
await limpiar();

const hash = await bcrypt.hash(PASS, 10);
const modulosBase = JSON.stringify(['radar', 'negocios']);
const [rA] = await db.query("INSERT INTO clientes (nombre, plan, max_usuarios, estado, modulos, activo) VALUES ('Prueba A SpA', 'BASE', 1, 'ACTIVO', ?, 1)", [modulosBase]);
const [rB] = await db.query("INSERT INTO clientes (nombre, plan, max_usuarios, estado, modulos, activo) VALUES ('Prueba B Ltda', 'BASE', 1, 'ACTIVO', ?, 1)", [modulosBase]);
const CA = rA.insertId, CB = rB.insertId;
const permCliente = JSON.stringify({ acceso_radar: true, ver_otros_negocios: true, exportar: true, repartir_puente: true, costeo_editor: true, compras: true, aprobar_comercial: true });
const mkUser = async (email, nombre, cliente, rol, permisos) => (await db.query(
  'INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo, cliente_id, permisos) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  [email, hash, nombre, nombre, rol, cliente, permisos]))[0].insertId;
const uICA = await mkUser(EMAILS[0], 'Admin ICA Prueba', 1, 'admin', null);
await db.query('UPDATE usuarios SET es_superadmin = 1 WHERE id = ?', [uICA]);
const uA = await mkUser(EMAILS[1], 'Admin A', CA, 'admin', permCliente);
const uB = await mkUser(EMAILS[2], 'Admin B', CB, 'admin', permCliente);

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { status: res.status, cookie, cuerpo: await res.json().catch(() => ({})) };
}
async function api(cookie, ruta, metodo = 'GET', cuerpo, extra = {}) {
  const res = await fetch(`${BASE}${ruta}`, { method: metodo, redirect: 'manual', headers: { cookie: cookie || '', 'content-type': 'application/json', ...extra }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  let datos = {}; try { datos = await res.json(); } catch { /* no es JSON */ }
  return { status: res.status, datos, location: res.headers.get('location') };
}

seccion('1. Mismo login para todos');
const lICA = await login(EMAILS[0]), lA = await login(EMAILS[1]), lB = await login(EMAILS[2]);
ok(lICA.status === 200 && lA.status === 200 && lB.status === 200, 'las 3 personas entran por el MISMO /api/auth/login con solo email y clave');
const meA = (await api(lA.cookie, '/api/auth/me')).datos.usuario;
const meICA = (await api(lICA.cookie, '/api/auth/me')).datos.usuario;
ok(meA?.clienteId === CA, 'la sesión de A sabe que es de su empresa');
ok(Array.isArray(meA?.modulos) && meA.modulos.includes('radar') && meA.modulos.includes('negocios') && !meA.modulos.includes('viabilidad'), 'A tiene Radar y Negocios, y NO Viabilidad');
ok(!meA?.permisos?.costeo_editor && !meA?.permisos?.compras && !meA?.permisos?.aprobar_comercial, 'los permisos de módulos no contratados quedan anulados aunque el usuario los tuviera');
ok(meA?.permisos?.acceso_radar === true && meA?.permisos?.ver_otros_negocios === true, 'los permisos de Radar y Negocios sí se conservan');
ok(meICA?.clienteId === 1 && meICA.modulos.includes('viabilidad') && meICA.modulos.includes('compras'), 'Grupo ICA conserva TODOS los módulos');

seccion('2. Módulos bloqueados en el servidor');
for (const [ruta, nombre] of [['/api/licitacion-viabilidad-ia/TEST-001-LE26', 'viabilidad IA'], ['/api/compras/dashboard', 'compras'], ['/api/anexos/analizar', 'anexos'], ['/api/admin/usuarios', 'admin global'], ['/api/negocios/1/auditor', 'auditor'], ['/api/chat-global', 'chat IA']]) {
  const r = await api(lA.cookie, ruta, ruta.includes('analizar') || ruta.includes('chat') ? 'POST' : 'GET', ruta.includes('analizar') || ruta.includes('chat') ? {} : undefined);
  ok(r.status === 403, `A no puede usar ${nombre} (HTTP ${r.status}${r.datos.code ? ' ' + r.datos.code : ''})`);
}
const pagina = await api(lA.cookie, '/compras');
ok(pagina.status >= 300 && pagina.status < 400 && /modulo-bloqueado/.test(pagina.location || ''), 'la página /compras redirige a «módulo no incluido» para A');
const adminICA = await api(lICA.cookie, '/api/admin/usuarios');
ok(adminICA.status !== 403 || adminICA.datos.code !== 'MODULO_BLOQUEADO', 'Grupo ICA NO queda bloqueado por módulos');

seccion('3. Palabras clave y radar: cada empresa solo lo suyo');
const pk = async (cookie, keyword, neg = false) => api(cookie, '/api/palabras-clave', 'POST', { keyword, es_negativa: neg });
ok((await pk(lA.cookie, 'mobiliario')).status === 200, 'A crea su palabra «mobiliario»');
ok((await pk(lB.cookie, 'computadores')).status === 200, 'B crea su palabra «computadores»');
ok((await pk(lB.cookie, 'escolar', true)).status === 200, 'B crea la palabra NEGATIVA «escolar»');
ok((await pk(lICA.cookie, 'electricos')).status === 200, 'ICA crea su palabra «electricos»');
ok((await pk(lA.cookie, 'computadores')).status === 200, 'A puede crear una palabra que B también tiene (no choca entre empresas)');
const kwA = (await api(lA.cookie, '/api/palabras-clave')).datos.keywords || [];
const kwB = (await api(lB.cookie, '/api/palabras-clave')).datos.keywords || [];
const kwI = (await api(lICA.cookie, '/api/palabras-clave')).datos.keywords || [];
ok(kwA.every(k => ['mobiliario', 'computadores'].includes(k.keyword)) && kwA.length === 2, 'A lista solo sus palabras');
ok(kwB.length === 2 && kwB.some(k => k.keyword === 'escolar'), 'B lista solo las suyas (incluye su negativa)');
ok(!kwI.some(k => ['mobiliario', 'computadores', 'escolar'].includes(k.keyword)), 'ICA no ve las palabras de los clientes');

// ICA: su alerta se siembra directo (su «Actualizar ahora» real corre el barrido global contra Mercado Público, que aquí no se prueba).
await db.query(`INSERT INTO alertas_licitaciones (usuario_id, cliente_id, palabra_clave_id, keyword_texto, licitacion_codigo, licitacion_nombre) VALUES (?, 1, ?, 'electricos', 'TEST-002-LE26', 'MATERIALES ELÉCTRICOS')`, [uICA, kwI.find(k => k.keyword === 'electricos')?.id ?? 0]);

const actA = await api(lA.cookie, '/api/radar/actualizar', 'POST');
const actB = await api(lB.cookie, '/api/radar/actualizar', 'POST');
ok(actA.status === 200 && actA.datos.local === true, '«Actualizar ahora» de A es LOCAL (no dispara el barrido global de Mercado Público)');
ok(actB.status === 200 && actB.datos.local === true, '«Actualizar ahora» de B es LOCAL');
const alA = (await api(lA.cookie, '/api/alertas')).datos.alertas || [];
const alB = (await api(lB.cookie, '/api/alertas')).datos.alertas || [];
const alI = (await api(lICA.cookie, '/api/alertas')).datos.alertas || [];
const cod = (l) => l.map(a => a.licitacion_codigo).sort();
console.log('     A:', cod(alA).join(','), '| B:', cod(alB).join(','), '| ICA:', cod(alI).join(','));
ok(alA.length > 0 && alA.every(a => /MOBILIARIO|COMPUTA/i.test(a.licitacion_nombre)), 'A recibe alertas de SUS palabras');
ok(alB.length > 0 && alB.every(a => /COMPUTA/i.test(a.licitacion_nombre)), 'B recibe alertas de «computadores»');
ok(!alB.some(a => /ESCOLAR/i.test(a.licitacion_nombre)), 'la negativa «escolar» de B excluye en B…');
ok(alA.some(a => /MOBILIARIO ESCOLAR/i.test(a.licitacion_nombre)), '…pero NO apaga las alertas «escolar» de A (las negativas no cruzan empresas)');
ok(cod(alI).join(',') === 'TEST-002-LE26', 'ICA ve solo lo suyo: ninguna alerta de A ni de B');
ok(alA.every(a => a.viabilidad_semaforo == null && a.prefiltro_decision == null), 'el radar de A no trae viabilidad ni prefiltro (módulo bloqueado)');

seccion('4. Negocios: asignar, y que la misma licitación en dos empresas no se pise');
const asigA = await api(lA.cookie, '/api/negocios', 'POST', { licitacion_codigo: 'TEST-001-LE26', asignado_a: uA, licitacion_nombre: 'MOBILIARIO ESCOLAR' });
const asigB = await api(lB.cookie, '/api/negocios', 'POST', { licitacion_codigo: 'TEST-001-LE26', asignado_a: uB, licitacion_nombre: 'MOBILIARIO ESCOLAR' });
ok(asigA.status === 200 && asigB.status === 200, 'A y B asignan la MISMA licitación a su propio perfil');
const [negs] = await db.query("SELECT id, cliente_id, asignado_a, activo FROM negocios WHERE licitacion_codigo = 'TEST-001-LE26' AND asignado_a IN (?)", [[uA, uB]]);
ok(negs.length === 2 && negs.every(n => n.activo === 1), 'quedan DOS negocios activos, uno por empresa (asignar a B no desactivó el de A)');
const negA = negs.find(n => n.cliente_id === CA), negB = negs.find(n => n.cliente_id === CB);
ok(!!negA && !!negB, 'cada negocio quedó con la empresa de quien lo asignó');
const listaA = (await api(lA.cookie, '/api/negocios')).datos.negocios || [];
ok(listaA.length === 1 && listaA[0].id === negA.id, 'A lista solo su negocio');
ok(((await api(lB.cookie, '/api/negocios')).datos.negocios || []).every(n => n.id === negB.id), 'B lista solo el suyo');
ok(((await api(lICA.cookie, '/api/negocios')).datos.negocios || []).length === 0, 'ICA no ve negocios de los clientes');
const cruzada = await api(lA.cookie, '/api/negocios', 'POST', { licitacion_codigo: 'TEST-005-LE26', asignado_a: uB });
ok(cruzada.status >= 400, 'A NO puede asignar una licitación a un usuario de B');
const [alertasTras] = await db.query("SELECT cliente_id, leida FROM alertas_licitaciones WHERE licitacion_codigo = 'TEST-001-LE26'");
ok(alertasTras.length > 0 && alertasTras.every(a => a.cliente_id === CA), 'las alertas de TEST-001 son solo de A (B la excluye por su negativa), y asignar no tocó otras empresas');

seccion('5. Intentos de entrar a datos ajenos por id/URL (IDOR)');
const idsPrueba = [
  [`/api/negocios/${negA.id}`, 'GET', undefined, 'ver el negocio de A'],
  [`/api/negocios/${negA.id}`, 'PATCH', { monto_ofertado: 1 }, 'modificar el negocio de A'],
  [`/api/negocios/${negA.id}`, 'DELETE', undefined, 'eliminar el negocio de A'],
  [`/api/negocios/${negA.id}/comentarios`, 'GET', undefined, 'leer comentarios del negocio de A'],
  [`/api/negocios/${negA.id}/comentarios`, 'POST', { comentario: 'intruso' }, 'comentar en el negocio de A'],
  [`/api/negocios/${negA.id}/recorrido`, 'GET', undefined, 'ver el recorrido del negocio de A'],
];
for (const [ruta, metodo, cuerpo, que] of idsPrueba) {
  const r = await api(lB.cookie, ruta, metodo, cuerpo);
  ok(r.status === 404, `B no puede ${que} (HTTP ${r.status})`);
}
const [[{ nIntruso }]] = await db.query('SELECT COUNT(*) AS nIntruso FROM comentarios_negocio WHERE negocio_id = ?', [negA.id]);
ok(Number(nIntruso) === 0, 'el comentario del intruso no quedó guardado');
const propioA = await api(lA.cookie, `/api/negocios/${negA.id}`);
ok(propioA.status === 200, 'A sí abre su propio negocio');
const reasig = await api(lA.cookie, `/api/negocios/${negA.id}`, 'PATCH', { asignado_a: uB });
ok(reasig.status === 400, 'A no puede reasignar su negocio a una persona de otra empresa');

seccion('6. Comentarios, empresas y usuarios');
await api(lA.cookie, '/api/licitacion-comentarios/TEST-001-LE26', 'POST', { comentario: 'comentario privado de A' });
const comB = (await api(lB.cookie, '/api/licitacion-comentarios/TEST-001-LE26')).datos.comentarios || [];
const comI = (await api(lICA.cookie, '/api/licitacion-comentarios/TEST-001-LE26')).datos.comentarios || [];
const comA = (await api(lA.cookie, '/api/licitacion-comentarios/TEST-001-LE26')).datos.comentarios || [];
ok(comA.some(c => /privado de A/.test(c.comentario)), 'A ve su comentario');
ok(!comB.some(c => /privado de A/.test(c.comentario)) && !comI.some(c => /privado de A/.test(c.comentario)), 'ni B ni ICA ven el comentario de A en la misma licitación');
const empA = await api(lA.cookie, '/api/empresas', 'POST', { razon_social: 'Empresa de A', rut: '76.111.111-1' });
ok(empA.status === 200, 'A crea la empresa con la que postula');
ok(((await api(lB.cookie, '/api/empresas')).datos.empresas || []).every(e => e.razon_social !== 'Empresa de A'), 'B no ve las empresas de A');
const usuA = (await api(lA.cookie, '/api/usuarios')).datos.usuarios || [];
ok(usuA.length === 1 && usuA[0].id === uA, 'la lista de usuarios de A son solo los de A');
const empPropiaA = (await db.query("SELECT id FROM empresas WHERE razon_social = 'Empresa de A'"))[0][0]?.id;
const empConB = await api(lB.cookie, `/api/negocios/${negB.id}`, 'PATCH', { empresa_id: empPropiaA });
ok(empConB.status === 400, 'B no puede postular con una empresa de A');
const dashA = await api(lA.cookie, '/api/dashboard');
ok(dashA.status === 200 && (dashA.datos.admin?.usuarios?.total ?? 0) === 1, 'el dashboard de A cuenta solo a sus usuarios');

seccion('7. Documentos: lo oficial se comparte, lo subido es privado');
await db.query("INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria, cliente_id) VALUES ('TEST-001-LE26', 'prueba-multi-bases.pdf', 'https://ejemplo.test/bases.pdf', 10, 'BASES', 0) ON DUPLICATE KEY UPDATE cliente_id = 0");
await db.query("INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria, cliente_id) VALUES ('TEST-001-LE26', 'prueba-multi-ica-propio.pdf', 'https://ejemplo.test/ica.pdf', 10, 'DOCUMENTOS_PROPIOS', 1) ON DUPLICATE KEY UPDATE cliente_id = 1");
const sube = await api(lA.cookie, '/api/documentos/guardar', 'POST', { licitacionCodigo: 'TEST-001-LE26', documentoNombre: 'prueba-multi-de-A.pdf', url: 'https://ejemplo.test/a.pdf', size: 5, categoria: 'DOCUMENTOS_PROPIOS' });
ok(sube.status === 200, 'A guarda un documento propio');
const nombres = (r) => (r.datos.documentos || []).map(d => d.documento_nombre);
const dA = nombres(await api(lA.cookie, '/api/documentos/cache/TEST-001-LE26'));
const dB = nombres(await api(lB.cookie, '/api/documentos/cache/TEST-001-LE26'));
const dI = nombres(await api(lICA.cookie, '/api/documentos/cache/TEST-001-LE26'));
console.log('     A:', dA.join(','), '| B:', dB.join(','), '| ICA:', dI.join(','));
ok(dA.includes('prueba-multi-bases.pdf') && dA.includes('prueba-multi-de-A.pdf'), 'A ve los oficiales y el suyo');
ok(dA.every(n => n !== 'prueba-multi-ica-propio.pdf'), 'A NO ve los documentos propios de Grupo ICA');
ok(dB.includes('prueba-multi-bases.pdf') && !dB.includes('prueba-multi-de-A.pdf') && !dB.includes('prueba-multi-ica-propio.pdf'), 'B ve solo los oficiales');
ok(dI.includes('prueba-multi-bases.pdf') && dI.includes('prueba-multi-ica-propio.pdf') && !dI.includes('prueba-multi-de-A.pdf'), 'ICA ve los oficiales y los suyos, y NO el documento de A');
const lote = await api(lB.cookie, '/api/documentos/cache/batch', 'POST', { codigos: ['TEST-001-LE26'] });
ok(!(lote.datos.docs?.['TEST-001-LE26'] || []).some(d => /de-A|ica-propio/.test(d.documento_nombre)), 'el listado por lote de B tampoco los trae');
const borrarAjeno = await api(lB.cookie, '/api/documentos/TEST-001-LE26', 'DELETE', { nombre: 'prueba-multi-de-A.pdf' });
ok(borrarAjeno.status === 404, 'B no puede borrar el documento de A');
const borrarOficial = await api(lA.cookie, '/api/documentos/TEST-001-LE26', 'DELETE', { nombre: 'prueba-multi-bases.pdf' });
ok(borrarOficial.status === 404, 'A no puede borrar un documento oficial compartido');

seccion('8. Historial y avisos no se cruzan');
const actAAct = (await db.query("SELECT COUNT(*) n FROM actividad_usuario WHERE cliente_id = ?", [CA]))[0][0].n;
ok(Number(actAAct) > 0, 'la actividad de A queda registrada con la empresa de A');
const [[{ nIca }]] = await db.query("SELECT COUNT(*) AS nIca FROM actividad_usuario WHERE cliente_id = 1 AND usuario_id IN (?)", [[uA, uB]]);
ok(Number(nIca) === 0, 'nada de A ni B quedó registrado como actividad de Grupo ICA');
const [[{ nEv }]] = await db.query("SELECT COUNT(*) AS nEv FROM historial_eventos WHERE cliente_id = 1 AND usuario_id IN (?)", [[uA, uB]]);
ok(Number(nEv) === 0, 'ningún aviso de A o B llegó a la campana de Grupo ICA');

seccion('9. Suspensión de una empresa');
await db.query("UPDATE clientes SET estado = 'SUSPENDIDO' WHERE id = ?", [CB]);
// La ficha del cliente se guarda 30 s en memoria (el panel del superusuario la refresca al instante al suspender): se espera a que venza.
console.log('     (esperando 6 s a que venza la caché de la ficha…)');
await new Promise(r => setTimeout(r, 6_000));
const suspendidoLogin = await login(EMAILS[2]);
ok(suspendidoLogin.status === 403, 'B suspendida: no puede iniciar sesión');
const suspendidoApi = await api(lB.cookie, '/api/alertas');
ok(suspendidoApi.status === 403 && suspendidoApi.datos.code === 'CLIENTE_NO_VIGENTE', 'B suspendida: su sesión abierta también se corta');
const icaSigue = await api(lICA.cookie, '/api/alertas');
ok(icaSigue.status === 200, 'suspender a B no afecta a Grupo ICA');
const aSigue = await api(lA.cookie, '/api/alertas');
ok(aSigue.status === 200, 'ni a la empresa A');
await db.query("UPDATE clientes SET estado = 'ACTIVO' WHERE id = ?", [CB]);

seccion('10. Panel del superusuario: activar un módulo');
const lista = await api(lICA.cookie, '/api/admin/clientes');
ok(lista.status === 200 && (lista.datos.clientes || []).some(c => c.id === CA), 'el superusuario ve las empresas-cliente');
ok((await api(lA.cookie, '/api/admin/clientes')).status === 403, 'el admin de una empresa-cliente NO entra al panel');
ok((await api(lA.cookie, '/api/admin/clientes', 'PATCH', { id: CA, modulos: ['radar', 'negocios', 'viabilidad'] })).status === 403, 'ni puede activarse módulos a sí mismo');
const antes = await api(lA.cookie, '/api/licitacion-viabilidad-ia/TEST-001-LE26');
ok(antes.status === 403, 'antes de activar: la viabilidad está bloqueada para A');
const act = await api(lICA.cookie, '/api/admin/clientes', 'PATCH', { id: CA, modulos: ['radar', 'negocios', 'viabilidad'] });
ok(act.status === 200, 'el superusuario activa Viabilidad a A');
await new Promise(r => setTimeout(r, 6_000)); // la caché de la ficha dura hasta 5 s (proxy y rutas tienen cada una la suya)
const despues = await api(lA.cookie, '/api/licitacion-viabilidad-ia/TEST-001-LE26');
ok(despues.status !== 403, 'rige al instante: la viabilidad deja de estar bloqueada para A');
const meA2 = (await api(lA.cookie, '/api/auth/me')).datos.usuario;
ok(meA2?.modulos?.includes('viabilidad'), 'la sesión de A ya muestra Viabilidad desbloqueada');
const [[bit]] = await db.query("SELECT COUNT(*) n FROM clientes_bitacora WHERE cliente_id = ? AND accion = 'cambio'", [CA]);
ok(Number(bit.n) >= 1, 'quedó anotado en la bitácora');
const nueva = await api(lICA.cookie, '/api/admin/clientes', 'POST', { nombre: 'Prueba C', adminNombre: 'C', adminEmail: 'c1.prueba@local.test', clave: PASS });
ok(nueva.status === 200, 'el superusuario crea una empresa nueva con su admin');
const lC = await login('c1.prueba@local.test');
ok(lC.status === 200, 'la empresa nueva entra por el mismo login');
ok(((await api(lC.cookie, '/api/auth/me')).datos.usuario?.modulos || []).join() === 'radar,negocios', 'y parte solo con Radar y Negocios');
await db.query("DELETE FROM usuarios WHERE email = 'c1.prueba@local.test'");
await db.query("DELETE FROM clientes_bitacora WHERE cliente_id IN (SELECT id FROM clientes WHERE nombre = 'Prueba C')");
await db.query("DELETE FROM clientes WHERE nombre = 'Prueba C'");
await db.query('DELETE FROM clientes_bitacora WHERE cliente_id IN (?)', [[CA, CB]]);

await limpiar();
await db.end();
console.log(`\n${total - fallos}/${total} comprobaciones OK${fallos ? `  ·  ${fallos} FALLARON` : ''}\n`);
process.exit(fallos ? 1 : 0);
