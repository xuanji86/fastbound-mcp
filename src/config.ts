/**
 * Configuration loaded from environment variables.
 *
 * The server can hold SEVERAL FastBound accounts at once (e.g. a live bound book,
 * a sibling store, a dev sandbox). Each account is a self-contained AccountConfig;
 * tools pick one per call and the registry keeps one active by default.
 *
 * Two env layouts are accepted:
 *   multi   — FASTBOUND_ACCOUNTS=main,sibling,sandbox  + FASTBOUND_<ALIAS>_* per account
 *   single  — the original FASTBOUND_ACCOUNT_NUMBER/API_KEY/... (alias "default")
 *
 * Secrets (API keys) live only here and in each client's Authorization header. They
 * are never logged. Loading throws a precise, secret-free error when a required
 * variable is missing so startup fails loudly instead of half-working.
 */

export interface AccountConfig {
  /** Short lowercase handle used by the `account` tool argument, e.g. "main". */
  readonly alias: string;
  /** Human label for results and listings, e.g. "Main Shop (prod)". */
  readonly label: string;
  readonly accountNumber: string;
  readonly apiKey: string;
  /** Default X-AuditUser email for writes and document downloads; per-call `auditUser` overrides it. */
  readonly defaultAuditUser: string | undefined;
  /** Per-account write switch. When false, every write tool refuses and sends nothing. */
  readonly allowWrites: boolean;
  /** API root without trailing slash, e.g. https://cloud.fastbound.com */
  readonly baseUrl: string;
  /** Optional x-api-version header value. */
  readonly apiVersion: string | undefined;
}

export interface ServerConfig {
  readonly accounts: readonly AccountConfig[];
  /** Alias that is active until a call overrides it or `use_account` switches it. */
  readonly defaultAlias: string;
}

const DEFAULT_BASE_URL = "https://cloud.fastbound.com";
const LEGACY_ALIAS = "default";

/** Parse common truthy spellings for the write switch. Anything else is false. */
function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

function val(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/** Env-var infix for an alias: "main" → FASTBOUND_MAIN_*, "my-shop" → FASTBOUND_MY_SHOP_*. */
function envKey(alias: string): string {
  return alias.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function normaliseBaseUrl(raw: string | undefined): string {
  // Drop trailing slashes so path joining is predictable.
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requiredVar(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const value = val(env, name);
  if (!value) throw new Error(`Missing required environment variable ${name}. ${hint}`);
  return value;
}

/** Build one account from FASTBOUND_<ALIAS>_* vars, falling back to the global defaults. */
function loadNamedAccount(env: NodeJS.ProcessEnv, alias: string): AccountConfig {
  const k = envKey(alias);
  const hint = `Each alias in FASTBOUND_ACCOUNTS needs FASTBOUND_${k}_ACCOUNT_NUMBER and FASTBOUND_${k}_API_KEY (see .env.example).`;
  return Object.freeze({
    alias,
    label: val(env, `FASTBOUND_${k}_LABEL`) ?? alias,
    accountNumber: requiredVar(env, `FASTBOUND_${k}_ACCOUNT_NUMBER`, hint),
    apiKey: requiredVar(env, `FASTBOUND_${k}_API_KEY`, hint),
    defaultAuditUser: val(env, `FASTBOUND_${k}_AUDIT_USER`) ?? val(env, "FASTBOUND_AUDIT_USER"),
    allowWrites: parseBool(env[`FASTBOUND_${k}_ALLOW_WRITES`] ?? env.FASTBOUND_ALLOW_WRITES),
    baseUrl: normaliseBaseUrl(val(env, `FASTBOUND_${k}_BASE_URL`) ?? val(env, "FASTBOUND_BASE_URL")),
    apiVersion: val(env, `FASTBOUND_${k}_API_VERSION`) ?? val(env, "FASTBOUND_API_VERSION"),
  });
}

/** Build the single legacy account from the original un-prefixed vars. */
function loadLegacyAccount(env: NodeJS.ProcessEnv): AccountConfig {
  const hint = "Set FASTBOUND_ACCOUNT_NUMBER and FASTBOUND_API_KEY, or list several accounts in FASTBOUND_ACCOUNTS (see .env.example).";
  const accountNumber = requiredVar(env, "FASTBOUND_ACCOUNT_NUMBER", hint);
  return Object.freeze({
    alias: LEGACY_ALIAS,
    label: val(env, "FASTBOUND_LABEL") ?? LEGACY_ALIAS,
    accountNumber,
    apiKey: requiredVar(env, "FASTBOUND_API_KEY", hint),
    defaultAuditUser: val(env, "FASTBOUND_AUDIT_USER"),
    allowWrites: parseBool(env.FASTBOUND_ALLOW_WRITES),
    baseUrl: normaliseBaseUrl(val(env, "FASTBOUND_BASE_URL")),
    apiVersion: val(env, "FASTBOUND_API_VERSION"),
  });
}

function parseAliases(raw: string): string[] {
  const aliases = raw
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const a of aliases) {
    if (seen.has(a)) throw new Error(`Duplicate alias "${a}" in FASTBOUND_ACCOUNTS.`);
    seen.add(a);
  }
  if (aliases.length === 0) throw new Error("FASTBOUND_ACCOUNTS is set but lists no account aliases.");
  return aliases;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const list = val(env, "FASTBOUND_ACCOUNTS");
  const accounts = list
    ? parseAliases(list).map((alias) => loadNamedAccount(env, alias))
    : [loadLegacyAccount(env)];

  const first = accounts[0]!;
  const requestedDefault = val(env, "FASTBOUND_DEFAULT_ACCOUNT")?.toLowerCase();
  if (requestedDefault && !accounts.some((a) => a.alias === requestedDefault)) {
    throw new Error(
      `FASTBOUND_DEFAULT_ACCOUNT="${requestedDefault}" is not one of the configured accounts (${accounts
        .map((a) => a.alias)
        .join(", ")}).`,
    );
  }

  return Object.freeze({
    accounts: Object.freeze(accounts),
    defaultAlias: requestedDefault ?? first.alias,
  });
}
