export function buildSiteRedirect(
  requestUrl: URL,
  canonicalSiteUrl: string | undefined,
  legacySiteUrl: string | undefined,
  requestHost?: string | null,
): URL | undefined {
  if (!canonicalSiteUrl) return undefined;
  const normalizedHost = requestHost?.toLowerCase();
  const incomingHost = normalizedHost?.startsWith("[")
    ? normalizedHost.slice(1, normalizedHost.indexOf("]"))
    : normalizedHost?.split(":", 1)[0];
  if (incomingHost && ["localhost", "127.0.0.1", "::1"].includes(incomingHost)) {
    return undefined;
  }

  const canonical = new URL(canonicalSiteUrl);
  if (canonical.protocol !== "https:") return undefined;
  const legacy = legacySiteUrl ? new URL(legacySiteUrl) : undefined;
  const isLegacyHost = legacy?.hostname === requestUrl.hostname;
  const isCanonicalHttp = requestUrl.hostname === canonical.hostname
    && requestUrl.protocol === "http:";
  if (!isLegacyHost && !isCanonicalHttp) return undefined;

  const redirect = new URL(requestUrl);
  redirect.protocol = canonical.protocol;
  redirect.hostname = canonical.hostname;
  redirect.port = canonical.port;
  return redirect;
}
