-- Migration 75: tabla documentos_origen_manual
-- Marca los documentos que el usuario SUBIÓ A MANO directamente en una caja de la licitación
-- (Bases Administrativas, Bases Técnicas, Anexos Oferente, etc.) mediante el botón "Subir
-- documento(s) a esta caja" — a diferencia de los descargados automáticamente de Mercado
-- Público. Solo estos (y los ya cubiertos por CATS_PROPIAS en el código) se pueden
-- eliminar/renombrar; los oficiales de MP quedan protegidos aunque compartan la misma caja.
--
-- Es una TABLA APARTE (no una columna en documentos_cache) a propósito: documentos_cache ya
-- tiene ~24.000 filas / ~300MB, y en MySQL 5.7 (sin soporte de INSTANT ADD COLUMN, que llegó
-- recién en 8.0.12) un ALTER TABLE ADD COLUMN reescribe la tabla entera. Confirmado en vivo el
-- 24-ago-2026 con SHOW PROCESSLIST: dos intentos de ese ALTER murieron justo pasados los ~150s
-- ("Connection lost: The server closed the connection") — Bluehost mata las conexiones/queries
-- que se pasan de ese umbral en este plan compartido. Una tabla nueva y vacía es un CREATE TABLE
-- instantáneo que no toca la tabla grande, así que no choca con ese límite.
-- Ver también migration-47 (categoria_manual), que SÍ es una columna real en documentos_cache
-- (se aplicó en julio, cuando la tabla era más chica) y sigue protegiendo estos mismos
-- documentos de que una re-clasificación IA los reasigne de caja.
-- Ejecutar en Bluehost phpMyAdmin si el script no puede correr.

CREATE TABLE IF NOT EXISTS documentos_origen_manual (
  documento_id INT NOT NULL PRIMARY KEY,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
