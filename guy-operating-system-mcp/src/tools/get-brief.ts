import { getNotionClient, normalizeNotionId } from "../notion-client.js";
import { fetchPageMarkdown } from "../markdown-converter.js";
import { APIResponseError } from "@notionhq/client";

export async function fetchMasterBriefMarkdown(): Promise<string> {
  const notion = getNotionClient();
  const rawId = process.env.MASTER_BRIEF_ID?.trim();
  if (!rawId) {
    throw new Error(
      "MASTER_BRIEF_ID is missing. Set it in your environment to your Master Brief page id (with or without dashes).",
    );
  }

  const pageId = normalizeNotionId(rawId);
  const { markdown } = await fetchPageMarkdown(notion, pageId);
  return markdown;
}

export async function getBriefTool(): Promise<{ text: string; isError?: boolean }> {
  try {
    const md = await fetchMasterBriefMarkdown();
    return { text: md };
  } catch (e) {
    const msg = formatNotionError(e, "Could not load Master Brief");
    return { text: msg, isError: true };
  }
}

export function formatNotionError(err: unknown, context: string): string {
  if (err instanceof APIResponseError) {
    const code = err.code;
    const status = err.status;
    const body = err.body;
    return [
      `${context}: Notion API error (${status}) code=${code}.`,
      body ? `Details: ${JSON.stringify(body)}` : "",
      "",
      "Common fixes:",
      "- Confirm MASTER_BRIEF_ID is the correct page id and includes no extra spaces.",
      "- Share the Master Brief page with your Notion integration (Connections / … menu on the page).",
      "- Verify NOTION_TOKEN is the integration secret for that workspace.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return `${context}: ${err instanceof Error ? err.message : String(err)}`;
}
