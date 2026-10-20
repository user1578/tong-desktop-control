import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const source=await readFile(join('scripts','Apply-TongDevSpacePatch.mjs'),'utf8');
const start=source.indexOf('function replaceOnce(');
const end=source.indexOf('\nconst files = [',start);
assert.ok(start>=0&&end>start,'DevSpace patch pure transform source must remain reviewable');
// Isolate the trusted, repository-local pure transformation. No file writes,
// subprocesses, real Codex sessions, network requests, or model calls.
const transform=new Function('source',source.slice(start,end)+
    '\nreturn extendRestrictedServer(source);');
const fixture=[
  'import { registerTongMcpTools, closeTongMcpTools } from "../../../../scripts/TongMcpTools.mjs";',
  'await closeTongMcpTools();',
  'registerTongWorkspaceTools(server, registerAppTool, z, workspaces)',
  'registerTongMcpTools(server, registerAppTool, z)',
  'const TONG_ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit", "tong_agent_sessions", "tong_run_command", "tong_windows_inspect", "tong_dev_environment"]);',
].join('\n');
const updated=transform(fixture);
assert.match(updated,/"tong_dev_environment", "tong_project_prepare", "tong_agent_wait"\]\)/);
assert.equal((updated.match(/"tong_project_prepare"/g)??[]).length,1);
assert.equal(transform(updated),updated,'repatch must not silently expand');
const registered=await readFile(join('scripts','TongMcpTools.mjs'),'utf8');
assert.match(registered,/registerTool\(server, 'tong_project_prepare'/);
assert.match(source,/previousHash10: "756b28ced3b6838b9a223a2d6a1ff1bdbae37a38d7ab64f6d82f27e5122687a3"/);
assert.match(source,/previousHash11: "3728cb946e8dc9f48bdb8d5adf4f878b537023543140df51d1aa2bc49d26f3ef"/);
assert.match(source,/patchedHash: "7670539d5b9b299d8d7fab05ff839243588670ede3a9eb0814db1d08e2fa16fd"/);
assert.equal(createHash('sha256').update(updated).digest('hex').length,64);
console.log('PASS DevSpace: restricted MCP allowlist includes tong_project_prepare exactly once; idempotent transform.');
