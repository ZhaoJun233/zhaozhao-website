const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileSiteverifyResult {
  success?: boolean;
}

/**
 * 校验 Cloudflare Turnstile token。
 * 未配置 TURNSTILE_SECRET_KEY 时视为功能未启用（本地开发 / e2e），直接放行；
 * 配置了密钥则必须携带有效 token，siteverify 不可达或校验失败一律拒绝。
 */
export async function verifyTurnstileToken(
  secret: string | undefined,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!secret?.trim()) return true;
  if (!token) return false;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp && remoteIp !== "local" ? { remoteip: remoteIp } : {}),
      }),
    });
    if (!response.ok) return false;
    const result = await response.json() as TurnstileSiteverifyResult;
    return result.success === true;
  } catch {
    return false;
  }
}
