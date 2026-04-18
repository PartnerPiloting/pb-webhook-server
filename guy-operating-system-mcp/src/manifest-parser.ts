export type ManifestRow = {
  mode: string;
  col2: string;
  pages: string[];
};

/**
 * Parses the Markdown table under the "Manifest" heading.
 * Expects a markdown/GitHub-style table; uses the 1st column as mode and the 3rd column as comma-separated page names.
 */
export function parseManifestFromMarkdown(markdown: string): ManifestRow[] {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^#{1,6}\s+manifest\b/i.test(line) || /^manifest\s*$/i.test(line)) {
      i++;
      break;
    }
    i++;
  }

  const tableLines: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" && tableLines.length > 0) {
      const next = lines[i + 1]?.trim() ?? "";
      if (next && !next.startsWith("|")) break;
    }
    if (line.includes("|")) {
      tableLines.push(line);
    } else if (tableLines.length > 0) {
      break;
    }
  }

  const rows: ManifestRow[] = [];
  for (const tl of tableLines) {
    const trimmed = tl.trim();
    if (!trimmed.startsWith("|")) continue;
    const isSeparator = /^\|[\s\-:|]+\|\s*$/.test(trimmed.replace(/\|/g, "|"));
    if (isSeparator) continue;

    const cells = trimmed
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length < 3) continue;

    const mode = cells[0] ?? "";
    const col2 = cells[1] ?? "";
    const pagesRaw = cells[2] ?? "";
    const pages = pagesRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (mode.toLowerCase() === "mode") {
      continue;
    }

    rows.push({ mode, col2, pages });
  }

  return rows;
}

/** Case-insensitive partial match on mode names (both directions). */
export function findManifestRowsForMode(rows: ManifestRow[], modeName: string): ManifestRow[] {
  const q = modeName.trim().toLowerCase();
  if (!q) return [];

  const exact = rows.filter((r) => r.mode.trim().toLowerCase() === q);
  if (exact.length) return exact;

  const partial = rows.filter((r) => {
    const m = r.mode.trim().toLowerCase();
    return m.includes(q) || q.includes(m);
  });
  return partial;
}

export function listAvailableModes(rows: ManifestRow[]): string[] {
  return rows.map((r) => r.mode.trim()).filter(Boolean);
}
