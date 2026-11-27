# Borradores legales de LICITANK — léeme primero

**Estado: BORRADORES TÉCNICOS. No son asesoría legal.** Los redactó el equipo técnico a partir de lo que el sistema hace de verdad, para que un abogado los revise, corrija y los deje listos antes de la **Ley N° 21.719 (vigente desde 2026-12-01)**. Nada de esto se debe firmar ni publicar sin esa revisión. Las referencias a la ley están sin números de artículo a propósito: las completa el abogado.

## Qué hay en esta carpeta

| Archivo | Para qué sirve | Quién lo usa |
|---|---|---|
| `contrato-servicio-licitank.md` | Contrato de servicio (SaaS) con cada empresa-cliente, con anexos: plan y precio, tratamiento de datos (LICITANK como encargado), proveedores, nivel de servicio | Se firma con cada empresa que compra |
| `registro-actividades-tratamiento.md` | Inventario de qué datos personales se tratan, para qué, dónde, cuánto tiempo y con quién | Interno; se muestra a la Agencia si lo pide |
| `procedimientos-derechos-y-brechas.md` | Qué hacer cuando alguien pide sus datos (acceso, borrado…) y cuando hay una brecha de seguridad | Interno (equipo de LICITANK) |

Ya existen publicadas, también como borrador: `/privacidad` y `/terminos` (código en `app/privacidad` y `app/terminos`; los datos de quien opera salen de `LEGAL_*` en el `.env`).

## Lo que tiene que decidir el dueño (no lo puede inventar el abogado ni yo)

1. **Quién es la persona jurídica que vende LICITANK** (razón social, RUT, domicilio, representante). Hoy las páginas públicas muestran «[por completar]». Se completan con `LEGAL_RAZON_SOCIAL`, `LEGAL_RUT`, `LEGAL_DOMICILIO`, `LEGAL_CORREO_PRIVACIDAD` en el `.env` del VPS.
2. **Un correo real para privacidad** (ej. `privacidad@…`) que alguien lea. Hoy no existe buzón.
3. **Precio, plazos de pago, duración y renovación** (Anexo A del contrato).
4. **Nivel de servicio que está dispuesto a prometer** (Anexo D): hoy es un servidor, una base de datos, sin réplica. No prometer más de lo que hay.
5. **Plazos de conservación** (hoy: claves de recuperación 7 días; actividad 18 meses; historial 24 meses; resto mientras el servicio esté activo).
6. **Tope de responsabilidad** (cláusula 12 del contrato): propuesta de partida, el abogado la ajusta.

## Cosas del sistema que el abogado debe conocer (y que el contrato ya reconoce)

- **Dos roles.** Los datos de las cuentas de usuario y el uso de la plataforma: LICITANK es **responsable**. Lo que cada empresa carga (licitaciones, costeos, anexos, cotizaciones, documentos, su equipo): la empresa es **responsable** y LICITANK es **encargado**.
- **Inteligencia artificial de terceros.** Textos de documentos se envían a proveedores de IA para leerlos: Z.AI (GLM), Moonshot (Kimi), Google (Gemini) y DeepSeek, según la tarea. Parte de ese procesamiento ocurre **fuera de Chile**. Hay que decidir si se avisa por proveedor y si se pide a los clientes aceptar este punto expresamente (el contrato lo hace en el Anexo B).
- **WhatsApp no oficial.** Los avisos por WhatsApp usan una conexión no oficial (dispositivo vinculado por QR). **WhatsApp puede bloquear el número.** Es opcional, apagado por defecto, y el contrato lo deja como «mejor esfuerzo» sin garantía.
- **Documentos públicos y de terceros.** Las bases y órdenes de compra de Mercado Público son información pública; los documentos que sube cada empresa (cotizaciones, fichas, facturas) pueden traer datos de contacto de personas de proveedores.
- **Separación entre empresas.** Cada empresa ve solo lo suyo (separación por cliente en la base y revisada en cada petición); hay pruebas automáticas y una revisión contra producción de solo lectura. Un dato mal separado se trata como **brecha**: ver el procedimiento.
- **Salida y borrado.** La empresa puede **exportar sus datos** desde *Mi empresa* (todo en un archivo, sin claves), y LICITANK puede **dar de baja** una empresa: exporta, borra datos y archivos y deja una línea de bitácora. Los archivos en R2 compartidos con otra empresa no se borran.
- **Respaldos.** Hay un respaldo nocturno de la base de datos. El contrato dice que lo borrado sale de los respaldos «al cumplirse el ciclo»; **falta fijar y documentar cuántos días se guardan** (el equipo debe confirmarlo en el VPS).

## Diferencias entre lo publicado y la realidad (para corregir en `/privacidad`)

- La política nombra a Z.AI y Moonshot «y otros»; en la práctica también se usan **Google (Gemini)** y **DeepSeek**. Conviene listarlos.
- La política dice que Cloudflare R2 guarda archivos; no dice en qué país. Averiguarlo y escribirlo.
- Falta el correo real de privacidad y el formulario de derechos (hoy solo un correo).
- No hay aún aviso de que la conexión de WhatsApp es no oficial (está en el contrato, no en la política).

## Pendientes técnicos que cambian lo legal

- Cifrado de respaldos y retención de respaldos: confirmar.
- Procedimiento de brechas: debe haber alguien de turno con nombre (ver el procedimiento).
- Cambiar la clave de la casilla `licitaciones@` (comprometida el 2026-11-04; ver `docs/memoria/infra.md`). Fue un incidente real: el abogado debe saberlo. Lo registrado es que desde una IP ajena se envió spam por esa casilla; **no consta** que se hayan expuesto datos de clientes, pero eso hay que confirmarlo antes de afirmarlo.
