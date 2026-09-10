-- migration-103-adjudicacion-contacto.sql
-- El "Datos del Contacto para esta Licitación" (nombre, cargo, teléfono, e-mail de la persona a
-- cargo en Mercado Público) vive en la MISMA página del acta de adjudicación que ya se lee para
-- los anexos (app/lib/acta-adjudicacion.ts::leerActa) — nadie lo estaba extrayendo. Descubierto
-- 09-sep-2026: el usuario lo pidió a mano ("necesito el número y el correo de la persona a cargo")
-- y resultó que la ficha de MP (licitacion_raw) trae esos campos siempre vacíos
-- (EmailResponsableContrato/FonoResponsableContrato = ""), pero el acta SÍ los publica.
--
-- Se guardan en `adjudicacion_cache` (junto a url_acta, mismo ciclo de vida: se llenan cuando se
-- lee el acta, nunca se inventan si el parseo no encuentra el bloque).

-- Aplicar con `node scripts/aplicar-migration-103.mjs` (revisa columna por columna antes de
-- alterar, idempotente — mismo patrón que las migraciones ALTER anteriores del proyecto).
ALTER TABLE adjudicacion_cache
  ADD COLUMN contacto_nombre   VARCHAR(200) DEFAULT NULL,
  ADD COLUMN contacto_cargo    VARCHAR(200) DEFAULT NULL,
  ADD COLUMN contacto_telefono VARCHAR(60)  DEFAULT NULL,
  ADD COLUMN contacto_email    VARCHAR(200) DEFAULT NULL;
