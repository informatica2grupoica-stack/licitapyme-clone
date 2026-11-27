const pool = ((await import('@/app/lib/db')) as any).default;
const [r] = await pool.query(`SELECT id, rol, nombre FROM usuarios WHERE rol IN ('SUPERADMIN','ADMIN','admin','superusuario') OR rol LIKE '%admin%' LIMIT 5`) as any; console.log(r);
process.exit(0);
