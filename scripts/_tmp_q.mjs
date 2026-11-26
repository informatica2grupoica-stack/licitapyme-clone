import mysql from 'mysql2/promise';
const p = await mysql.createPool({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const [t] = await p.query(`SHOW TABLES LIKE '%usuario%'`); console.log(t);
const [pr] = await p.query(`SELECT id,descripcion,subestado FROM compras_producto WHERE negocio_id=1356 AND (descripcion LIKE '%AKS%' OR descripcion LIKE '%Tekna%')`); console.log(pr);
process.exit(0);
