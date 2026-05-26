-- =============================================
-- Schema BD: LicitaPyme / Licita-ICA
-- Bluehost MySQL 5.7
-- =============================================

-- Historial de búsquedas
CREATE TABLE IF NOT EXISTS search_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    query VARCHAR(255) NOT NULL,
    filters TEXT,
    results_count INT DEFAULT 0,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_query (query),
    INDEX idx_created_at (created_at)
);

-- Licitaciones favoritas
CREATE TABLE IF NOT EXISTS favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre TEXT,
    organismo VARCHAR(255),
    monto_total BIGINT,
    monto_estimado BIGINT,
    moneda VARCHAR(10) DEFAULT 'CLP',
    fecha_cierre DATETIME,
    fecha_adjudicacion DATETIME,
    estado VARCHAR(10),
    tipo_licitacion VARCHAR(10),
    tipo_convocatoria VARCHAR(50),
    region VARCHAR(255),
    comuna VARCHAR(255),
    descripcion TEXT,
    resumen_ia TEXT,
    detail_url TEXT,
    search_url TEXT,
    semantic_score DECIMAL(10,4),
    final_score DECIMAL(10,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_codigo (codigo),
    INDEX idx_created_at (created_at)
);

-- Caché de documentos descargados (desde R2)
CREATE TABLE IF NOT EXISTS documentos_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    licitacion_codigo VARCHAR(100) NOT NULL,
    documento_nombre VARCHAR(500) NOT NULL,
    documento_url_local TEXT NOT NULL,
    documento_url_original TEXT,
    descripcion VARCHAR(500),
    fecha_doc VARCHAR(50),
    size_bytes BIGINT,
    content_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_lic_doc (licitacion_codigo(50), documento_nombre(200)),
    INDEX idx_licitacion_codigo (licitacion_codigo)
);

-- Alertas de búsqueda por email
CREATE TABLE IF NOT EXISTS search_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    query VARCHAR(255) NOT NULL,
    filters TEXT,
    is_active TINYINT(1) DEFAULT 1,
    last_notified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_is_active (is_active)
);

-- =============================================
-- MIGRACIONES (ejecutar si las tablas YA EXISTEN en Bluehost)
-- Ejecutar una a una en phpMyAdmin si la tabla fue creada antes con el schema viejo
-- =============================================

-- ALTER TABLE favorites ADD COLUMN monto_estimado BIGINT AFTER monto_total;
-- ALTER TABLE favorites ADD COLUMN moneda VARCHAR(10) DEFAULT 'CLP' AFTER monto_estimado;
-- ALTER TABLE favorites ADD COLUMN fecha_adjudicacion DATETIME AFTER fecha_cierre;
-- ALTER TABLE favorites ADD COLUMN tipo_licitacion VARCHAR(10) AFTER estado;
-- ALTER TABLE favorites ADD COLUMN tipo_convocatoria VARCHAR(50) AFTER tipo_licitacion;
-- ALTER TABLE favorites ADD COLUMN region VARCHAR(255) AFTER tipo_convocatoria;
-- ALTER TABLE favorites ADD COLUMN comuna VARCHAR(255) AFTER region;
-- ALTER TABLE favorites ADD COLUMN descripcion TEXT AFTER comuna;
-- ALTER TABLE favorites ADD COLUMN resumen_ia TEXT AFTER descripcion;
-- ALTER TABLE favorites ADD COLUMN detail_url TEXT AFTER resumen_ia;
-- ALTER TABLE favorites ADD COLUMN search_url TEXT AFTER detail_url;
-- ALTER TABLE favorites ADD COLUMN semantic_score DECIMAL(10,4) AFTER search_url;
-- ALTER TABLE favorites ADD COLUMN final_score DECIMAL(10,4) AFTER semantic_score;
