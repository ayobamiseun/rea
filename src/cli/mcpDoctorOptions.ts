import { z } from "incur";

import { CLI_DOCUMENT_OUTPUT_FORMATS } from "../cliOutput.js";

/**
 * Canonical `rea mcp doctor` options. This schema is the single source of
 * truth: the argument parser accepts exactly these options (plus the `-h`
 * alias below), the help renderer lists them, and shell completion offers
 * them. Keep them in sync by changing this schema, not any consumer.
 */
export const MCP_DOCTOR_OPTIONS = z.object({
  format: z
    .enum(CLI_DOCUMENT_OUTPUT_FORMATS)
    .optional()
    .describe("Output format"),
  json: z.boolean().optional().describe("Emit the report as JSON"),
  fullOutput: z.boolean().optional().describe("Show the full output envelope"),
  help: z.boolean().optional().describe("Show help"),
});

export const MCP_DOCTOR_ALIAS = { help: "h" } as const;

export const MCP_DOCTOR_DESCRIPTION =
  "Validate MCP adapter startup and tool listing";
