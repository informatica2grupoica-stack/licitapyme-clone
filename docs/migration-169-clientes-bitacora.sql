-- migration-169-clientes-bitacora.sql
-- MULTI-CLIENTE, PASO D: bitácora de lo que el superusuario hace con las empresas-cliente (crear, activar/quitar módulos, suspender,
-- cambiar vencimiento). Sirve para saber quién activó qué y cuándo (y para cobrar/auditar).
CREATE TABLE IF NOT EXISTS clientes_bitacora (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  usuario_id INT NULL,
  accion     VARCHAR(40) NOT NULL,
  detalle    JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cliente_bitacora (cliente_id, created_at)
);
