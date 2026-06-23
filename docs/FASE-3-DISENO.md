# Fase 3 — Búsqueda de Productos y Precios (diseño)

> Estado: **diseño para decidir** (no implementado). Calcula el **margen real**, que es
> lo que decide si conviene postular con plata. Hoy la Fase 2 deja todo esto en
> `pendientes_fase3: ["importabilidad_real","densidad_de_oferta","margen","peso_fino_por_linea"]`.

## 1. Entrada (ya existe — hook de Fase 2)
`viabilidad_licitacion.informe_ejecutivo._informe_ia.manifiesto_productos[]`:
```
{ linea, descripcion, modelo, cantidad, tipo: generico|especifico, ruta: A|B, peso_provisional }
```
- **Ruta A** (ferretería/genérico) → precio en proveedores locales / retail.
- **Ruta B** (equipamiento/específico) → buscar homólogo + precio (web).

## 2. Salida propuesta
Por línea: `costo_unitario_estimado`, `costo_total_linea`, `fuente_precio`, `confianza`,
`importable` (sí/no/condicional). Agregado: `costo_total`, `presupuesto_total`,
`margen_estimado_%`, `margen_$`, `lineas_a_atacar[]` (las de mejor margen×peso).

## 3. Fuentes de precio (DECISIÓN PENDIENTE — lo principal a definir)
| Ruta | Opción | Notas |
|---|---|---|
| A genérico | Catálogo propio de proveedores (tabla interna) | Lo más preciso; requiere mantenerlo |
| A genérico | Scraping retail (Sodimac/Construmart/MercadoLibre) | Frágil, anti-bot; ya hay infra de scraping en el repo |
| B específico | **Serper API** (Google Shopping/Search) | El código ya menciona "ruta B = Serper"; falta API key + endpoint |
| B específico | DeepSeek/Gemini para normalizar el homólogo | Convierte la descripción de las bases en términos buscables |

## 4. Flujo propuesto (por licitación, lote a lote como las otras fases)
1. Leer `manifiesto_productos` de la viabilidad ya hecha.
2. Por línea: normalizar la búsqueda (IA) → buscar precio según ruta → tomar mediana de N resultados.
3. Calcular costo y margen contra el presupuesto (total o por línea si existe).
4. Persistir en tabla nueva `fase3_precios` (1 fila por línea) + resumen en `viabilidad_licitacion`.
5. Marcar `importabilidad_real` y `densidad_de_oferta` (cuántos oferentes/proveedores hay).

## 5. Esquema BD propuesto
```sql
CREATE TABLE fase3_precios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo VARCHAR(100) NOT NULL,
  linea INT NOT NULL,
  descripcion TEXT,
  costo_unitario DECIMAL(14,2) NULL,
  costo_total DECIMAL(16,2) NULL,
  fuente_precio VARCHAR(255),
  importable VARCHAR(20),         -- si|no|condicional
  confianza DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lic_linea (licitacion_codigo, linea),
  INDEX idx_lic (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```
(Charset utf8mb4_general_ci a propósito, para que el JOIN con `alertas`/`viabilidad` use índice — ver migration-24.)

## 6. APIs / costos
- **Serper**: ~US$1 / 1.000 búsquedas. Con N=3 resultados por línea y ~20 líneas → ~0,06 USD/licitación.
- **IA de normalización**: DeepSeek (barato) para convertir descripción → query y elegir el homólogo correcto.
- Rate-limit y caché por (descripcion+modelo) para no re-buscar lo mismo.

## 7. Decisiones que necesito de ti antes de implementar
1. **Fuente de precios ruta A**: ¿catálogo propio, scraping retail, o Serper también?
2. **¿Tienes API key de Serper** (o prefieres otra: SerpApi, Google Shopping, Bsale)?
3. **Margen objetivo**: ¿cuál es el % mínimo para marcar "conviene" (ej. 15%)?
4. **¿Manual o automático**: botón "Calcular precios" o se encadena tras la viabilidad?
```
