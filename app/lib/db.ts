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
// LÍMITE DE CONEXIONES — consciente del entorno. Bluehost tope duro: max_user_connections=25
// (TODAS las conexiones del usuario DB sumando Vercel + notebook). Repartir con cuidado:
//   • Vercel (serverless): MUCHAS instancias efímeras, cada una crea su propio pool → si cada
//     una abriera 8, 4 instancias ya superan 25 y Bluehost rechaza. Se mantiene BAJO (3).
//   • Notebook (Docker, UN proceso de larga vida que sirve radar/negocios/IA a los usuarios):
//     un pool de 3 ahoga la concurrencia (con >3 consultas a la vez se encolan y se sienten
//     lentas). Al ser un único proceso, su consumo es predecible → puede usar un pool AMPLIO.
// Presupuesto: notebook 8 + Vercel (~4 instancias × 3 = 12) + margen ≈ 20 < 25. Ajustable con
// DB_POOL_LIMIT si cambia la topología.
const enVercel = !!process.env.VERCEL;
const connectionLimit = enVercel ? 3 : Number(process.env.DB_POOL_LIMIT || 8);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
  timezone: 'local',
  waitForConnections: true, // bajo ráfaga, ENCOLA (espera) en vez de fallar → mejor UX que un error duro
  connectionLimit,
  queueLimit: 24,           // cola generosa: preferimos que una ráfaga espere a que se rechace
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