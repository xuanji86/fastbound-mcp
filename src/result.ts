/**
 * Uniform, model-facing tool results.
 *
 * Every result's first line is a status tag (OK / DRY RUN / BLOCKED / ERROR) so the
 * model can branch instantly. BLOCKED is normal control flow (isError stays false);
 * only real API/validation failures set isError.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

/** Pretty-print data, truncating very large payloads to protect the model's context. */
export function prettyJson(data: unknown, maxChars = 12_000): string {
  const s = JSON.stringify(data, null, 2);
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n… (truncated; ${s.length} chars total)`;
}

export function okResult(summary: string, data?: unknown, notes: string[] = []): CallToolResult {
  let text = `OK — ${summary}`;
  for (const n of notes) text += `\nNote: ${n}`;
  if (data !== undefined) text += `\n${prettyJson(data)}`;
  return textResult(text);
}

/** Summarise a paged list result without dumping every record. */
export function listResult(
  summary: string,
  items: unknown[],
  total: number | undefined,
  preview = 25,
): CallToolResult {
  const shown = items.slice(0, preview);
  let text = `OK — ${summary} (showing ${shown.length}`;
  text += total !== undefined ? ` of ${total} total)` : `)`;
  if (items.length > preview) {
    text += `\n(${items.length - preview} more in this page not shown; use take/skip to page deliberately)`;
  }
  text += `\n${prettyJson(shown)}`;
  return textResult(text);
}

export interface DryRunPreview {
  method: string;
  path: string;
  body?: unknown;
  summary: string;
  previewNote?: string;
  audit: string;
}

export function dryRunResult(p: DryRunPreview): CallToolResult {
  let text = `DRY RUN — nothing was sent.\n${p.summary}\n`;
  text += `Would ${p.method} ${p.path}\nX-AuditUser: ${p.audit}`;
  if (p.body !== undefined) text += `\nBody:\n${prettyJson(p.body)}`;
  if (p.previewNote) text += `\n(${p.previewNote})`;
  text += `\nRe-call with confirm:true to execute.`;
  return textResult(text);
}

/**
 * Present a downloaded binary. Small files are returned base64-encoded; files above
 * the cap return metadata only with guidance to narrow the request (stdio JSON is a
 * poor channel for large binaries).
 */
export function binaryResult(
  what: string,
  bytes: Uint8Array,
  contentType: string,
  filename: string | undefined,
  maxBytes = 5 * 1024 * 1024,
): CallToolResult {
  const sizeKb = (bytes.byteLength / 1024).toFixed(1);
  const head = `OK — ${what} (${contentType}, ${sizeKb} KB${filename ? `, ${filename}` : ""})`;
  if (bytes.byteLength > maxBytes) {
    return textResult(
      `${head}\nFile is larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB and was not inlined. Narrow the request (e.g. a smaller date range) or download it from the FastBound web app.`,
    );
  }
  const b64 = Buffer.from(bytes).toString("base64");
  return textResult(`${head}\nBase64 (${contentType}):\n${b64}`);
}

export function blockedResult(reason: string): CallToolResult {
  // Expected control flow, not a crash → isError stays false.
  return textResult(`BLOCKED — ${reason}`, false);
}

export function errorResult(message: string): CallToolResult {
  return textResult(`ERROR — ${message}`, true);
}
