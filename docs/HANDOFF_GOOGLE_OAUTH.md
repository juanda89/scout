# Handoff: terminar Google OAuth, políticas y publicación de la app

> Estado 2026-10-22: partes A, B y C completadas (credenciales desplegadas, /privacy y /terms publicadas, app en producción en la consola de Google). Queda la parte D (lista de correos de la agencia) y rellenar `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL` y `LEGAL_JURISDICTION` en `.env.prod`.

Para el agente que tiene el JSON del cliente OAuth de Google. Objetivo: que el sign-in de Scout funcione con "Continue with Google" en producción, que existan páginas públicas de Política de privacidad y Términos, y que la app de Google esté publicada (no en modo Testing).

## Contexto en 60 segundos

- Repo: https://github.com/juanda89/scout (rama `main`). Monorepo: `apps/web` (Next.js 16, Auth.js v5), `apps/worker`, `packages/core`. Runbook de despliegue: `docs/DESPLIEGUE.md`.
- Producción de pruebas: **https://dvize5gk9sjfs.cloudfront.net** (CDN de Lightsail) → instancia Lightsail `100.63.14.124` con Docker Compose (db, web, worker).
- Secretos de producción: archivo `.env.prod` en la raíz del checkout de esta máquina (`/Users/mm/Desktop/scoutting`). Está en `.gitignore`. **Nunca** lo commitees ni pegues su contenido en el chat.
- Redesplegar: `./deploy/lightsail/deploy.sh 100.63.14.124 .env.prod` (necesita `~/.ssh/scout-lightsail.pem`, ya presente en esta máquina). Tarda 1 a 3 minutos si no cambió código; hasta 10 si hay que reconstruir imágenes.
- Auth: `apps/web/auth.ts`. Con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` presentes aparece el botón de Google; con `DEV_LOGIN=0` desaparece el acceso temporal por código. `ALLOWED_EMAILS` (lista separada por comas) o `ALLOWED_DOMAIN` deciden quién entra aunque tenga cuenta de Google.

## Parte A · Credenciales en la app (5 min)

1. Del JSON descargado toma `client_id` y `client_secret` (están dentro de `web`).
2. Edita `.env.prod` y deja estas líneas (añádelas si no existen, sustituye si existen):
   ```
   GOOGLE_CLIENT_ID=<client_id>
   GOOGLE_CLIENT_SECRET=<client_secret>
   DEV_LOGIN=0
   ```
   Opcional: las mismas dos variables en el `.env` local para probar en `http://localhost:3000`.
3. Comprueba que el cliente OAuth tiene registrados exactamente estos redirect URIs (en la consola: Google Auth Platform → Clients → Scout web):
   - `https://dvize5gk9sjfs.cloudfront.net/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
   Y como orígenes JavaScript autorizados: `https://dvize5gk9sjfs.cloudfront.net` y `http://localhost:3000`.
4. Redespliega: `./deploy/lightsail/deploy.sh 100.63.14.124 .env.prod`.
5. Verifica en el navegador: `https://dvize5gk9sjfs.cloudfront.net/signin` debe mostrar solo "Continue with Google" (sin campo de código). Inicia sesión con un correo que esté en `ALLOWED_EMAILS` y confirma que llegas a `/scoutings`. Un correo fuera de la lista debe volver a `/signin?error=AccessDenied`.

## Parte B · Páginas de Política de privacidad y Términos (20 min)

Hoy los enlaces "Terms" y "Privacy Policy" del sign-in apuntan a `#`. Hay que crear las páginas y enlazarlas.

1. Crea `apps/web/app/privacy/page.tsx` y `apps/web/app/terms/page.tsx`. Son Server Components públicos (no uses `requireViewer`). Usa el mismo lienzo que el resto: `Shell` de `@/components/Shell`, un `<main>` de ancho máximo 720 px, tipografía heredada, títulos con `letterSpacing: -0.02em`. Idioma: inglés, como el resto de la interfaz.
2. Contenido mínimo de la política de privacidad, adaptado a lo que la app hace de verdad:
   - Responsable: la agencia (nombre y correo de contacto; pídeselos al usuario si no los tienes, no los inventes).
   - Datos de los usuarios de la app: correo, nombre y foto de perfil de Google, solo para autenticación y para saber quién lanzó cada scouting. No se venden ni se comparten.
   - Datos de creadoras: la app analiza **contenido público** de Instagram, TikTok y YouTube (bio, publicaciones, métricas públicas) y datos de audiencia agregados de un proveedor externo (CreatorDB), para evaluar el encaje con briefs de marcas. Se guardan hechos extraídos con su evidencia (cita y fecha de la publicación). Sobre menores solo se registran rangos de edad; nunca nombres, imágenes ni descripciones.
   - Proveedores que procesan datos: Google (identidad), Amazon Web Services (alojamiento, us-east-1), OpenRouter/Google Gemini y TypeSafe (clasificación de texto), Apify (recolección de contenido público), CreatorDB (datos de audiencia).
   - Conservación: mientras la cuenta de la agencia esté activa; eliminación bajo petición al correo de contacto. Derechos de acceso, rectificación y supresión.
   - Cookies: solo la cookie de sesión de autenticación.
   - Fecha de última actualización.
3. Términos: uso interno por agencias autorizadas, prohibición de uso para fines distintos al scouting de campañas, sin garantía de exactitud de los puntajes (son estimaciones a partir de datos públicos), limitación de responsabilidad, ley aplicable (pregunta al usuario el país; no lo inventes).
4. En `apps/web/app/signin/page.tsx` cambia los dos `href="#"` por `href="/terms"` y `href="/privacy"`.
5. Añade `/privacy` y `/terms` al pie de la cabecera o deja solo los enlaces del sign-in; no es obligatorio más.
6. `cd apps/web && npx tsc --noEmit`, commit, push a `main` y redespliega. Verifica que `https://dvize5gk9sjfs.cloudfront.net/privacy` y `/terms` abren sin sesión.

## Parte C · Consola de Google: marca, políticas y publicación (15 min)

Todo en https://console.cloud.google.com → proyecto `Scout` → buscador "Google Auth Platform".

1. **Branding**: nombre `Scout`, correo de soporte, logo opcional (el icono está en `apps/web/app/icon.svg`; Google pide PNG/JPG de 120×120, conviértelo si lo subes). Enlaces: homepage `https://dvize5gk9sjfs.cloudfront.net`, privacidad `.../privacy`, términos `.../terms`.
   - **Aviso importante**: Google solo acepta enlaces cuyo dominio esté en "Authorized domains", y para añadir un dominio hay que verificarlo en Search Console. `cloudfront.net` no se puede verificar porque no es nuestro. Si la consola rechaza los enlaces, hay dos salidas: (a) dejar los enlaces vacíos por ahora (para los scopes básicos de correo y perfil Google permite publicar sin ellos) y anotarlo como pendiente hasta tener dominio propio; o (b) publicar las dos páginas también en un dominio verificable, por ejemplo GitHub Pages del usuario, verificarlo en Search Console y usar esas URLs. No intentes verificar `cloudfront.net`.
2. **Data access** (scopes): solo `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`. No añadas scopes sensibles ni restringidos; con estos tres no hace falta verificación de Google.
3. **Audience**: si el tipo es External y está en "Testing", pulsa **Publish app** y confirma. Con solo scopes básicos pasa a "In production" de inmediato, sin revisión. Si la consola exige verificación es porque hay algún scope sensible o un enlace en dominio no autorizado: corrige lo anterior en vez de iniciar la verificación.
   - Si el tipo es Internal (Google Workspace), no hay nada que publicar: ya entra cualquier cuenta del dominio que además esté en `ALLOWED_EMAILS` o `ALLOWED_DOMAIN`.
4. Vuelve a probar el inicio de sesión en una ventana de incógnito: la pantalla de permiso debe decir "Scout" y no debe aparecer el aviso de "app no verificada".

## Parte D · Lista de acceso

- Pide al usuario los correos de la agencia que deben entrar y ponlos en `ALLOWED_EMAILS` de `.env.prod` separados por comas, o si todos comparten dominio de Workspace usa `ALLOWED_DOMAIN=miagencia.com` y deja `ALLOWED_EMAILS` vacío. Redespliega.

## Reglas

- Secretos solo en `.env.prod` y `.env`; nunca en commits, en el chat ni en capturas.
- No cambies la infraestructura (instancia, CDN, base de datos) ni el pipeline del motor; este trabajo es solo auth, páginas legales y consola de Google.
- Si algo del flujo de Google pide un pago, una verificación formal o un dominio, para y repórtalo: es una decisión del usuario.
- Al terminar, reporta: URL de privacidad y términos, estado de la app en Google (Testing o In production), y qué correos quedaron en la lista de acceso.
