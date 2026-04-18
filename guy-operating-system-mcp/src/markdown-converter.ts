import type { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
  TextRichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

const NOTION_TEXT_MAX = 2000;

type ParagraphBlockReq = Extract<BlockObjectRequest, { paragraph: unknown }>;
type RichTextPiece = ParagraphBlockReq["paragraph"]["rich_text"][number];

function makeText(
  content: string,
  ann?: { bold?: boolean; italic?: boolean; code?: boolean },
  linkUrl?: string | null,
): RichTextPiece {
  return {
    type: "text",
    text: {
      content,
      link: linkUrl ? { url: linkUrl } : null,
    },
    annotations: {
      bold: !!ann?.bold,
      italic: !!ann?.italic,
      strikethrough: false,
      underline: false,
      code: !!ann?.code,
      color: "default",
    },
  } as RichTextPiece;
}

function normalizeFenceLanguage(raw: string): RichTextPiece extends infer _ ? Extract<BlockObjectRequest, { type: "code" }>["code"]["language"] : never {
  const x = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    sh: "shell",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    html: "html",
    css: "css",
    sql: "sql",
  };
  const mapped = map[x] ?? (x || "plain text");
  return mapped as Extract<BlockObjectRequest, { type: "code" }>["code"]["language"];
}

export function plainTextFromRichText(
  rich: Array<TextRichTextItemResponse | RichTextPiece> | undefined,
): string {
  if (!rich?.length) return "";
  return rich
    .map((t) => (t.type === "text" && t.text ? t.text.content : (t as { plain_text?: string }).plain_text ?? ""))
    .join("");
}

export function getTitleFromPage(page: PageObjectResponse): string {
  const props = page.properties;
  for (const key of Object.keys(props)) {
    const p = props[key as keyof typeof props] as {
      type?: string;
      title?: Array<{ plain_text: string }>;
    };
    if (p.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text).join("") || "Untitled";
    }
  }
  return "Untitled";
}

export function plainTextFromBlock(block: BlockObjectResponse): string {
  const t = block.type;
  if (t === "unsupported" || t === "child_database") return "";

  const anyBlock = block as unknown as Record<
    string,
    { rich_text?: TextRichTextItemResponse[]; cells?: RichTextItemResponse[][] }
  >;
  const holder = anyBlock[t];
  if (holder && typeof holder === "object" && "rich_text" in holder && holder.rich_text) {
    return plainTextFromRichText(holder.rich_text as TextRichTextItemResponse[]);
  }
  if (t === "table_row") {
    const cells = (block as BlockObjectResponse & { table_row?: { cells?: TextRichTextItemResponse[][] } }).table_row
      ?.cells;
    if (!cells?.length) return "";
    return cells.map((cell) => plainTextFromRichText(cell.flat())).join(" | ");
  }
  return "";
}

async function listChildren(notion: Client, blockId: string): Promise<BlockObjectResponse[]> {
  const acc: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    acc.push(...(res.results as BlockObjectResponse[]));
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return acc;
}

async function renderRichText(rt: TextRichTextItemResponse[] | undefined): Promise<string> {
  if (!rt?.length) return "";
  let out = "";
  for (const item of rt) {
    if (item.type !== "text" || !item.text) continue;
    const content = item.text.content;
    let piece = content;
    const ann = item.annotations;
    if (ann?.code) piece = `\`${piece}\``;
    if (ann?.bold) piece = `**${piece}**`;
    if (ann?.italic) piece = `*${piece}*`;
    if (ann?.strikethrough) piece = `~~${piece}~~`;
    if (item.text.link?.url) piece = `[${piece}](${item.text.link.url})`;
    out += piece;
  }
  return out;
}

export async function blockTreeToMarkdown(
  notion: Client,
  block: BlockObjectResponse,
  listNumber: number,
  depth: number,
): Promise<string> {
  const indent = "  ".repeat(depth);
  const type = block.type;

  let line = "";
  switch (type) {
    case "paragraph": {
      const text = await renderRichText(block.paragraph.rich_text as TextRichTextItemResponse[]);
      line = `${indent}${text}\n`;
      break;
    }
    case "heading_1":
      line = `${indent}# ${await renderRichText(block.heading_1.rich_text as TextRichTextItemResponse[])}\n\n`;
      break;
    case "heading_2":
      line = `${indent}## ${await renderRichText(block.heading_2.rich_text as TextRichTextItemResponse[])}\n\n`;
      break;
    case "heading_3":
      line = `${indent}### ${await renderRichText(block.heading_3.rich_text as TextRichTextItemResponse[])}\n\n`;
      break;
    case "bulleted_list_item":
      line = `${indent}- ${await renderRichText(block.bulleted_list_item.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    case "numbered_list_item":
      line = `${indent}${listNumber}. ${await renderRichText(block.numbered_list_item.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      line = `${indent}- [${checked}] ${await renderRichText(block.to_do.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    }
    case "toggle":
      line = `${indent}<toggle> ${await renderRichText(block.toggle.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    case "quote":
      line = `${indent}> ${await renderRichText(block.quote.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    case "callout":
      line = `${indent}> **Callout:** ${await renderRichText(block.callout.rich_text as TextRichTextItemResponse[])}\n`;
      break;
    case "divider":
      line = `${indent}---\n\n`;
      break;
    case "code": {
      const lang = block.code.language || "";
      const codeText = plainTextFromRichText(block.code.rich_text as TextRichTextItemResponse[]);
      line = `${indent}\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
      break;
    }
    case "table": {
      if (!block.has_children) {
        line = `${indent}[empty table]\n`;
        break;
      }
      const rows = await listChildren(notion, block.id);
      const mdRows: string[] = [];
      for (const r of rows) {
        if (r.type !== "table_row") continue;
        const cells = r.table_row.cells.map((cell: RichTextItemResponse[]) =>
          plainTextFromRichText(cell as TextRichTextItemResponse[]).replace(/\|/g, "\\|"),
        );
        mdRows.push("| " + cells.join(" | ") + " |");
      }
      if (mdRows.length) {
        const colCount = mdRows[0].split("|").length - 2;
        const sep = "| " + Array.from({ length: colCount }).map(() => "---").join(" | ") + " |";
        line = `${indent}${mdRows[0]}\n${indent}${sep}\n` + mdRows.slice(1).map((x) => `${indent}${x}\n`).join("") + "\n";
      }
      break;
    }
    case "unsupported":
      line = "";
      break;
    default:
      line = `${indent}<!-- block:${type} -->\n`;
  }

  let body = line;
  if (block.has_children && type !== "table") {
    const kids = await listChildren(notion, block.id);
    let n = 0;
    for (const kid of kids) {
      let nextNum = 0;
      if (kid.type === "numbered_list_item") {
        n += 1;
        nextNum = n;
      } else {
        n = 0;
      }
      body += await blockTreeToMarkdown(
        notion,
        kid,
        nextNum,
        type === "bulleted_list_item" || type === "numbered_list_item" ? depth + 1 : depth,
      );
    }
  }
  return body;
}

export async function fetchPageMarkdown(notion: Client, pageId: string): Promise<{ title: string; markdown: string }> {
  const page = (await notion.pages.retrieve({ page_id: pageId })) as PageObjectResponse;
  const title = getTitleFromPage(page);

  const top = await listChildren(notion, pageId);
  let md = `# ${title}\n\n`;
  let nCounter = 0;
  const parts: string[] = [];
  for (const b of top) {
    let nextNum = 0;
    if (b.type === "numbered_list_item") {
      nCounter += 1;
      nextNum = nCounter;
    } else {
      nCounter = 0;
    }
    parts.push(await blockTreeToMarkdown(notion, b, nextNum, 0));
  }
  md += parts.join("");
  return { title, markdown: md.trim() + "\n" };
}

export async function collectBlocksPlainIndex(
  notion: Client,
  rootBlockId: string,
): Promise<Array<{ id: string; plain: string }>> {
  const acc: Array<{ id: string; plain: string }> = [];

  async function walk(parentId: string): Promise<void> {
    const kids = await listChildren(notion, parentId);
    for (const block of kids) {
      acc.push({ id: block.id, plain: plainTextFromBlock(block) });
      if (block.has_children) {
        await walk(block.id);
      }
    }
  }

  await walk(rootBlockId);
  return acc;
}

function chunkPlainText(input: string): RichTextPiece[] {
  const out: RichTextPiece[] = [];
  let s = String(input ?? "");
  while (s.length > 0) {
    out.push(makeText(s.slice(0, NOTION_TEXT_MAX)));
    s = s.slice(NOTION_TEXT_MAX);
  }
  return out.length ? out : [makeText(" ")];
}

export function markdownToNotionBlocks(markdown: string): BlockObjectRequest[] {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const blocks: BlockObjectRequest[] = [];

  let i = 0;
  let inFence = false;
  let fenceLang = "";
  const fenceBody: string[] = [];

  const flushFence = () => {
    const code = fenceBody.join("\n");
    fenceBody.length = 0;
    blocks.push({
      type: "code",
      object: "block",
      code: {
        rich_text: chunkPlainText(code),
        language: normalizeFenceLanguage(fenceLang),
      },
    });
  };

  while (i < lines.length) {
    const raw = lines[i] ?? "";

    if (raw.trim().startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceLang = raw.trim().slice(3).trim();
        i++;
        continue;
      }
      inFence = false;
      flushFence();
      i++;
      continue;
    }

    if (inFence) {
      fenceBody.push(raw);
      i++;
      continue;
    }

    if (raw.trim() === "---" || raw.trim() === "***" || raw.trim() === "___") {
      blocks.push({ type: "divider", object: "block", divider: {} });
      i++;
      continue;
    }

    const tableBlock = tryParseTable(lines, i);
    if (tableBlock) {
      blocks.push(...tableBlock.blocks);
      i = tableBlock.nextIndex;
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const rt = parseInlineRichText(text);
      if (level === 1) blocks.push({ type: "heading_1", object: "block", heading_1: { rich_text: rt } });
      else if (level === 2) blocks.push({ type: "heading_2", object: "block", heading_2: { rich_text: rt } });
      else blocks.push({ type: "heading_3", object: "block", heading_3: { rich_text: rt } });
      i++;
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push({
        type: "bulleted_list_item",
        object: "block",
        bulleted_list_item: { rich_text: parseInlineRichText(bullet[1]) },
      });
      i++;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numbered) {
      blocks.push({
        type: "numbered_list_item",
        object: "block",
        numbered_list_item: { rich_text: parseInlineRichText(numbered[2]) },
      });
      i++;
      continue;
    }

    const paraLines: string[] = [raw];
    i++;
    while (i < lines.length) {
      const nx = lines[i];
      if (!nx.trim()) break;
      if (
        nx.trim().startsWith("#") ||
        /^[-*]\s/.test(nx.trim()) ||
        /^\d+\.\s/.test(nx.trim()) ||
        nx.trim() === "---" ||
        nx.trim().startsWith("```") ||
        nx.includes("|")
      )
        break;
      paraLines.push(nx);
      i++;
    }
    const para = paraLines.join("\n");
    blocks.push({
      type: "paragraph",
      object: "block",
      paragraph: { rich_text: parseInlineRichText(para.trim()) },
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      type: "paragraph",
      object: "block",
      paragraph: { rich_text: [makeText(" ")] },
    });
  }

  return blocks;
}

function tryParseTable(
  lines: string[],
  start: number,
): { blocks: BlockObjectRequest[]; nextIndex: number } | null {
  const row0 = lines[start]?.trim() ?? "";
  if (!row0.startsWith("|")) return null;

  const tableLines: string[] = [];
  let j = start;
  while (j < lines.length) {
    const L = lines[j]?.trim() ?? "";
    if (!L.startsWith("|")) break;
    tableLines.push(lines[j] ?? "");
    j++;
  }
  if (tableLines.length < 2) return null;

  const sep = tableLines[1]?.trim() ?? "";
  if (!/^\|[\s\-:|]+\|\s*$/.test(sep)) {
    return null;
  }

  const dataRows = tableLines.filter((_, idx) => idx !== 1);
  const parsedRows = dataRows.map(parseTableRow).filter((r) => r.length > 0);
  if (!parsedRows.length) return null;

  const width = Math.max(...parsedRows.map((r) => r.length));

  const rowBlocks: BlockObjectRequest[] = parsedRows.map((cells) => {
    const padded = [...cells];
    while (padded.length < width) padded.push("");
    return {
      type: "table_row",
      object: "block",
      table_row: {
        cells: padded.slice(0, width).map((c) => parseInlineRichText(c)),
      },
    } satisfies BlockObjectRequest;
  });

  const tableBlock: BlockObjectRequest = {
    type: "table",
    object: "block",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: rowBlocks.map((rb) => ({
        type: "table_row",
        object: "block",
        table_row: (rb as { table_row: { cells: RichTextPiece[][] } }).table_row,
      })),
    },
  };

  return { blocks: [tableBlock], nextIndex: j };
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const parts = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return parts.split("|").map((c) => c.trim());
}

export function parseInlineRichText(input: string): RichTextPiece[] {
  const s = String(input ?? "");
  if (!s) return [makeText(" ")];

  type Token =
    | { k: "text"; v: string }
    | { k: "bold"; v: string }
    | { k: "italic"; v: string }
    | { k: "code"; v: string }
    | { k: "link"; text: string; url: string };

  const tokens: Token[] = [];
  let idx = 0;

  while (idx < s.length) {
    const link = matchLinkAt(s, idx);
    if (link) {
      tokens.push({ k: "link", text: link.text, url: link.url });
      idx = link.end;
      continue;
    }

    const bold = matchWrapped(s, idx, "**");
    if (bold) {
      tokens.push({ k: "bold", v: bold.inner });
      idx = bold.end;
      continue;
    }

    const codeMatch = matchWrapped(s, idx, "`");
    if (codeMatch) {
      tokens.push({ k: "code", v: codeMatch.inner });
      idx = codeMatch.end;
      continue;
    }

    const italic = matchItalicAt(s, idx);
    if (italic) {
      tokens.push({ k: "italic", v: italic.inner });
      idx = italic.end;
      continue;
    }

    let next = s.length;
    const candidates = [s.indexOf("**", idx), s.indexOf("`", idx), s.indexOf("[", idx), findItalicCandidate(s, idx)].filter(
      (x) => x >= idx && x !== -1,
    );
    if (candidates.length) next = Math.min(...candidates);

    const plain = s.slice(idx, next);
    if (plain) tokens.push({ k: "text", v: plain });
    idx = next === idx ? idx + 1 : next;
  }

  const rich: RichTextPiece[] = [];
  for (const t of tokens) {
    if (t.k === "text") rich.push(...chunkPlainRich(t.v, {}));
    else if (t.k === "bold") rich.push(...chunkPlainRich(t.v, { bold: true }));
    else if (t.k === "italic") rich.push(...chunkPlainRich(t.v, { italic: true }));
    else if (t.k === "code") rich.push(...chunkPlainRich(t.v, { code: true }));
    else if (t.k === "link") rich.push(...chunkPlainRichLink(t.text, t.url));
  }

  return mergeAdjacent(rich);
}

function chunkPlainRich(
  text: string,
  ann: { bold?: boolean; italic?: boolean; code?: boolean },
): RichTextPiece[] {
  const chunks: RichTextPiece[] = [];
  let rest = text;
  while (rest.length > 0) {
    const piece = rest.slice(0, NOTION_TEXT_MAX);
    rest = rest.slice(NOTION_TEXT_MAX);
    chunks.push(makeText(piece, ann));
  }
  return chunks.length ? chunks : [makeText(" ", ann)];
}

function chunkPlainRichLink(text: string, url: string): RichTextPiece[] {
  const chunks: RichTextPiece[] = [];
  let rest = text;
  while (rest.length > 0) {
    const piece = rest.slice(0, NOTION_TEXT_MAX);
    rest = rest.slice(NOTION_TEXT_MAX);
    chunks.push(makeText(piece, {}, url));
  }
  return chunks.length ? chunks : [makeText(" ", {}, url)];
}

function mergeAdjacent(items: RichTextPiece[]): RichTextPiece[] {
  const out: RichTextPiece[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const isText = (x: RichTextPiece): x is Extract<RichTextPiece, { type?: "text" }> =>
      x.type === "text" || ("text" in x && !!(x as { text?: unknown }).text);
    if (prev && isText(prev) && isText(it) && prev.text && it.text) {
      const sameAnn = JSON.stringify(prev.annotations ?? {}) === JSON.stringify(it.annotations ?? {});
      const sameLink = (prev.text.link?.url ?? null) === (it.text.link?.url ?? null);
      if (sameAnn && sameLink) {
        prev.text.content += it.text.content;
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

function matchWrapped(s: string, start: number, delim: string): { inner: string; end: number } | null {
  if (!s.startsWith(delim, start)) return null;
  const close = s.indexOf(delim, start + delim.length);
  if (close === -1) return null;
  return { inner: s.slice(start + delim.length, close), end: close + delim.length };
}

function matchItalicAt(s: string, start: number): { inner: string; end: number } | null {
  if (s[start] !== "*") return null;
  if (s[start + 1] === "*") return null;
  const end = s.indexOf("*", start + 1);
  if (end === -1) return null;
  return { inner: s.slice(start + 1, end), end: end + 1 };
}

function findItalicCandidate(s: string, start: number): number {
  const i = s.indexOf("*", start);
  if (i === -1) return -1;
  if (s[i + 1] === "*") return findItalicCandidate(s, i + 2);
  return i;
}

function matchLinkAt(s: string, start: number): { text: string; url: string; end: number } | null {
  if (s[start] !== "[") return null;
  const closeBracket = s.indexOf("]", start + 1);
  if (closeBracket === -1) return null;
  if (s[closeBracket + 1] !== "(") return null;
  const closeParen = s.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  const text = s.slice(start + 1, closeBracket);
  const url = s.slice(closeBracket + 2, closeParen);
  return { text, url, end: closeParen + 1 };
}

export function chunkBlocks(blocks: BlockObjectRequest[], size = 100): BlockObjectRequest[][] {
  const out: BlockObjectRequest[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}
