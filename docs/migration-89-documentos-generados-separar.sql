-- Migration 89: tabla documentos_generados_separar
-- Marca los archivos que "Separar anexos" (POST /api/anexos/separar) generó a partir de un
-- documento más largo que traía varios formularios pegados — a diferencia de un documento
-- ORIGINAL descargado tal cual de Mercado Público. Sirve para pintarlos de color NARANJO en
-- "Documentos y Bases" (pedido explícito del usuario, 7-sep-2026): "esos los debes de poner en
-- color naranjo que son los que se separan".
--
-- Es una TABLA APARTE (no una columna en documentos_cache), mismo criterio que migration-75
-- (documentos_origen_manual): esa tabla ya tenía ~24.000 filas/~300MB cuando se creó, y en
-- MySQL 5.7 (sin INSTANT ADD COLUMN) un ALTER TABLE la reescribe entera — Bluehost mata las
-- conexiones que se pasan de ~150s en este plan compartido. Un CREATE TABLE nuevo y vacío no
-- toca la tabla grande.
--
-- OJO: "Separar anexos" YA marca categoria_manual=1 en documentos_cache (protege la caja elegida
-- de una re-clasificación IA), pero esa misma marca también la usa cualquier documento que el
-- usuario moviera a mano de caja — no alcanza para distinguir "esto lo generó Separar" de "esto
-- lo clasificó/movió una persona". Esta tabla es la señal que sí distingue una cosa de la otra.
--
-- Ejecutar en Bluehost phpMyAdmin si el script no puede correr.

CREATE TABLE IF NOT EXISTS documentos_generados_separar (
  documento_id INT NOT NULL PRIMARY KEY,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
