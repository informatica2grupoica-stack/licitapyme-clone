# Procedimientos internos: derechos de las personas y brechas de seguridad

> **BORRADOR TÉCNICO** para revisión de un abogado. Plazos y obligaciones de la Ley 21.719: el abogado confirma cada uno. Aquí se explica **cómo lo hace el equipo** con las herramientas que ya existen.

**Responsable de privacidad:** [nombre y correo]. **Suplente:** [nombre].

## 1. Derechos de las personas (acceso, rectificación, supresión, oposición, portabilidad, bloqueo)

### 1.1 Cómo llega
Al correo de privacidad ([correo]). Se anota en un registro (fecha, quién, qué pide, respuesta, fecha de respuesta). **Plazo de respuesta: 30 días corridos** desde que se recibe (prorrogable en los casos que la ley permite; el abogado lo confirma). Se responde aunque la respuesta sea «no corresponde» y se explica por qué.

### 1.2 Paso 1 — Identificar quién pide y de qué datos
- Verificar la identidad (que el correo desde donde escribe es el de la cuenta, o pedir un dato adicional). **No entregar datos a quien no se pueda identificar.**
- Ver el **rol de LICITANK** para esos datos (`registro-actividades-tratamiento.md`):
  - **Datos de su cuenta o del uso de la plataforma** (tabla A): LICITANK es responsable → responde LICITANK.
  - **Datos que cargó una empresa** (tabla B: documentos, cotizaciones, anexos): el responsable es la empresa-cliente → **se deriva a la empresa en 5 días hábiles** y se le avisa a la persona que se derivó, y a quién.

### 1.3 Paso 2 — Ejecutar
| Derecho | Qué se hace |
|---|---|
| **Acceso / portabilidad** | La persona usuaria ve su perfil en la plataforma. Para una copia completa de los datos de una empresa: *Mi empresa → Exportar* (lo hace el admin de la empresa; entrega todo en un archivo, sin claves). Para una persona en particular: consulta de solo lectura sobre las tablas A y entrega en archivo (CSV/JSON) por un canal seguro. |
| **Rectificación** | Cada usuario edita su perfil; el admin de la empresa edita al resto. Si es un dato de un documento, lo corrige la empresa. |
| **Supresión / cancelación** | Un usuario: el admin de su empresa lo desactiva; para borrar el dato por completo, se anonimiza su fila a mano (hoy no hay botón para eso: nombre, correo, teléfono y foto), conservando los registros de actividad con un identificador sin datos personales. Un contacto de proveedor en documentos: lo decide la empresa responsable. Una empresa completa: **baja de empresa** (`/admin/clientes`, solo con la empresa suspendida; exporta, borra datos y archivos de R2, deja una línea de bitácora). |
| **Oposición** | Avisos por WhatsApp: el usuario quita su celular de *Mi perfil* o el admin apaga el aviso. Correos de aviso: se apaga el aviso del usuario. |
| **Bloqueo temporal** | Desactivar la cuenta (no se borra nada) mientras se resuelve. |

### 1.4 Paso 3 — Responder y archivar
Responder por escrito, con lo hecho y la fecha. Guardar copia 5 años [el abogado fija el plazo]. Si la persona no queda conforme: informarle que puede reclamar ante la **Agencia de Protección de Datos Personales**.

## 2. Brechas de seguridad

### 2.1 Qué es una brecha
Cualquier hecho que cause **destrucción, pérdida, alteración, acceso o comunicación no autorizada** de datos personales. Ejemplos reales o posibles en LICITANK:
- Una empresa ve datos de otra (**una fuga entre empresas cuenta como brecha**, aunque sea un solo dato).
- Un aviso (correo, campana, WhatsApp) llega a quien no corresponde.
- Credenciales o claves expuestas (como la casilla `licitaciones@` el 2026-11-04).
- Acceso no autorizado al servidor, la base o R2; respaldo perdido o filtrado.
- Un proveedor (IA, correo, WhatsApp, R2) avisa de una filtración.

### 2.2 Qué hace quien la detecta (cualquier persona del equipo)
1. **Avisar de inmediato** al responsable de privacidad ([teléfono/WhatsApp]). No esperar a entender todo.
2. **No borrar nada** que sirva de evidencia (logs, filas, correos).

### 2.3 Qué hace el responsable (primeras 24 horas)
1. **Contener:** cambiar claves comprometidas, cerrar sesiones, suspender la integración o la empresa afectada, apagar la función. (Para cerrar sesiones: cambiar `JWT_SECRET` en el `.env` y reiniciar cierra todas, con el aviso a usuarios.)
2. **Evaluar:** qué datos, de qué empresas y cuántas personas, desde cuándo, si hay datos sensibles o económicos, si hay riesgo para las personas. Revisar `actividad_usuario`, `historial_eventos`, el log del servidor y el chequeo de aislamiento (`scripts/chequear-aislamiento.mts --produccion`, solo lectura).
3. **Registrar** en el *registro de brechas* (abajo), aunque no haya que notificar.

### 2.4 Notificaciones
| A quién | Cuándo | Qué se le dice |
|---|---|---|
| **Empresas-cliente afectadas** (son las responsables) | **Sin demora y a más tardar en 48 horas** desde que se conoce (Anexo B del contrato) | Qué pasó, qué datos, cuándo, qué se hizo, qué debe hacer ella |
| **Agencia de Protección de Datos Personales** | Si hay riesgo razonable para las personas; la ley pide hacerlo «sin dilaciones indebidas» [el abogado fija el plazo y el formulario] | Lo mismo, más las medidas tomadas |
| **Las personas afectadas** | Cuando la brecha afecte datos sensibles, económicos o de niños, o haya riesgo alto [el abogado confirma] | En lenguaje claro: qué pasó, qué datos, qué hacer |

### 2.5 Después
- Corregir la causa y agregar una prueba automática si aplica (como se hizo con la barrera `aviso-frontera.ts`).
- Anotar en `docs/memoria` la lección.
- Cerrar la entrada del registro.

### 2.6 Registro de brechas (plantilla)
| Fecha detección | Qué pasó | Datos y empresas | Personas | Contenido y causa | Notificado a (fecha) | Cierre |
|---|---|---|---|---|---|---|
| 2026-11-04 | Casilla `licitaciones@` usada por una IP ajena para enviar spam (102 correos) | Casilla de correo de la plataforma | [confirmar si hubo datos de clientes] | Clave comprometida | [__] | Pendiente: cambio de clave |
| 2026-11-26 | Avisos de ICA llegaban a admin de otras empresas (13 acuses y 43 avisos en producción) | Avisos con código de licitación y mensaje | [empresas afectadas: ver bitácora] | Falta de barrera entre empresas | [decidir si correspondía notificar] | Corregido, limpiado y con barrera automática |

> Nota para el dueño: los dos eventos del registro son **reales** y el abogado debe decir si alguno debía notificarse. De aquí en adelante, cualquier hecho similar se anota en este registro el mismo día.

## 3. Capacitación y revisión
- Una vez al año: repasar este documento con todo el equipo técnico.
- Cada vez que se agregue una función nueva con datos personales: actualizar `registro-actividades-tratamiento.md` (regla de la skill `multiempresa-escalable`).
