import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAgentDockAudit } from '../scripts/TongAgentDockTools.mjs';
const root = await mkdtemp('D:\\agentdock-poc-20261010\\isolated\\state\\b22-audit-');
await mkdir(join(root, 'logs'));
const old = process.env.TONG_AGENTDOCK_AUDIT_PATH;
try {
  const path = join(root, 'logs', 'agentdock-audit.jsonl');
  process.env.TONG_AGENTDOCK_AUDIT_PATH = path;
  await writeAgentDockAudit({ projectId: 'synthetic', tool: 'read_file', outcome: 'allowed' });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).projectId, 'synthetic');
  process.env.TONG_AGENTDOCK_AUDIT_PATH = 'relative.jsonl';
  await assert.rejects(writeAgentDockAudit({}), error => error.code === 'INVALID_CONFIG');
  console.log('PASS: independent absolute AgentDock audit path, invalid path fails closed.');
} finally { if (old === undefined) delete process.env.TONG_AGENTDOCK_AUDIT_PATH; else process.env.TONG_AGENTDOCK_AUDIT_PATH = old; }
