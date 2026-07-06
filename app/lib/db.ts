// src/lib/db.ts
import mysql from 'mysql2/promise';

// En serverless (Vercel) cada función puede crear su propio pool.
// connectionLimit bajo evita "too many connections" en Bluehost (límite ~25).
//
// ZONA HORARIA (importante): timezone:'local' (default de mysql2) hace que los datetime se
// interpreten en la zona del PROCESO Node. Las fechas (licitacion_cierre, etc.) se guardan
// en hora de pared de Chile, así que el proceso DEBE correr en America/Santiago (TZ) o las
// fechas saldrán corridas. Ver app/lib/tz.ts. NO comparar fechas contra NOW() del servidor
// MySQL (corre en otra zona): usar ahoraChileSQL().
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
  timezone: 'local',
  waitForConnections: true,
  connectionLimit: 3,       // bajo para serverless
  queueLimit: 10,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Probar conexión
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conexión a Bluehost establecida');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Error de conexión a Bluehost:', error);
    return false;
  }
}

export default pool;