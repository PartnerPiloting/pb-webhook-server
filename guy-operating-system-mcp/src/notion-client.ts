import { Client } from "@notionhq/client";

let client: Client | null = null;

export function getNotionClient(): Client {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "NOTION_TOKEN is missing. Copy .env.example to .env and set NOTION_TOKEN to your Notion integration secret (starts with secret_ or ntn_).",
    );
  }
  if (!client) {
    client = new Client({
      auth: token,
      notionVersion: "2022-06-28",
    });
  }
  return client;
}

/** Normalize Notion IDs (with or without dashes) to dashed UUID form used by the API. */
export function normalizeNotionId(raw: string): string {
  const s = raw.trim().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(s)) {
    throw new Error(`Invalid Notion id format: "${raw}"`);
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function isProbableNotionUuid(input: string): boolean {
  const s = input.trim();
  const hex = s.replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex);
}
