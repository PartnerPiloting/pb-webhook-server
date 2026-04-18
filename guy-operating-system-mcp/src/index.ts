import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getBriefTool } from "./tools/get-brief.js";
import { getModeTool } from "./tools/get-mode.js";
import { getPageTool } from "./tools/get-page.js";
import { searchTool } from "./tools/search.js";
import { updatePageTool } from "./tools/update-page.js";

const server = new McpServer({
  name: "guy-operating-system",
  version: "1.0.0",
});

server.tool(
  "get_brief",
  "Return the full Master Brief page with manifest and decision log. Call this at the start of every new conversation when the user says 'grab my brief'.",
  {},
  async () => {
    const res = await getBriefTool();
    return {
      content: [{ type: "text", text: res.text }],
      ...(res.isError ? { isError: true as const } : {}),
    };
  },
);

server.tool(
  "get_mode",
  "Fetch all Notion pages listed for a given mode in the Master Brief manifest. Modes are conversation types like 'LinkedIn outreach', 'Follow-up email', 'Strategy'. Returns concatenated page content.",
  {
    mode_name: z.string().min(1).describe("Conversation mode label from the Master Brief manifest (case-insensitive; partial match allowed)."),
  },
  async ({ mode_name }) => {
    const res = await getModeTool(mode_name);
    return {
      content: [{ type: "text", text: res.text }],
      ...(res.isError ? { isError: true as const } : {}),
    };
  },
);

server.tool(
  "get_page",
  "Fetch a single Notion page by title or ID. Use when you need a specific page not covered by a mode.",
  {
    title_or_id: z.string().min(1).describe("Page title to search for, or a Notion page UUID (with or without dashes)."),
  },
  async ({ title_or_id }) => {
    const res = await getPageTool(title_or_id);
    return {
      content: [{ type: "text", text: res.text }],
      ...(res.isError ? { isError: true as const } : {}),
    };
  },
);

server.tool(
  "search",
  "Semantic search across the Notion workspace. Use when you don't know the exact page name.",
  {
    query: z.string().min(1).describe("Search query text."),
  },
  async ({ query }) => {
    const res = await searchTool(query);
    return {
      content: [{ type: "text", text: res.text }],
      ...(res.isError ? { isError: true as const } : {}),
    };
  },
);

server.tool(
  "update_page",
  "Write changes to a Notion page. Use 'replace' to overwrite entire content, 'append' to add to the end, 'insert_after' to insert after a specified anchor string.",
  {
    page_id: z.string().min(1).describe("Target Notion page id (UUID, dashes optional)."),
    content: z.string().describe("Markdown body to write."),
    mode: z.enum(["replace", "append", "insert_after"]).describe("replace clears existing blocks first; append adds at end; insert_after inserts after first block containing anchor."),
    anchor: z
      .string()
      .optional()
      .describe("Required for insert_after: substring that appears in an existing block (plain text match)."),
  },
  async (args) => {
    if (args.mode === "insert_after") {
      const a = args.anchor?.trim();
      if (!a) {
        return {
          content: [
            {
              type: "text",
              text: 'anchor is required when mode is "insert_after" (a substring that appears in an existing block).',
            },
          ],
          isError: true,
        };
      }
    }

    const res = await updatePageTool({
      page_id: args.page_id,
      content: args.content,
      mode: args.mode,
      anchor: args.anchor,
    });

    return {
      content: [{ type: "text", text: res.text }],
      ...(res.isError ? { isError: true as const } : {}),
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
