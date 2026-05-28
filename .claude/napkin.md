# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## App Layout & Navigation (Added 2026-05-27)

1. **[2026-05-27] AppLayout reemplaza Navbar en todas las páginas autenticadas**
   Do instead: Usar `<AppLayout breadcrumb={[...]}>` en todas las páginas. Navbar.tsx ya no se usa en páginas internas. La Navbar vieja sigue existiendo solo para referencia.

2. **[2026-05-27] Sidebar navigation: /dashboard es la home, no /**
   Do instead: Middleware redirige `/login` con sesión → `/dashboard`. El buscador está en `/` pero el landing post-login es `/dashboard`. Los nav items del Sidebar en AppLayout.tsx son la fuente de verdad de la navegación.

## Auth Architecture (Added 2026-05-27)

1. **[2026-05-27] Auth: Custom JWT + MySQL (NO Supabase auth, NO NextAuth)**
   Do instead: bcryptjs + jose JWT + HTTP-only cookie `licitapyme_session`. `app/lib/auth.ts` = fuente de verdad. Middleware en `/middleware.ts` verifica token en TODAS las rutas excepto `/login`, `/registro`, `/api/auth/*`.

2. **[2026-05-27] JWT_SECRET debe estar en .env.local y en Vercel env vars**
   Do instead: Sin JWT_SECRET el servidor tira excepción al arrancar. Ya configurado en .env.local. En Vercel, agregar como env var. Contraseña admin inicial: `Ica2026Admin!` (cambiar tras primer login).

3. **[2026-05-27] useSession() para obtener usuario en cualquier Client Component**
   Do instead: `import { useSession } from '@/app/lib/session-context'`. SessionProvider wrappea todo en layout.tsx. Llama `/api/auth/me` una vez al montar para hidratar la sesión.

4. **[2026-05-27] Session must flow to favorites and documents**
   Do instead: SQL migration `docs/migration-auth.sql` agrega `usuario_id` a `favoritos` y `documentos_cache`. Ejecutar en Bluehost antes de activar auth en prod.

## Domain Behavior Guardrails (Highest Priority)

1. **[2026-05-27] MP API has NO `buscar` text-search parameter — HTTP 400 if used**
   Do instead: call `getMercadoPublicoClient().obtenerUltimosDias(7)` to download all recent licitaciones, then filter locally with `texto.includes(keyword)`. This is how `app/api/search/route.ts` works. The cron `app/api/cron/alertas/route.ts` was rewritten to use this approach.

2. **[2026-05-27] MySQL 5.7 (Bluehost) has no `NULLS FIRST` / `NULLS LAST` syntax**
   Do instead: use `ORDER BY ISNULL(col) DESC, col ASC` — works in MySQL 5.7 and 8+.

3. **[2026-05-26] MP WAF blocks all non-Chilean IPs — no auto-download from Vercel**
   Do instead: use the manual upload flow (user downloads from MP with Chilean IP → drags to SubirDocumentos → saved to R2). Never add scraping or proxy code that fetches MP attachment URLs from Vercel.

2. **[2026-05-26] MP official API does NOT return document attachments**
   Do instead: rely solely on documentos_cache DB table. The `licitaciones.json` API endpoint omits `Documentos.Listado` entirely — this is a permanent API limitation.

3. **[2026-05-26] documentosCache is the single source of truth for documents**
   Do instead: merge uploaded docs into `documentosCache` via `handleDocsSubidos`. Do not maintain separate `documentosAPI` or `documentosSubidos` state arrays.

4. **[2026-05-26] R2 public URL prefix: `https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev`**
   Do instead: when checking if a doc URL is "ours" (R2), check for this prefix. `esUrlAnalizable` checks for `https://` start and PDF/DOCX extension — both conditions needed.

## Execution & Validation

1. **[2026-05-26] Run `npx tsc --noEmit` after every code change**
   Do instead: always run tsc before committing. No output = clean. Errors must be fixed before pushing.

2. **[2026-05-26] Next.js 15 route params are async Promises**
   Do instead: always `const { param } = await params;` in route handlers — `params` is `Promise<{...}>` not a plain object.

## Architecture Notes

1. **[2026-05-26] DB: MySQL on Bluehost via `app/lib/db.ts` pool**
   Do instead: import `pool` from `@/app/lib/db` for all DB queries. Table for documents: `documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, created_at)`.

2. **[2026-05-26] `/api/documentos/cache/[codigo]` vs `/api/documentos/[codigo]` are now identical**
   Do instead: use `/api/documentos/cache/[codigo]` as the canonical endpoint. Both read from `documentos_cache`. The `[codigo]` route was simplified to cache-only in the 2026-05-26 refactor.

3. **[2026-05-26] `auto-descargar` endpoint is a stub — always returns success:false**
   Do instead: never call this endpoint expecting real downloads. It only returns the MP ficha URL for the user to open manually.

## Design System

1. **[2026-05-27] Toast system: `useToast()` hook de `app/components/ui/toast.tsx`**
   Do instead: `const { success, error, warning, info } = useToast()` — nunca usar `alert()` ni banners inline. ToastProvider está en `app/layout.tsx` sobre SessionProvider.

2. **[2026-05-27] Sidebar color: `bg-[#0f1117]`, nav activo: `bg-white/[0.09]` + accent izquierdo azul**
   Do instead: sidebar siempre `#0f1117`, items activos con `border-l-[3px] border-l-blue-500` + `bg-white/[0.09] text-white`. Dropdown del usuario es oscuro `bg-[#18181b] border-zinc-800`.

3. **[2026-05-27] Cards con `hover:-translate-y-px hover:shadow-md transition-all duration-200`**
   Do instead: todas las cards usan esta clase. Unread cards: `border-l-[3px] border-l-blue-500`. Bordes: `border-zinc-200`.

4. **[2026-05-27] Animations disponibles en globals.css: fade-in, scale-in, slide-in-right, slide-in-up, skeleton**
   Do instead: usar clases CSS directas. Modales: `scale-in`. Toasts: `slide-in-right`. Bottom sheets: `slide-in-up`. Skeletons: `skeleton`.

## Radar / Cron

1. **[2026-05-28] Cron uses both `obtenerActivasHoy()` + `obtenerUltimosDias(15)` for full coverage**
   Do instead: always combine both — `obtenerActivasHoy()` catches licitaciones published >15 days ago that are still open; `obtenerUltimosDias(15)` catches very recent ones. Deduplicate by Codigo before processing.

2. **[2026-05-28] `INSERT IGNORE` is the accumulation mechanism — never DELETE before INSERT in cron**
   Do instead: alertas_licitaciones uses a UNIQUE key on (usuario_id, licitacion_codigo). `INSERT IGNORE` skips known ones, adds new ones. This is how today's 156 + tomorrow's new 50 = 206.

3. **[2026-05-28] alertas API returns `leida ASC, created_at DESC` — unread first**
   Do instead: ORDER BY leida ASC (0=unread first), THEN created_at DESC within each group.

## Pipeline & Negocios

1. **[2026-05-28] `estado_pipeline` must be in negocios list SELECT or it always shows "1ASIGNADO"**
   Do instead: `SELECT COALESCE(n.estado_pipeline, '1ASIGNADO') AS estado_pipeline` in `app/api/negocios/route.ts` GET query. The detail query had it; the list query was missing it.

2. **[2026-05-28] Pipeline column missing = DB migration not run; surface it explicitly**
   Do instead: wrap `UPDATE negocios SET estado_pipeline` in try-catch; if error includes `unknown column`, return `{ migration_needed: true, status: 503 }`. Client checks `data.migration_needed` and shows toast with SQL file name.

2. **[2026-05-28] Comment + pipeline state auto-updates negocio state**
   Do instead: POST to `/api/negocios/[id]/comentarios` with `{ comentario, pipeline_estado }`. API inserts comment AND updates `negocios.estado_pipeline`. Returns `{ nuevo_estado }` — client calls `onEstadoChanged` to sync UI.

3. **[2026-05-28] DB migrations required for pipeline features**
   Do instead: run `docs/migration-4-pipeline.sql` (adds `estado_pipeline` to negocios) and `docs/migration-5-comentarios-pipeline.sql` (adds `pipeline_estado` to comentarios_negocio) in Bluehost phpMyAdmin before testing.

## Licitacion Detail Page

1. **[2026-05-28] `/api/licitacion-detalle/[codigo]` is the only correct source for detail page**
   Do instead: `GET /api/licitacion-detalle/[codigo]` → calls `client.obtenerPorCodigo()` → returns `{success, licitacion: Oportunidad, licitacion_raw: Licitacion}`. Never use `/api/search` or `/api/licitacion-completa` (cheerio scraper — blocked by MP WAF from Vercel).

2. **[2026-05-28] `licitacion.estado` is a numeric string ("5", "6"...) NOT the name**
   Do instead: `ESTADO_CONFIG["5"]` → "Publicada". The `normalizar()` function sets `Estado = String(item.CodigoEstado || 5)`. Use `licitacion.estado` to look up badge config.

3. **[2026-05-28] Check `isFavorite(codigo)` BEFORE calling `toggleFavorite`**
   Do instead: `const wasFav = isFavorite(codigo); await toggleFavorite(...); toast(wasFav ? 'Eliminado' : 'Agregado')`. The return value of `toggleFavorite` is `true` for both add AND remove.

4. **[2026-05-28] Admin "Asignar a negocio" fetches /api/usuarios then POSTs /api/negocios**
   Do instead: Modal fetches `GET /api/usuarios` (returns `{success, usuarios}`), then `POST /api/negocios` with all licitacion fields + `asignado_a`. Middleware injects auth headers automatically.

## Tipo Licitación

1. **[2026-05-28] All tipo codes live in `app/lib/tipos-licitacion.ts` — single source of truth**
   Do instead: `import { TIPOS_LICITACION, extractTipoFromCodigo, TIPO_COLOR_CLASS } from '@/app/lib/tipos-licitacion'`. Never hardcode tipo lists in individual pages.

2. **[2026-05-28] `extractTipoFromCodigo` regex handles L1, O1, CA, etc.**
   Do instead: regex `/-([A-Za-z]{1,2}[0-9]?)\d{2}[a-z]?$/i` — captures `L1` from `L126`, not just `L`. Old regex `-([A-Za-z]+)\d+` would fail on two-char codes like L1, O1.

## Shell & Command Reliability

1. **[2026-05-26] PowerShell heredoc for git commit on Windows**
   Do instead: use Bash tool (not PowerShell) for `git commit -m "$(cat <<'EOF'...EOF)"` heredoc syntax. PowerShell @'...'@ works but Bash heredoc is cleaner for multiline messages.

2. **[2026-05-28] Response.json() can only be called once per Response**
   Do instead: `const jsonResults = await Promise.all(responses.map(r => r.json()))` — consume ALL responses in one pass, then index into `jsonResults[0]`, `[1]`, `[2]`. Never call `.json()` on the same Response a second time.
