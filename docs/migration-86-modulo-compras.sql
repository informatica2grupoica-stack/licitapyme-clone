-- migration-86-modulo-compras.sql
-- MÓDULO DE COMPRAS (spec "ESPECIFICACIÓN FUNCIONAL — MÓDULO DE COMPRAS v2.0", sep-2026) — Fase 1:
-- esqueleto de entrada. Cimiento de datos para §3 (disparador/asignación), §4 (resumen ejecutivo)
-- y §5 (modelo de tareas de Apertura/Validación/Administrativo). Las fases posteriores (Auditor de
-- Compras, SKU, logística, compuertas de aprobación, acta de entrega) suman migraciones propias.
--
-- POR QUÉ NO SE REUSA `entrega_proyecto`/`entrega_acuse` (migración 58): ese circuito ya resuelve
-- "quién debe acusar recibo de que ganamos" (Frente F.1). El Módulo de Compras es distinto: asigna
-- UN encargado que EJECUTA la compra (con SLA de 3h hábiles y fallback automático), y le abre un
-- motor de tareas con plazo propio. `construirResumenEjecutivo()` de entrega-proyecto.ts SÍ se
-- reusa tal cual como base del resumen — acá solo se le suman los campos propios de compras
-- (presupuesto, boleta/contrato exigidos, plazo de aceptación de OC, margen previsto).
--
-- TRES TABLAS:
--   · compras_asignacion    → una fila por negocio ganado que entra a Compras. Encargado, plazo de
--     asignación (3h hábiles con fallback), bandera de urgencia (Cadena de Urgencia §3.7/§15.3) y
--     el resumen ejecutivo extendido, CONGELADO al abrirse (mismo criterio que el paquete de
--     traspaso y que entrega_proyecto: es la foto de lo que se ganó, no una vista que se mueve sola;
--     ver docs/migration-55 y docs/migration-58).
--   · compras_tarea_catalogo → catálogo ENUNCIATIVO (spec §1.3.5: "todo catálogo es enunciativo,
--     nunca taxativo"). Vive en tabla, no en código, para que agregar/editar una tarea sea un UPDATE,
--     no un deploy.
--   · compras_tarea          → instancia por negocio. Sin estado "incumplida" (spec §5.1: "no puede
--     haber tarea que se registre como incumplida" — el reloj de entrega, no la tarea, es lo que
--     falla). `catalogo_clave` NULL = tarea manual (spec §5.1 "tareas manuales").
--
-- CHARSET: utf8mb4_general_ci a propósito — el de `negocios`/`usuarios`, para que los JOIN no
-- mueran con "Illegal mix of collations" (ver migration-24).
--
-- Aplicar con `node scripts/aplicar-migration-86.mjs` (o a mano en phpMyAdmin).
-- Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE del catálogo inicial.

CREATE TABLE IF NOT EXISTS compras_asignacion (
  negocio_id                  INT          NOT NULL PRIMARY KEY,
  licitacion_codigo           VARCHAR(64)  NOT NULL,
  ganado_at                   DATETIME     NOT NULL,           -- cuándo se confirmó que ganamos (acta MP)
  vencimiento_asignacion_at   DATETIME     NOT NULL,           -- ganado_at + 3h hábiles (§3.3)
  urgente                     TINYINT(1)   NOT NULL DEFAULT 0, -- Cadena de Urgencia (§3.7/§15.3)
  asignado_a                  INT              NULL,
  asignado_at                 DATETIME         NULL,
  asignado_por                INT              NULL,           -- NULL = asignación automática (fallback por carga)
  resumen_json                LONGTEXT     NOT NULL,           -- ResumenEjecutivoCompras (app/lib/compras.ts)
  resumen_generado_at         DATETIME     NOT NULL,
  created_at                  DATETIME     NOT NULL,
  INDEX idx_compras_asig_codigo (licitacion_codigo),
  INDEX idx_compras_asig_encargado (asignado_a),
  INDEX idx_compras_asig_pendiente (asignado_a, vencimiento_asignacion_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_tarea_catalogo (
  clave              VARCHAR(64)  NOT NULL PRIMARY KEY,
  categoria          VARCHAR(24)  NOT NULL,               -- VALIDACION | ADMINISTRATIVO
  titulo             VARCHAR(200) NOT NULL,
  descripcion        TEXT             NULL,
  responsable_regla  VARCHAR(24)  NOT NULL DEFAULT 'ENCARGADO',  -- ENCARGADO | JEFE_VENTAS | SISTEMA
  plazo_dias         INT              NULL,
  plazo_tipo         VARCHAR(12)  NOT NULL DEFAULT 'HABILES',    -- HABILES | CORRIDOS
  orden              INT          NOT NULL DEFAULT 0,
  activo             TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_tarea (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id          INT          NOT NULL,
  catalogo_clave      VARCHAR(64)      NULL,              -- NULL = tarea manual (§5.1)
  categoria           VARCHAR(24)  NOT NULL,
  titulo              VARCHAR(300) NOT NULL,
  descripcion         TEXT             NULL,
  estado              VARCHAR(16)  NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE | EN_CURSO | HECHA
  responsable_id       INT              NULL,
  responsable_nombre  VARCHAR(160)     NULL,
  plazo_at            DATETIME         NULL,
  creado_at           DATETIME     NOT NULL,
  primer_contacto_at  DATETIME         NULL,               -- trazabilidad §18.3
  cerrado_at          DATETIME         NULL,
  cerrado_por          INT              NULL,
  cerrado_por_nombre  VARCHAR(160)     NULL,
  nota_cierre         TEXT             NULL,
  es_manual           TINYINT(1)   NOT NULL DEFAULT 0,
  creado_por           INT              NULL,
  orden               INT          NOT NULL DEFAULT 0,
  INDEX idx_compras_tarea_negocio (negocio_id, orden),
  INDEX idx_compras_tarea_responsable (responsable_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Catálogo inicial ENUNCIATIVO (spec §5.2, categorías Validación y Plazos administrativos). La
-- categoría "Apertura" (notificación, asignación, lectura del resumen, marcado de urgencia) no
-- genera fila de tarea: son eventos del sistema que ya quedan en compras_asignacion/historial_eventos,
-- no checklist con responsable propio.
INSERT IGNORE INTO compras_tarea_catalogo (clave, categoria, titulo, descripcion, responsable_regla, plazo_dias, plazo_tipo, orden) VALUES
('contacto_inicial',        'VALIDACION',     'Contacto inicial con el cliente',
 'Acusar recibo de la orden de compra, presentarse como responsable de la entrega, canalizar dudas y gestionar por anticipado lo que probablemente no se cumplirá al pie de la letra (spec §5.3).',
 'ENCARGADO', 1, 'HABILES', 10),
('validacion_tecnica_real', 'VALIDACION',     'Validación técnica real',
 'Confirmar dos cosas distintas: que la ficha presentada corresponde a un producto real de un fabricante identificable, y que el producto cotizado es el correcto (spec §1.3.3/§5.2).',
 'ENCARGADO', 3, 'HABILES', 20),
('validacion_cotizacion',   'VALIDACION',     'Validación de la cotización preexistente',
 'Contacto directo con el proveedor de respaldo: existencia, stock, cumplimiento de especificaciones, ficha técnica, plazo de entrega y vigencia del precio (spec §5.4). Corre después de la validación técnica real.',
 'ENCARGADO', 3, 'HABILES', 30),
('validacion_costeo',       'VALIDACION',     'Validación del costeo como presupuesto',
 'Confirmar que el costo estimado por el asistente es correcto — habilita a mejorarlo por cotización y negociación (spec §1.3.2).',
 'ENCARGADO', 3, 'HABILES', 40),
('aceptar_oc',              'ADMINISTRATIVO', 'Aceptación de la orden de compra',
 'Aceptar la orden de compra en el portal de Mercado Público. Plazo de las bases — tope legal 5 días corridos si no está declarado (spec §5.2).',
 'ENCARGADO', 5, 'CORRIDOS', 50),
('boleta_fiel_cumplimiento','ADMINISTRATIVO', 'Entrega de boleta de fiel cumplimiento',
 'Solo si el resumen ejecutivo la marca como exigida. Plazo propio de las bases.',
 'ENCARGADO', 5, 'HABILES', 60),
('firma_contrato',          'ADMINISTRATIVO', 'Firma de contrato',
 'Solo si el resumen ejecutivo lo marca como exigido.',
 'ENCARGADO', 5, 'HABILES', 70),
('reloj_entrega',           'ADMINISTRATIVO', 'Fijación y validación del reloj de entrega',
 'Validación manual obligatoria del hito de inicio y el plazo ofertado, antes de fijar el reloj de entrega (spec §5.2/§15.1).',
 'ENCARGADO', 1, 'HABILES', 80);
