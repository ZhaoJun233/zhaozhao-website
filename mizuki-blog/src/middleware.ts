import { defineMiddleware } from "astro:middleware";
import { authenticateAdminSession, readAdminSessionToken } from "./lib/admin/auth";
import { getContentDatabase } from "./lib/database/content-repository";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (!path.startsWith("/admin")) return next();
  const authenticated = Boolean(authenticateAdminSession(
    getContentDatabase(),
    readAdminSessionToken(context.request),
  ));
  if (path === "/admin/login/" || path === "/admin/login") {
    return authenticated ? context.redirect("/admin/") : next();
  }
  return authenticated ? next() : context.redirect("/admin/login/");
});
