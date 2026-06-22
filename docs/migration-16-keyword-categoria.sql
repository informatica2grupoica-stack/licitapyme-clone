-- migration-16-keyword-categoria.sql
-- Plan B: categorías padre + palabras clave dentro (cajitas) para separar por negocio.
-- Vincula cada palabra clave de búsqueda a una categoría (línea de negocio = tabla etiquetas).
-- Categorías padre típicas: MATERIALES EN GENERAL, MAQUINARIA, EQUIPAMIENTO (ya existen en etiquetas).
-- MySQL 5.7 compatible (sin IF NOT EXISTS en ADD COLUMN).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

ALTER TABLE palabras_clave
  ADD COLUMN categoria_id INT NULL AFTER keyword;

ALTER TABLE palabras_clave
  ADD INDEX idx_pk_categoria (categoria_id);

ALTER TABLE palabras_clave
  ADD CONSTRAINT fk_pk_categoria FOREIGN KEY (categoria_id) REFERENCES etiquetas(id) ON DELETE SET NULL;
