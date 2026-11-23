# Investigación de competencia — 2026-11-23

Fuente: webs y planes de cada empresa (sin verificar por terceros). Revisadas ~30 plataformas.

## Quiénes son (con link)

Chile: [LicitaLab](https://www.licitalab.cl) · [FirmaVB](https://www.firmavb.cl) · [Masnet](https://masnet.com) · [LicitX](https://licitx.cl) · [Smartoffer](https://smartoffer.cl) · [Adjudica](https://www.adjudica.cl) · [Galici](https://galici.cl) · [Vendify](https://vendify.cl) · [LicitaFlow](https://licitaflow.cl) · [Licitados](https://licitados.cl) · [MiLicitaIA](https://milicitaia.cl) · [LicitaPyme](https://licitapyme.cl) · [Licisoft](https://www.licisoft.cl/lp/index.php)
No encontradas: Falconsoft (SGL), Lici, TodoLicitaciones, AlertasMP, AdjudiKo (sitio caído).
España: Tendios, LICAI, Licia, LicitaIA, LicitaGo, laLicita.ai, Licita IA (el del video M7gyqthz5Ps).
LatAm: Pura Licitación, iaLicitaciones, Licitarus, Licitta, Elicita, Licitap (MX), LicitiGo y LinkContrata (PE), PresconIA (AR).
EE. UU.: GovWin IQ, HigherGov, GovSpend, Procurement Sciences, BidPrime, Govly, Starbridge.

## Precios de referencia (Chile)

Vendify desde $14.990 · LicitaFlow 0,5 UF · LicitX Starter 0,5 UF (3 usuarios; RUT extra 1,2 UF) · Licitados Pro $44.990 · Licisoft $60.000 · LicitaLab 2,2 / 3,2 / 5 UF · FirmaVB $50.000 / $100.000 / ERP $149.990 + 3 % de la OC.

## Lo que solo tenemos nosotros

Costeo, Auditor, compras con pareo de cotizaciones, OC a proveedores (Obuma), entregas y acta, margen real, relleno de anexos Word/PDF/Excel, viabilidad con presupuesto por línea, aislamiento por empresa.

## Decisiones del dueño (2026-11-23)

- **Compra Ágil: NO por ahora.**
- **Importar OCDS (2022–2026) a tablas con índices, filtrado por rubros: NO ahora; se hará «al terminar» lo que hay en curso.** Mientras tanto «quién gana y a qué precio» se apoya solo en lo que ya hay (`adjudicacion_cache`, `oferta_competencia`, `ordenes_compra`).
- Cuando se retome: fuente OCDS (CC0) https://data.open-contracting.org/en/publication/144 (≈2,8 M licitaciones y 2,9 M adjudicaciones, 1,9 GB jsonl); Compra Ágil no viene en OCDS; adjudicación con varios proveedores no separa monto por proveedor (usar el detalle por línea). Fases pensadas: A importar con índices por rubro · B limpieza · C pantalla de precio adjudicado · D integrar al costeo («con tu costo ganas M % a ese precio») · E perfil organismo/competidor · F leer aperturas de lo que importa · G avisos de renovación. Falta decidir rubros (UNSPSC o líneas de negocio) y cuánto histórico.

## Brechas (ver prioridad en la conversación)

1. Precio público, plan gratis/prueba (landing sin precios).
2. Compra Ágil como flujo propio (casi ausente en el código).
3. Quién gana y a qué precio / perfil de organismo / riesgo de pago.
4. Cada dato con su página del pliego (existe `pdf-pagina` en viabilidad; falta confirmar cobertura total).
5. Avisos de renovación de contratos (LicitX 3–12 meses).
6. Garantías, contratos y vencimientos como módulo (Masnet).
7. Cotización con IA en minutos y envío con un clic (LicitaFlow, Galici).
8. Autopsia de licitación perdida (Smartoffer); ya existe «¿A quién le perdimos?».
9. Scorecard gratis por RUT como gancho (LicitaFlow).
10. Asistente legal (Ley 19.886, Contraloría) y cobranza con intereses (FirmaVB, MiLicitaIA).
11. MCP / API / Zapier (LicitaLab Pro, LicitaFlow, LicitX Enterprise).
12. Apps nativas y firma desde el móvil (Masnet); app Android en Fase 0.
13. Otros países (LicitaLab PE/CO, Pura Licitación).
