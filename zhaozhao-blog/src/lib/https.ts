export function buildHttpsRedirect(
  requestUrl: URL,
  canonicalSiteUrl: string | undefined,
): URL | undefined {
  if (!canonicalSiteUrl || requestUrl.protocol !== "http:") return undefined;

  const canonical = new URL(canonicalSiteUrl);
  if (canonical.protocol !== "https:" || requestUrl.hostname !== canonical.hostname) {
    return undefined;
  }

  const redirect = new URL(requestUrl);
  redirect.protocol = "https:";
  redirect.port = canonical.port;
  return redirect;
}
