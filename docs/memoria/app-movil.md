# App móvil (Android primero, Expo)

## 2026-11-09 — Fase 0: proyecto creado y backend acepta Bearer
Decisión del dueño: app móvil de LICITANK en **Expo (React Native) + TypeScript**, solo Android por ahora (iOS después con el mismo código). Vive en un repo aparte, `D:\licitank-mobile`; el backend sigue SOLO en este repo y la app consume su API. **Compras queda fuera**; solo se reconsidera una versión de solo lectura cuando la app esté estable.

Módulos a pasar (pedido del dueño): licitaciones públicas, Dashboard, Negocios, Aprobaciones, Postuladas, Ganadas/Perdidas, Proveedores (menú → `/compras/proveedores`, catálogo de a quién se le compra), Radar, Buscador, Puente, Usuarios, Avisos por WhatsApp, Errores reportados. Plan por fases: 0 preparación, 1 núcleo (login/permisos), 2 operación (Dashboard, licitaciones, Radar, Negocios, Aprobaciones), 3 seguimiento (Postuladas, Ganadas/Perdidas, Proveedores, Puente, Usuarios), 4 avisos (push FCM, WSP, errores), 5 QA y Play Store.

Cambios en este repo (solo lo necesario):
- `app/lib/auth-edge.ts`: nuevo `tokenDeRequest()`; `getSessionFromRequest` acepta la cookie (web) o `Authorization: Bearer` (app). Con eso `proxy.ts` y `getAuthedUser` funcionan igual para la app.
- `app/api/auth/login/route.ts`: si llega el header `x-cliente-app: movil`, devuelve además `token` en el cuerpo (la web sigue igual, con cookie).
- `app/api/auth/me/route.ts`: lee el token con `tokenDeRequest`.

**Regla / decisión:** la URL del servidor sale de `EXPO_PUBLIC_API_URL` (nada fijo en el código; cada empresa su despliegue). El token se guarda en SecureStore. Las acciones que firman/aprueban/confirman las hace el equipo; la app parte en solo lectura.
**Verificado:** la app compila (`tsc`, `expo-doctor` 20/20, `expo export --no-bytecode`); con el servidor local un Bearer inválido da `autenticado:false` y 401 en `/api/dashboard`, y el login móvil con clave mala responde 401. NO verificado: login real con un usuario (falta probar con credenciales del dueño), emulador/teléfono (este PC no tiene Android SDK), el paso a Hermes de `expo export` falla aquí con `spawn UNKNOWN` (solo ese PC).
**Pendiente:** token de 7 días sin refresh (revisar en Fase 1); otras rutas que lean la cookie directo (`auth/perfil`, `auth/logout`, `ia-uso.ts`) aún no aceptan Bearer; mapa de permisos/módulos por pantalla móvil; cuenta de Firebase para push (Fase 4, el dueño no tiene).
