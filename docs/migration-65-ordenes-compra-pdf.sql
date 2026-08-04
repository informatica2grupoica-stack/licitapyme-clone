-- migration-65-ordenes-compra-pdf.sql
-- PDF de la orden de compra, guardado en R2 como el resto de los documentos.
--
-- POR QUÉ SE PUEDE (a diferencia de los anexos de oferta / acta, que exigen postback + cookies +
-- IP chilena por el WAF): la ficha DetailsPurchaseOrder.aspx trae el botón "Descargar PDF" como un
-- <input type=image onclick="open('PDFReport.aspx?qs=TOKEN', ...)">. Verificado en vivo
-- (4-ago-2026): tanto la ficha como PDFReport.aspx?qs=TOKEN responden 200 con un fetch plano, SIN
-- cookies ni sesión previa — el token no depende de nada más que del código de la OC. Por eso esto
-- no necesita el flujo pesado de mp-descarga-orquestador.ts.
--
-- Aun así se descarga desde el cron (VPS), no desde una API que golpee el usuario en Vercel: MISMA
-- razón que el resto — no vale la pena arriesgar el WAF por una acción que igual puede esperar al
-- barrido diario, y así queda un solo lugar que sabe hablar con el portal.
--
-- Idempotente.

ALTER TABLE ordenes_compra ADD COLUMN pdf_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE ordenes_compra ADD COLUMN pdf_descargado_at DATETIME DEFAULT NULL;
ALTER TABLE ordenes_compra ADD COLUMN pdf_error VARCHAR(300) DEFAULT NULL;
