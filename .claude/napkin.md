# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

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

1. **[2026-05-26] MP WAF blocks all non-Chilean IPs — no auto-download from Vercel**
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

## Shell & Command Reliability

1. **[2026-05-26] PowerShell heredoc for git commit on Windows**
   Do instead: use Bash tool (not PowerShell) for `git commit -m "$(cat <<'EOF'...EOF)"` heredoc syntax. PowerShell @'...'@ works but Bash heredoc is cleaner for multiline messages.
