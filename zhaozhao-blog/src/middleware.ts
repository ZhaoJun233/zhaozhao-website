import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { authenticateAdminSession, readAdminSessionToken } from "./lib/admin/auth";
import { getDatabase } from "./lib/cloudflare/bindings";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (
    path.startsWith("/media/uploads/")
    && /\.(?:gif|jpe?g|png|webp)$/i.test(path)
  ) {
    const canonical = new URL(context.url);
    canonical.pathname = `${path}/`;
    return context.redirect(canonical.toString(), 308);
  }
  if (!path.startsWith("/admin")) return next();
  const authenticated = Boolean(await authenticateAdminSession(
    getDatabase(),
    readAdminSessionToken(context.request),
    undefined,
    env.ADMIN_SESSION_SECRET,
  ));
  if (path === "/admin/login/" || path === "/admin/login") {
    return authenticated ? context.redirect("/admin/") : next();
  }
  return authenticated ? next() : context.redirect("/admin/login/");
});
