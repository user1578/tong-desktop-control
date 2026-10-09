import { TongProjectAccess } from "./TongProjectAccess.mjs";

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function failure(error) {
  const message = error instanceof Error && /^(?:Path not permitted|Path not available|Invalid (?:maxDepth|limit|cursor|registry))$/.test(error.message)
    ? error.message : "Metadata request failed";
  return { content: [{ type: "text", text: message }], isError: true };
}
function safe(handler) {
  return async (input) => {
    try { return success(await handler(input)); }
    catch (error) { return failure(error); }
  };
}

export function registerTongMcpTools(server, registerTool, z, access = new TongProjectAccess()) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return;
  registerTool(server, "tong_list_drives", {
    title: "List C and D drive metadata",
    description: "Return only drive capacity and available space for C: and D:. No file contents are read.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => ({ drives: await access.listDrives() })));

  registerTool(server, "tong_scan_directory", {
    title: "Scan directory metadata",
    description: "Return bounded file and directory metadata on C: or D:. Protected paths and reparse targets are skipped. No file contents are read.",
    inputSchema: {
      path: z.string().describe("Absolute directory path on C: or D:"),
      maxDepth: z.number().int().min(0).max(3).optional().describe("Nested directory levels; defaults to 0."),
      limit: z.number().int().min(1).max(200).optional().describe("Maximum entries returned; defaults to 100."),
      cursor: z.string().optional().describe("Continuation token from the prior scan response."),
    },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe((input) => access.scanDirectory(input)));

  registerTool(server, "tong_list_projects", {
    title: "List locally registered projects",
    description: "Show local project registrations and effective permissions. Real project file content access is disabled in this phase.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => ({ projects: await access.listProjects() })));
}
