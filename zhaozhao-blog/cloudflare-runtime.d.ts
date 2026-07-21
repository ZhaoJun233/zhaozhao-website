type D1Value = null | number | string | ArrayBuffer;

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown> & { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T extends unknown[] = unknown[]>(): Promise<T[]>;
}

interface D1DatabaseSession {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1Database extends D1DatabaseSession {
  exec(query: string): Promise<D1Result>;
  withSession(constraint?: "first-primary" | "first-unconstrained"): D1DatabaseSession;
}

interface KVNamespaceGetWithMetadataResult<Value, Metadata> {
  value: Value | null;
  metadata: Metadata | null;
  cacheStatus: string | null;
}

interface KVNamespace {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "arrayBuffer",
  ): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer, Metadata>>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { metadata?: unknown; expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}

declare namespace Cloudflare {
  interface Env {
    ADMIN_PASSWORD: string;
    ADMIN_SESSION_SECRET: string;
    /** Turnstile 服务端校验密钥，仅生产通过 wrangler secret 配置；未配置时跳过校验。 */
    TURNSTILE_SECRET_KEY?: string;
    /** 置 1 时关闭公共页面 HTML 短缓存（本地开发 / e2e 使用）。 */
    HTML_CACHE_DISABLED?: string;
  }
}
