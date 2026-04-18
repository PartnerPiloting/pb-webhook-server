import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { getNotionClient } from "../notion-client.js";
import { fetchPageMarkdown, getTitleFromPage } from "../markdown-converter.js";
import {
  findManifestRowsForMode,
  listAvailableModes,
  parseManifestFromMarkdown,
} from "../manifest-parser.js";
import { fetchMasterBriefMarkdown, formatNotionError } from "./get-brief.js";

function scoreTitleMatch(title: string, query: string): number {
  const a = title.toLowerCase().trim();
  const b = query.toLowerCase().trim();
  if (!b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 75;
  const common = a.split(/\s+/).filter((w) => w.length > 2 && b.includes(w));
  return common.length ? 40 : 0;
}

async function findBestPageByTitle(query: string): Promise<PageObjectResponse | null> {
  const notion = getNotionClient();
  const res = await notion.search({
    query,
    page_size: 20,
    filter: { property: "object", value: "page" },
  });

  const pages = res.results.filter((r): r is PageObjectResponse => r.object === "page");
  let best: PageObjectResponse | null = null;
  let bestScore = -1;
  for (const p of pages) {
    const title = getTitleFromPage(p);
    const s = scoreTitleMatch(title, query);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (bestScore <= 0) return null;
  return best;
}

export async function getModeTool(modeName: string): Promise<{ text: string; isError?: boolean }> {
  try {
    const briefMd = await fetchMasterBriefMarkdown();
    const rows = parseManifestFromMarkdown(briefMd);
    const matches = findManifestRowsForMode(rows, modeName);

    if (matches.length === 0) {
      const modes = listAvailableModes(rows);
      return {
        text: [
          `No manifest row matched mode_name="${modeName}".`,
          "",
          "Available modes in the Master Brief manifest:",
          modes.length ? modes.map((m) => `- ${m}`).join("\n") : "(none parsed — check the 'Manifest' table format)",
          "",
          "Tip: Try a shorter partial name, or use the search tool to locate pages.",
        ].join("\n"),
        isError: true,
      };
    }

    if (matches.length > 1) {
      const names = matches.map((m) => m.mode.trim()).join(", ");
      return {
        text: [
          `Multiple manifest rows matched mode_name="${modeName}": ${names}.`,
          "Please use a more specific mode_name that matches exactly one row.",
        ].join("\n"),
        isError: true,
      };
    }

    const row = matches[0]!;
    const pageNames = row.pages;
    if (!pageNames.length) {
      return {
        text: `Matched mode "${row.mode.trim()}", but the manifest third column lists no pages for this mode.`,
        isError: true,
      };
    }

    const chunks: string[] = [];
    for (const name of pageNames) {
      const page = await findBestPageByTitle(name);
      if (!page) {
        chunks.push(`\n\n---PAGE: ${name} (NOT FOUND)---\n\nCould not locate a page whose title matches "${name}".`);
        continue;
      }

      const title = getTitleFromPage(page);
      const { markdown } = await fetchPageMarkdown(getNotionClient(), page.id);
      chunks.push(`\n\n---PAGE: ${title}---\n\n${markdown}`);
    }

    return { text: chunks.join("").trim() + "\n" };
  } catch (e) {
    return { text: formatNotionError(e, "get_mode failed"), isError: true };
  }
}
