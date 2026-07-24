import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { authenticateAdminSession, readAdminSessionToken } from "./lib/admin/auth";
import { getDatabase } from "./lib/cloudflare/bindings";
import { buildSiteRedirect } from "./lib/https";

export const onRequest = defineMiddleware(async (context, next) => {
  const siteRedirect = env.HTML_CACHE_DISABLED
    ? undefined
    : buildSiteRedirect(
      context.url,
      env.PUBLIC_SITE_URL,
      env.LEGACY_SITE_URL,
      context.request.headers.get("host"),
    );
  if (siteRedirect) return context.redirect(siteRedirect.toString(), 308);

  const path = context.url.pathname;
  if (
    path.startsWith("/media/uploads/")
    && /\.(?:gif|jpe?g|png|webp)$/i.test(path)
  ) {
    const canonical = new URL(context.url);
    canonical.pathname = `${path}/`;
    return context.redirect(canonical.toString(), 308);
  }
  if (!path.startsWith("/admin")) {
    const response = await next();
    if (
      context.request.method === "GET"
      && !path.startsWith("/api")
      && !env.HTML_CACHE_DISABLED
      && response.headers.get("content-type")?.includes("text/html")
    ) {
      // 公共页面 HTML 短缓存：预取结果可直接复用，客户端导航与边缘回源都走缓存。
      // 本地开发 / e2e 通过 .dev.vars 的 HTML_CACHE_DISABLED=1 关闭，避免陈旧页面。
      response.headers.set("Cache-Control", "public, max-age=30");
    }
    return response;
  }
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
