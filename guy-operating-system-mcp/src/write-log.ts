import fs from "node:fs";
import path from "node:path";

export type WriteLogEntry = {
  timestamp: string;
  page_id: string;
  mode: "replace" | "append" | "insert_after";
  content_preview: string;
  success: boolean;
  error?: string;
  /** Present for replace operations — audit trail of prior page body (may be truncated if extremely large). */
  old_content?: string;
  old_content_truncated?: boolean;
};

function previewContent(content: string, max = 800): string {
  const s = String(content ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function appendWriteLog(entry: Omit<WriteLogEntry, "timestamp"> & { timestamp?: string }): void {
  const logPath = (process.env.WRITE_LOG_PATH || "./write-log.jsonl").trim();
  const resolved = path.resolve(logPath);
  const line = JSON.stringify({
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    content_preview: previewContent(entry.content_preview ?? "", 800),
  } as WriteLogEntry);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${line}\n`, "utf8");
}
