const LOCAL_SITE_URL = "http://localhost:4321";

export function resolveSiteUrl(
  environment: Record<string, string | undefined>,
): string {
  const configured = environment.PUBLIC_SITE_URL?.trim();

  if (environment.BUILD_MODE === "production" && !configured) {
    throw new Error("PUBLIC_SITE_URL is required when BUILD_MODE=production.");
  }

  const value = configured || LOCAL_SITE_URL;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PUBLIC_SITE_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}
