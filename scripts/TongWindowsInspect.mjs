import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PS7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SCRIPT = fileURLToPath(new URL('./TongWindowsInspect.ps1', import.meta.url));
const kinds = new Set(['processes', 'services']);
const validName = /^(?!-)[\p{L}\p{N}._() -]{1,80}$/u;
const maxBytes = 32768;

export function validateWindowsInspect(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['kind','name','limit'].includes(key)) ||
      !kinds.has(input.kind) ||
      (input.name !== undefined && (typeof input.name !== 'string' || !validName.test(input.name))) ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
    throw new Error('Invalid Windows inspection request');
  }
  return { kind: input.kind, name: input.name ?? '', limit: input.limit ?? 30 };
}

// Metadata-only. No caller-controlled scripts, executables, environment,
// command line disclosure, process termination, or Windows state mutation.
export async function inspectWindows(input, { spawnProcess = spawn, platform = process.platform, timeoutMs = 8000 } = {}) {
  const query = validateWindowsInspect(input);
  if (platform !== 'win32') throw new Error('Windows inspection unavailable');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid inspection timeout');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT,
    '-Kind', query.kind, '-Limit', String(query.limit), '-Name', query.name];
  const minimalEnv = {};
  for (const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH']) {
    const matched = Object.keys(process.env).find(k => k.toLowerCase() === key.toLowerCase());
    if (matched) minimalEnv[key] = process.env[matched];
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(PS7, args, {
      cwd: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
      env: minimalEnv, stdio: ['ignore','pipe','pipe'], windowsHide: true, shell: false,
    });
    let stdout = Buffer.alloc(0), stderrBytes = 0, completed = false;
    const finish = (error, value) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Windows inspection timed out'));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > maxBytes) {
        child.kill();
        finish(new Error('Windows inspection output exceeded limit'));
      } else stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.once('error', () => finish(new Error('Windows inspection unavailable')));
    child.once('close', code => {
      if (code !== 0 || stderrBytes > 0) return finish(new Error('Windows inspection failed'));
      try {
        const data = JSON.parse(stdout.toString('utf8'));
        if (data.kind !== query.kind || !Array.isArray(data.entries) ||
            data.entries.length > query.limit || data.count !== data.entries.length ||
            typeof data.truncated !== 'boolean') throw new Error('invalid response');
        for (const item of data.entries) {
          const keys = Object.keys(item);
          const expected = query.kind === 'processes'
            ? ['pid','name','workingSetBytes']
            : ['name','displayName','status'];
          if (keys.length !== expected.length || keys.some(k => !expected.includes(k)) ||
            typeof item.name !== 'string' ||
            (query.kind === 'processes'
              ? (!Number.isInteger(item.pid) || item.pid < 0 ||
                 !Number.isSafeInteger(item.workingSetBytes) || item.workingSetBytes < 0)
              : (typeof item.displayName !== 'string' ||
                 !['Stopped','StartPending','StopPending','Running','ContinuePending','PausePending','Paused'].includes(item.status)))) {
            throw new Error('invalid response');
          }
        }
        finish(null, data);
      } catch { finish(new Error('Windows inspection response invalid')); }
    });
  });
}
