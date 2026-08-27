-- Migración 79 — DATOS DEL PRODUCTO QUE OFERTAMOS (marca, modelo, fabricante, país/año).
--
-- POR QUÉ (26-ago-2026): los formularios técnicos de los organismos abren con una tabla
-- "INFORMACIÓN DE LA OFERTA" que pide exactamente esto:
--
--     Nombre de la Empresa | Marca | Modelo | Fabricante | País/Año de Fabricación
--     Plazo de Entrega (marcar con una X) | Garantía Técnica
--
-- (caso real: FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_*.docx de 1057922-23-LE26). El Anexo N°4
-- Económico de otras licitaciones pide los mismos campos. Y NO EXISTÍAN EN NINGUNA PARTE del
-- sistema: la empresa no los tiene (son del producto, no del oferente) y el costeo tampoco (su
-- planilla trae ítem, unidad, cantidad y precios, ninguna columna de marca).
--
-- OJO CON UNA CONFUSIÓN CARA: el informe de viabilidad guarda `marca_modelo_referencia`, pero esa
-- es LA MARCA QUE PIDEN LAS BASES como referencia ("marca X o equivalente"), no la que nosotros
-- ofertamos. Copiarla acá sería declarar ante el organismo que ofertamos esa marca, que puede ser
-- falso. Son dos datos distintos y esta tabla es para el NUESTRO.
--
-- POR LÍNEA, no por negocio: en una licitación por línea cada línea es un producto distinto, con
-- su propia marca y modelo. Se cuelga de checklist_comercial.id (la fila tipo='linea_tecnica'),
-- que es donde ya vive todo lo técnico de esa línea.
--
-- `origen` distingue de dónde salió el dato, porque cambia cuánto se puede confiar:
--   'ficha'   → leído de la ficha técnica del proveedor (hay que confirmarlo)
--   'manual'  → lo escribió una persona (es la verdad)
-- Un dato leído de la ficha y NO confirmado no debería imprimirse como si fuera definitivo; por
-- eso `confirmado_por` es la señal que mira quien genera el documento.
--
-- Aplicar con `node scripts/aplicar-migration-79.mjs` (o a mano en phpMyAdmin).
-- Idempotente: CREATE TABLE IF NOT EXISTS. Sin backfill — el dato no existe en ningún lado y no
-- se inventa.

CREATE TABLE IF NOT EXISTS linea_producto_ofertado (
  item_id          INT          NOT NULL PRIMARY KEY,  -- checklist_comercial.id (tipo='linea_tecnica')
  negocio_id       INT          NOT NULL,              -- redundante a propósito: filtrar sin JOIN
  marca            VARCHAR(160)     NULL,
  modelo           VARCHAR(160)     NULL,
  fabricante       VARCHAR(160)     NULL,
  pais_fabricacion VARCHAR(120)     NULL,
  anio_fabricacion VARCHAR(20)      NULL,              -- texto: a veces viene "2024/2025"
  garantia_meses   INT              NULL,
  origen           VARCHAR(20)  NOT NULL DEFAULT 'manual',   -- ficha | manual
  fuente_documento VARCHAR(300)     NULL,              -- nombre de la ficha de donde se leyó
  confirmado_por   INT              NULL,              -- usuarios.id; NULL = todavía sin confirmar
  confirmado_en    DATETIME         NULL,
  actualizado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lpo_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
