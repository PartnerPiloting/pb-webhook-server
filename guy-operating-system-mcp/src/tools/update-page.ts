import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import { getNotionClient, normalizeNotionId } from "../notion-client.js";
import {
  chunkBlocks,
  collectBlocksPlainIndex,
  fetchPageMarkdown,
  markdownToNotionBlocks,
} from "../markdown-converter.js";
import { appendWriteLog } from "../write-log.js";
import { formatNotionError } from "./get-brief.js";

const OLD_CONTENT_LOG_MAX = 500_000;

async function deleteAllChildren(notion: ReturnType<typeof getNotionClient>, parentId: string): Promise<void> {
  while (true) {
    const res = await notion.blocks.children.list({ block_id: parentId, page_size: 100 });
    if (!res.results.length) break;
    for (const b of res.results) {
      await notion.blocks.delete({ block_id: b.id });
    }
  }
}

async function appendInChunks(
  notion: ReturnType<typeof getNotionClient>,
  parentId: string,
  blocks: BlockObjectRequest[],
  after?: string,
): Promise<void> {
  const batches = chunkBlocks(blocks, 100);
  let useAfter = after;
  for (const batch of batches) {
    await notion.blocks.children.append({
      block_id: parentId,
      children: batch,
      ...(useAfter ? { after: useAfter } : {}),
    });
    useAfter = undefined;
  }
}

export async function updatePageTool(args: {
  page_id: string;
  content: string;
  mode: "replace" | "append" | "insert_after";
  anchor?: string;
}): Promise<{ text: string; isError?: boolean }> {
  const notion = getNotionClient();
  const ts = new Date().toISOString();

  let pageId: string;
  try {
    pageId = normalizeNotionId(args.page_id.trim());
  } catch (e) {
    const msg = `Invalid page_id: ${e instanceof Error ? e.message : String(e)}`;
    appendWriteLog({
      page_id: args.page_id,
      mode: args.mode,
      content_preview: args.content.slice(0, 800),
      success: false,
      error: msg,
      timestamp: ts,
    });
    return { text: msg, isError: true };
  }

  if (args.mode === "insert_after") {
    const anchor = args.anchor?.trim();
    if (!anchor) {
      const msg = 'mode="insert_after" requires anchor (a unique substring found in an existing block).';
      appendWriteLog({
        page_id: pageId,
        mode: args.mode,
        content_preview: args.content.slice(0, 800),
        success: false,
        error: msg,
        timestamp: ts,
      });
      return { text: msg, isError: true };
    }
  }

  try {
    let oldContent: string | undefined;
    if (args.mode === "replace") {
      const existing = await fetchPageMarkdown(notion, pageId);
      oldContent =
        existing.markdown.length > OLD_CONTENT_LOG_MAX
          ? `${existing.markdown.slice(0, OLD_CONTENT_LOG_MAX)}\n…[truncated for log file size]`
          : existing.markdown;
    }

    const blocks = markdownToNotionBlocks(args.content);

    if (args.mode === "replace") {
      await deleteAllChildren(notion, pageId);
      await appendInChunks(notion, pageId, blocks);
    } else if (args.mode === "append") {
      await appendInChunks(notion, pageId, blocks);
    } else {
      const anchor = args.anchor!.trim();
      const index = await collectBlocksPlainIndex(notion, pageId);
      const hit = index.find((b) => b.plain.includes(anchor));
      if (!hit) {
        const msg = `insert_after: no block contains anchor substring:\n${anchor.slice(0, 500)}`;
        appendWriteLog({
          page_id: pageId,
          mode: args.mode,
          content_preview: args.content.slice(0, 800),
          success: false,
          error: msg,
          timestamp: ts,
        });
        return { text: msg, isError: true };
      }
      await appendInChunks(notion, pageId, blocks, hit.id);
    }

    appendWriteLog({
      page_id: pageId,
      mode: args.mode,
      content_preview: args.content.slice(0, 800),
      success: true,
      timestamp: ts,
      ...(args.mode === "replace" && oldContent !== undefined
        ? {
            old_content: oldContent,
            old_content_truncated: oldContent.endsWith("…[truncated for log file size]\n"),
          }
        : {}),
    });

    return {
      text: JSON.stringify({ success: true, updated_at: ts }, null, 2),
    };
  } catch (e) {
    const msg = formatNotionError(e, "update_page failed");
    appendWriteLog({
      page_id: pageId,
      mode: args.mode,
      content_preview: args.content.slice(0, 800),
      success: false,
      error: msg,
      timestamp: ts,
    });
    return { text: msg, isError: true };
  }
}
