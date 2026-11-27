# Registro de actividades de tratamiento de datos personales — LICITANK

> **BORRADOR TÉCNICO** para revisión de un abogado. Basado en lo que el sistema hace hoy (2026-11-27). Se actualiza cada vez que se agrega una función que toque datos de personas (regla en `docs/memoria`).

**Responsable / encargado:** ver el rol en cada fila. LICITANK = [razón social, RUT]. Contacto de privacidad: [correo].

## A. Tratamientos en que LICITANK es RESPONSABLE

| # | Actividad | Datos | De quién | Finalidad y base | Dónde se guardan | Cuánto tiempo | Con quién se comparte |
|---|---|---|---|---|---|---|---|
| A1 | Cuentas de usuario | Nombre, correo, teléfono, RUT, cargo, área, foto (opcional), rol y permisos, hash de la clave | Personas de las empresas-cliente | Prestar el servicio (contrato) | Base de datos del servidor (tabla `usuarios`) | Mientras la cuenta esté activa; al dar de baja la empresa se borran | Proveedor del servidor |
| A2 | Inicio de sesión y seguridad | Fecha, IP, intentos fallidos, bloqueos | Usuarios | Seguridad y prevención de fraude (interés legítimo) | Base de datos | [definir; hoy: junto a la cuenta] | Ninguno |
| A3 | Recuperación de clave | Correo, enlace temporal | Usuarios | Seguridad de la cuenta (contrato) | Base de datos (`password_resets`) | **7 días** (purga automática) | Proveedor de correo |
| A4 | Registro de actividad | Quién hizo qué y cuándo (aprobó, cambió, eliminó) | Usuarios | Seguridad y trazabilidad (interés legítimo) | Base de datos (`actividad_usuario`) | **18 meses** (purga automática) | Ninguno |
| A5 | Historial de eventos y avisos | Mensajes de aviso, a quién llegaron | Usuarios | Prestar el servicio | Base de datos (`historial_eventos`) | **24 meses** (purga automática) | Proveedor de correo; WhatsApp si se activa |
| A6 | Solicitudes de alta (formulario público `/registro`) | Razón social, RUT, nombre, correo y teléfono de contacto, mensaje, IP | Personas de empresas que piden acceso | Evaluar la solicitud (medidas precontractuales) | Base de datos (`cliente_solicitud`) | [definir: propuesta 12 meses si se rechaza; si se aprueba pasa a A1] | Ninguno |
| A7 | Reportes de error de usuarios | Texto del reporte y captura de pantalla marcada por el usuario | Usuarios | Mejorar y corregir el servicio | Base de datos (`reportes_error`) + R2 | [definir] | Ninguno |
| A8 | Medición de uso (IA, Mercado Público) | Consumo por empresa y módulo; sin texto de documentos | Empresas-cliente | Facturación y topes de uso | Base de datos (`ia_uso`, `mp_api_uso_cliente`) | Mientras haya contrato; al dar de baja se anonimiza | Ninguno |

## B. Tratamientos en que LICITANK es ENCARGADO (el responsable es cada empresa-cliente)

| # | Actividad | Datos | De quién | Finalidad | Dónde | Subencargados |
|---|---|---|---|---|---|---|
| B1 | Gestión de licitaciones y negocios | Nombres de responsables, comentarios, asignaciones | Equipo del cliente | Seguimiento interno | Base de datos | Servidor |
| B2 | Anexos y documentos de postulación | RUT, nombre, cédula, firma y timbre de representantes; datos de la empresa | Representantes legales del cliente | Preparar la oferta | Base de datos + R2 | Servidor, R2, IA (Z.AI, Moonshot, Google) |
| B3 | Cotizaciones, fichas y facturas de proveedores | Nombre, correo, teléfono, RUT de contactos de proveedores | Personas de proveedores | Costeo y compras | Base de datos + R2 | Servidor, R2, IA |
| B4 | Lectura de documentos con IA y OCR | Texto e imágenes de documentos (pueden contener los datos de B2/B3) | Las mismas | Extraer información para el Servicio | Se envía al proveedor, resultado queda en la base (`documentos_cache`, otros) | Z.AI, Moonshot, Google, DeepSeek (**fuera de Chile**) |
| B5 | Órdenes de compra y facturación | Datos de proveedores y de la empresa | Proveedores | Compras | Base de datos; Obuma si el cliente lo conecta | Servidor, Obuma |
| B6 | Avisos por correo | Correo y nombre del equipo, texto del aviso | Equipo del cliente | Alertas del servicio | Cola en base de datos | Proveedor de correo |
| B7 | Avisos por WhatsApp (opcional) | Celular y nombre del equipo, texto del aviso | Equipo del cliente | Alertas del servicio | Cola en base de datos; sesión del número de la empresa | WhatsApp (conexión no oficial; **fuera de Chile**) |
| B8 | Exportación y baja de la empresa | Todo lo anterior | Equipo y terceros del cliente | Entregar y borrar los datos del cliente | Archivo de exportación (lo recibe el cliente) | Ninguno |

## C. Información pública (no es dato personal tratado como tal)
Licitaciones, órdenes de compra y adjudicaciones de Mercado Público (`licitaciones_cache`, `adjudicacion_cache`): información pública; pueden incluir nombres de funcionarios o de contactos de organismos. Se conservan como caché; no se purgan hoy.

## D. Transferencias a terceros fuera de Chile
IA (B4) y WhatsApp (B7); posiblemente R2 [verificar país]. Medidas: se envía solo lo necesario, contrato con el cliente (Anexo B, punto 7), sin uso para entrenamiento por parte de LICITANK. **[Pendiente de abogado y de revisar las condiciones de cada proveedor: algunas plataformas de IA retienen o usan datos de forma distinta según el plan.]**

## E. Medidas de seguridad generales
Separación por empresa (cliente_id verificado desde la sesión; pruebas automáticas y revisión contra producción), contraseñas con hash, bloqueo por intentos, HTTPS, credenciales de integraciones cifradas, registro de acciones, respaldo nocturno, purga automática (A3–A5), exportación y baja de empresa, `/api/health` y vigilancia.

## F. Pendientes para completar este registro
1. Fijar y escribir los plazos marcados [definir] (A2, A6, A7).
2. Confirmar país de R2 y del servidor.
3. Confirmar días de retención de los respaldos.
4. Verificar para cada proveedor de IA si guarda o entrena con los datos y bajo qué plan.
5. Nombrar a la persona responsable de privacidad.
