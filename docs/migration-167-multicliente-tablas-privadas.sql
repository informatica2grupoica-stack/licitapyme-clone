-- migration-167-multicliente-tablas-privadas.sql
-- MULTI-CLIENTE, PASO B (ver docs/auditoria-modulos-multicliente.md §3).
-- Agrega `cliente_id` a las tablas PRIVADAS que usan Radar y Negocios. Todas nacen con DEFAULT 1 (Grupo ICA):
-- lo que hoy existe queda asignado a ICA y ninguna consulta actual cambia de resultado.
--
-- ADD COLUMN usa ALGORITHM=INSTANT (MySQL 8): no copia ni bloquea la tabla; si no pudiera ser instantáneo, falla
-- en vez de bloquear producción. Los índices se crean ONLINE (no frenan lecturas/escrituras).
-- Las llaves únicas que eran globales pasan a ser por cliente (dos clientes pueden tener la misma etiqueta o
-- descartar la misma licitación sin pisarse).
--
-- Se aplica con scripts/aplicar-migration-167.mjs (idempotente; por defecto SOLO contra el espejo local).

ALTER TABLE negocios                ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE etiquetas               ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE palabras_clave          ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE alertas_licitaciones    ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE favoritos               ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE licitaciones_descartadas ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE comentarios_licitacion  ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE historial_eventos       ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE actividad_usuario       ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE puente_radar            ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE puente_cola             ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE puente_repartos         ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE reportes_error          ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE search_history          ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;

-- Índices por cliente (las consultas siempre filtran por cliente primero).
ALTER TABLE negocios                ADD INDEX idx_negocios_cliente (cliente_id, licitacion_codigo);
ALTER TABLE palabras_clave          ADD INDEX idx_pk_cliente (cliente_id, activo);
ALTER TABLE alertas_licitaciones    ADD INDEX idx_alertas_cliente (cliente_id, licitacion_codigo);
ALTER TABLE favoritos               ADD INDEX idx_favoritos_cliente (cliente_id);
ALTER TABLE comentarios_licitacion  ADD INDEX idx_comlic_cliente (cliente_id, licitacion_codigo);
ALTER TABLE historial_eventos       ADD INDEX idx_hist_cliente (cliente_id, created_at);
ALTER TABLE actividad_usuario       ADD INDEX idx_act_cliente (cliente_id, created_at);
ALTER TABLE puente_repartos         ADD INDEX idx_repartos_cliente (cliente_id);
ALTER TABLE reportes_error          ADD INDEX idx_reportes_cliente (cliente_id);
ALTER TABLE search_history          ADD INDEX idx_search_cliente (cliente_id);

-- Llaves únicas que eran globales → por cliente.
ALTER TABLE etiquetas               DROP INDEX unique_etiqueta, ADD UNIQUE INDEX uq_etiqueta_cliente (cliente_id, nombre);
ALTER TABLE puente_radar            DROP INDEX uk_puente_codigo, ADD UNIQUE INDEX uq_puente_cliente_codigo (cliente_id, licitacion_codigo);
ALTER TABLE licitaciones_descartadas DROP PRIMARY KEY, ADD PRIMARY KEY (cliente_id, licitacion_codigo);
ALTER TABLE puente_cola             DROP PRIMARY KEY, ADD PRIMARY KEY (cliente_id, licitacion_codigo);
