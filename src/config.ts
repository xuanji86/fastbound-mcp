/**
 * Configuration loaded from environment variables.
 *
 * Secrets (the API key) live only here and in the client's Authorization header.
 * They are never logged. `loadConfig` throws a precise, secret-free error when a
 * required variable is missing so startup fails loudly instead of half-working.
 */

export interface Config {
  readonly accountNumber: string;
  readonly apiKey: string;
  /** Default X-AuditUser email for writes; per-call `auditUser` overrides it. */
  readonly defaultAuditUser: string | undefined;
  /** Master write switch. When false, every write tool refuses and sends nothing. */
  readonly allowWrites: boolean;
  /** API root without trailing slash, e.g. https://cloud.fastbound.com */
  readonly baseUrl: string;
  /** Optional x-api-version header value. */
  readonly apiVersion: string | undefined;
}

const DEFAULT_BASE_URL = "https://cloud.fastbound.com";

/** Parse common truthy spellings for the write switch. Anything else is false. */
function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set FASTBOUND_ACCOUNT_NUMBER and FASTBOUND_API_KEY (see .env.example).`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const accountNumber = required(env, "FASTBOUND_ACCOUNT_NUMBER");
  const apiKey = required(env, "FASTBOUND_API_KEY");

  const baseUrlRaw = env.FASTBOUND_BASE_URL?.trim() || DEFAULT_BASE_URL;
  // Normalise: drop trailing slashes so path joining is predictable.
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");

  const defaultAuditUser = env.FASTBOUND_AUDIT_USER?.trim() || undefined;
  const apiVersion = env.FASTBOUND_API_VERSION?.trim() || undefined;

  return Object.freeze({
    accountNumber,
    apiKey,
    defaultAuditUser,
    allowWrites: parseBool(env.FASTBOUND_ALLOW_WRITES),
    baseUrl,
    apiVersion,
  });
}
