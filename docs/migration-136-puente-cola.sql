-- migration-136: cola DURABLE de descarga + viabilidad de lo que entra al puente
--
-- POR QUÉ (2-oct-2026): la cola de `viabilidad-al-asignar.ts` vivía solo en memoria. Si se
-- reiniciaba el servidor, o la descarga fallaba, la licitación quedaba en el puente sin
-- documentos ni informe y nadie la retomaba (el cron mira solo `negocios`). Esta tabla guarda
-- cada licitación empujada con su estado e intentos, para que un job del scheduler la reintente
-- aunque se apague el PC o se cierre el navegador. Es independiente de si se asigna o no.
--
-- Idempotente.
CREATE TABLE IF NOT EXISTS puente_cola (
  licitacion_codigo VARCHAR(100) NOT NULL PRIMARY KEY,
  estado            VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | LISTO | EXCLUIDA | AGOTADA
  intentos          INT          NOT NULL DEFAULT 0,
  ultimo_error      VARCHAR(300)     NULL,
  proximo_intento   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_puente_cola_estado (estado, proximo_intento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
