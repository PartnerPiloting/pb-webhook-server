import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { getNotionClient } from "../notion-client.js";
import { fetchPageMarkdown, getTitleFromPage } from "../markdown-converter.js";
import { formatNotionError } from "./get-brief.js";

function stripToSnippet(markdown: string, max = 200): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max)}…`;
}

export async function searchTool(query: string): Promise<{ text: string; isError?: boolean }> {
  try {
    const q = query.trim();
    if (!q) {
      return { text: "query is empty.", isError: true };
    }

    const notion = getNotionClient();
    const res = await notion.search({
      query: q,
      page_size: 10,
      filter: { property: "object", value: "page" },
    });

    const pages = res.results.filter((r): r is PageObjectResponse => r.object === "page");

    const items: Array<{ title: string; page_id: string; url: string; snippet: string }> = [];

    for (const p of pages) {
      const title = getTitleFromPage(p);
      let snippet = "";
      try {
        const { markdown } = await fetchPageMarkdown(notion, p.id);
        snippet = stripToSnippet(markdown, 200);
      } catch {
        snippet = "";
      }

      const href = (p as PageObjectResponse & { url?: string }).url;
      const url =
        typeof href === "string" && href
          ? href
          : `https://www.notion.so/${String(p.id).replace(/-/g, "")}`;

      items.push({
        title,
        page_id: p.id,
        url,
        snippet: snippet || "(Could not load snippet — page may be inaccessible to the integration.)",
      });
    }

    return { text: JSON.stringify({ results: items }, null, 2) };
  } catch (e) {
    return { text: formatNotionError(e, "search failed"), isError: true };
  }
}
