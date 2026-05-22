-- Ejecutar en phpMyAdmin de Bluehost

-- Tabla de historial de búsquedas
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

-- Tabla de licitaciones favoritas
CREATE TABLE IF NOT EXISTS favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre TEXT,
    organismo VARCHAR(255),
    monto_total BIGINT,
    fecha_cierre DATETIME,
    estado VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_codigo (codigo),
    INDEX idx_created_at (created_at)
);

-- Tabla de alertas de búsqueda
CREATE TABLE IF NOT EXISTS search_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    query VARCHAR(255) NOT NULL,
    filters TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    last_notified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_is_active (is_active)
);