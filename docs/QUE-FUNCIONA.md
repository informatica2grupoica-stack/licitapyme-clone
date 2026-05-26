# Qué Funciona — LicitaPyme

## Búsqueda y navegación

- **Búsqueda de licitaciones** (`/api/search`): consulta la API oficial de Mercado Público (`api.mercadopublico.cl`) usando el ticket configurado en Vercel. Devuelve resultados paginados con filtros por estado, región, tipo y monto.
- **Detalle de licitación** (`/licitacion/[codigo]`): página completa con todos los datos de la ficha — nombre, organismo, región, montos, fechas, ítems, cronograma, contacto, estado.
- **Fallback de detalle** (`/api/licitacion-detalle/[codigo]`): si el código no está en el pool reciente, consulta la API de MP directamente por código exacto.
- **Favoritos**: se guardan en `localStorage`. Funciona sin cuenta de usuario.
- **Copiar código de licitación**: botón en el header de la ficha.

## Documentos — flujo manual

- **Subida de archivos** (`/api/documentos/subir`): el usuario arrastra archivos descargados de Mercado Público. Se suben a Cloudflare R2 con URL pública permanente (`https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev/...`) y se guardan en MySQL (`documentos_cache`).
- **Lectura de documentos guardados** (`/api/documentos/cache/[codigo]` y `/api/documentos/[codigo]`): devuelven los documentos almacenados en DB para ese código de licitación.
- **Zona de carga drag-and-drop**: componente `SubirDocumentos` en el sidebar de la ficha. Acepta PDF, DOCX, XLSX, ZIP, RAR.
- **Persistencia**: los documentos subidos quedan guardados en R2 + MySQL. Cualquier usuario que abra esa licitación los verá en el futuro.
- **Guía de 3 pasos**: instrucciones claras en el panel de documentos explicando al usuario cómo descargar de MP y arrastrar al área de carga.

## Inteligencia Artificial

- **Análisis de documentos con IA** (`/api/analizar-documento`): utiliza DeepSeek para procesar el contenido de PDFs y DOCXs almacenados en R2. Acepta una pregunta libre del usuario.
- **Preguntas rápidas predefinidas**: 8 preguntas sugeridas (resumen, requisitos técnicos, plazos, presupuesto, etc.).
- **Modo análisis múltiple**: el panel de chat puede analizar todos los documentos guardados a la vez y consolidar la respuesta.
- **Selector de documento activo**: el usuario puede elegir sobre qué archivo hace la pregunta.
- **Indicador "Listo para IA"**: los documentos con extensión PDF/DOCX y URL de R2 muestran este badge.

## Infraestructura

- **Cloudflare R2** (`/app/lib/r2.ts`): almacenamiento de archivos con URL pública sin expiración. Bucket: `licitapyme-docs`.
- **MySQL en Bluehost** (`/app/lib/db.ts`): base de datos con tablas `licitaciones_cache`, `documentos_cache`, `favoritos_usuarios`.
- **Despliegue en Vercel**: build Next.js 15, variables de entorno configuradas (`MERCADO_PUBLICO_TICKET`, `R2_*`, `DB_*`, `DEEPSEEK_API_KEY`).
- **API de Mercado Público**: funciona desde Vercel para búsquedas (no para descargas de adjuntos — ver QUE-NO-FUNCIONA.md).

## Servicios internos

| Archivo | Función |
|---|---|
| `app/lib/r2.ts` | Subir buffer a R2, retornar URL pública |
| `app/lib/db.ts` | Pool de conexiones MySQL |
| `app/services/documentosService.server.ts` | CRUD de `documentos_cache` |
| `app/hooks/useFavorites.ts` | Favoritos en localStorage |
| `app/components/Navbar.tsx` | Navbar y Breadcrumb globales |
