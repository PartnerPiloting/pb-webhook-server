import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { getNotionClient, isProbableNotionUuid, normalizeNotionId } from "../notion-client.js";
import { fetchPageMarkdown, getTitleFromPage } from "../markdown-converter.js";
import { formatNotionError } from "./get-brief.js";

function scoreTitleMatch(title: string, query: string): number {
  const a = title.toLowerCase().trim();
  const b = query.toLowerCase().trim();
  if (!b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 75;
  return 0;
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

export async function getPageTool(titleOrId: string): Promise<{ text: string; isError?: boolean }> {
  try {
    const raw = titleOrId.trim();
    if (!raw) {
      return { text: "title_or_id is empty.", isError: true };
    }

    const notion = getNotionClient();

    if (isProbableNotionUuid(raw)) {
      const pageId = normalizeNotionId(raw);
      const { markdown } = await fetchPageMarkdown(notion, pageId);
      return { text: markdown };
    }

    const page = await findBestPageByTitle(raw);
    if (!page) {
      return {
        text: `No Notion page title matched "${raw}". Try the search tool with a shorter query, or paste the page id.`,
        isError: true,
      };
    }

    const { markdown } = await fetchPageMarkdown(notion, page.id);
    return { text: markdown };
  } catch (e) {
    return { text: formatNotionError(e, "get_page failed"), isError: true };
  }
}
