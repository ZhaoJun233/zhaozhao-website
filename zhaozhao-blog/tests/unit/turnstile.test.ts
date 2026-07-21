import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "../../src/lib/turnstile";

describe("verifyTurnstileToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes through without calling siteverify when no secret is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstileToken(undefined, "")).resolves.toBe(true);
    await expect(verifyTurnstileToken("", "some-token")).resolves.toBe(true);
    await expect(verifyTurnstileToken("   ", "some-token")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty token without calling siteverify when a secret is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstileToken("secret", "")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts when siteverify confirms the token", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstileToken("secret", "valid-token", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toContain("secret=secret");
    expect(String(init.body)).toContain("response=valid-token");
    expect(String(init.body)).toContain("remoteip=1.2.3.4");
  });

  it("rejects when siteverify reports failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ success: false, "error-codes": ["invalid-input-response"] })));
    await expect(verifyTurnstileToken("secret", "bad-token")).resolves.toBe(false);
  });

  it("rejects when siteverify responds with an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(verifyTurnstileToken("secret", "token")).resolves.toBe(false);
  });

  it("rejects when the siteverify request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network unreachable");
    }));
    await expect(verifyTurnstileToken("secret", "token")).resolves.toBe(false);
  });
});
