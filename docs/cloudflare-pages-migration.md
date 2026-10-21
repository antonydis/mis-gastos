# Migración de la web a Cloudflare Pages

**Estado:** archivos preparados para Cloudflare Pages. La creación del proyecto y el primer despliegue requieren acceso al panel de Cloudflare. No cambiar GitHub a privado ni desactivar GitHub Pages antes de verificarlo.

## Crear el proyecto
1. [Cloudflare dashboard → Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → Create application → **Pages** → Connect to Git.
2. Autorizar GitHub y seleccionar el repositorio `antonydis/mis-gastos`. El repositorio podrá ser privado tras verificar la integración.
3. Configurar:
   - **Project name:** `mis-gastos-web` (si está disponible).
   - **Production branch:** `main`.
   - **Framework preset:** None.
   - **Root directory:** raíz del repositorio.
   - **Build command:** `node scripts/build-pages.mjs`.
   - **Build output directory:** `dist`.
4. Desplegar y conservar la dirección `https://<nombre-asignado>.pages.dev` real, no inventar URL.
5. Verificar que cargan la página, estilos, Google, registro, fotos/audio, service worker, imports de módulos y formulario del piloto.

## Cambiar frontend permitido por el Worker
El Worker ahora restringe CORS a la dirección `FRONTEND_URL` configurada en `wrangler.jsonc`, actualmente GitHub Pages. Para que la aplicación en Pages pueda llamar a su API, tras conocer la URL real de Pages:
1. Cambiar `FRONTEND_URL` en `wrangler.jsonc` al origen exacto de Cloudflare Pages.
2. Desplegar el Worker y validar peticiones `OPTIONS` y `POST` desde Pages.
3. Si es necesario un periodo de convivencia entre hosts, implementar una allowlist explícita de ambos orígenes; nunca abrir CORS indiscriminadamente.

## Cambiar configuraciones de Google
Comprobar Google OAuth **Authorized JavaScript origins** y **Authorized redirect URIs** según los flujos web actuales, y agregar la dirección Pages si aplica. El callback de Telegram pertenece al Worker y no debe cambiarse por rutina.

## Antes de hacer privado el repositorio
- [ ] URL Pages abre correctamente desde navegador privado y dispositivo móvil.
- [ ] Frontend habla con Worker y cuenta Google autorizada.
- [ ] No se han publicado archivos internos, secretos, base de datos ni módulos de servidor.
- [ ] Formulario piloto verificado extremo a extremo, incluida notificación.
- [ ] El repositorio mantiene conexión Git y despliega al hacer push.
- [ ] Enlaces compartidos y referencia de Notion actualizados.
- [ ] Solo entonces cambiar visibilidad en GitHub.

**No desactivar el Worker `mis-gastos`: es otro deployment, independiente de Pages.**
