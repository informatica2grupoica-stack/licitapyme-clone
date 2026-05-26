# Resumen Ejecutivo — LicitaPyme
## Para presentación a jefatura

---

## ¿Qué es esta plataforma?

LicitaPyme es una plataforma web que ayuda a las empresas a encontrar y analizar oportunidades de negocio en el sistema de compras públicas del Estado chileno (Mercado Público). La plataforma permite buscar licitaciones, ver todos sus detalles, guardar favoritos y — lo más importante — usar inteligencia artificial para analizar los documentos técnicos de cada proceso de compra.

---

## ¿Qué se construyó y funciona hoy?

### Búsqueda y exploración

- Motor de búsqueda de licitaciones conectado directamente a la API oficial de Mercado Público.
- Filtros por estado (activa, cerrada, adjudicada), región, tipo y rango de montos.
- Ficha completa de cada licitación con todos los datos oficiales: organismo comprador, montos, fechas, ítems licitados, cronograma del proceso, datos de contacto.

### Gestión de documentos

- Los usuarios pueden subir los documentos técnicos (bases de licitación, términos de referencia, especificaciones) arrastrándolos a la plataforma.
- Los archivos se guardan en la nube de forma permanente y están disponibles para todos los usuarios que consulten esa misma licitación.
- Una vez subidos, los documentos son accesibles directamente desde la plataforma, sin necesidad de volver a Mercado Público.

### Análisis con Inteligencia Artificial

- Cualquier documento guardado puede ser analizado por la IA.
- El usuario puede hacer preguntas en lenguaje natural: "¿cuáles son los requisitos técnicos?", "¿qué experiencia se requiere?", "¿cuál es el presupuesto?", etc.
- La IA puede analizar un documento específico o todos los documentos de una licitación a la vez.
- Las preguntas frecuentes están predefinidas para facilitar el uso.

---

## ¿Qué no se puede hacer en forma automática y por qué?

### El problema con los documentos de Mercado Público

Los documentos adjuntos de las licitaciones (bases, especificaciones, planos, etc.) están guardados en los servidores del portal Mercado Público. El portal tiene un sistema de seguridad que **solo permite descargar esos archivos desde conexiones de internet chilenas** (proveedores como Movistar, VTR, Entel, etc.).

Nuestra plataforma está alojada en servidores en Estados Unidos (Vercel, la plataforma de despliegue). Cuando intentamos descargar automáticamente los documentos desde allá, el portal de Mercado Público **los bloquea automáticamente** porque detecta que la solicitud no viene de una IP chilena.

Esta es una restricción técnica del sistema de Mercado Público, no un error de nuestra plataforma. Intentamos varias alternativas — proxies especiales, servicios de scraping, la API oficial — y ninguna funcionó.

La API oficial de Mercado Público (`api.mercadopublico.cl`) tampoco incluye los documentos adjuntos en su respuesta. Esta es una limitación permanente de esa API.

### La solución manual que sí funciona

Desarrollamos un flujo de trabajo que resuelve el problema de forma práctica:

1. El usuario abre la licitación en Mercado Público desde su computador (con su conexión a internet chilena).
2. Descarga los documentos a su computador (un clic en la pestaña "Adjuntos").
3. Arrastra esos archivos al área de carga en LicitaPyme.
4. Los documentos quedan guardados en la plataforma y disponibles para análisis con IA.

Este proceso toma entre 1 y 3 minutos por licitación. Una vez hecho, los documentos quedan guardados permanentemente y disponibles para todos.

---

## Opciones para lograr descarga automática en el futuro

Si se desea automatizar completamente la descarga de documentos, existen tres caminos posibles, ordenados de menor a mayor costo:

### Opción 1 — Servidor en Chile (costo bajo)
Contratar un servidor virtual (VPS) en un proveedor de internet chileno (por ejemplo, GTD, Entel Empresas o NIC Chile). Desde ese servidor, las descargas de Mercado Público funcionan sin restricciones porque la IP es chilena. El costo estimado es de **$15.000 a $50.000 pesos mensuales** dependiendo del proveedor.

### Opción 2 — Extensión de navegador (desarrollo puntual)
Desarrollar una extensión para Chrome o Edge que el usuario instale una sola vez. La extensión detecta cuando el usuario está en Mercado Público y sube automáticamente los documentos a LicitaPyme, sin que el usuario tenga que hacer nada manualmente. Requiere un desarrollo de aproximadamente **2 a 4 semanas** de programación adicional.

### Opción 3 — Integración oficial con ChileCompra (largo plazo)
Gestionar con la Dirección ChileCompra el acceso a un API autenticada que incluya los documentos adjuntos. Esto requeriría acuerdo institucional y tiempo de negociación, pero sería la solución más robusta y permanente.

---

## Estado actual del proyecto

| Área | Estado |
|---|---|
| Búsqueda de licitaciones | Funcionando |
| Ficha de detalle completa | Funcionando |
| Favoritos | Funcionando |
| Subida manual de documentos | Funcionando |
| Almacenamiento en la nube (R2) | Funcionando |
| Análisis de documentos con IA | Funcionando |
| Descarga automática desde MP | No disponible (restricción técnica de MP) |

---

*Documento preparado para presentación interna — mayo 2026.*
