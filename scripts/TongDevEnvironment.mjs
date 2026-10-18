import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PS7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SCRIPT = fileURLToPath(new URL('./TongDevEnvironment.ps1', import.meta.url));
export const DEV_TOOLS = Object.freeze(['python','py','node','npm','git','pwsh','cmake','gcc','java','mvn']);
const available = new Set(['all', ...DEV_TOOLS]);
const maxOutput = 32768;

export function validateDevEnvironment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => key !== 'tool') ||
      (input.tool !== undefined && !available.has(input.tool))) {
    throw new Error('Invalid development environment query');
  }
  return { tool: input.tool ?? 'all' };
}

function validateResponse(data, tool) {
  const names = tool === 'all' ? DEV_TOOLS : [tool];
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).sort().join(',') !== 'source,tools,versionSource' ||
      data.source !== 'process-path' || data.versionSource !== 'file-metadata' ||
      !Array.isArray(data.tools) || data.tools.length !== names.length) throw Error('Bad shape');
  for (let i = 0; i < names.length; i++) {
    const row = data.tools[i];
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'available,candidates,name,truncated' ||
        row.name !== names[i] || typeof row.available !== 'boolean' ||
        typeof row.truncated !== 'boolean' || !Array.isArray(row.candidates) ||
        row.candidates.length > 3 || row.available !== (row.candidates.length > 0)) throw Error('Bad row');
    const seen = new Set();
    for (const candidate of row.candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
          Object.keys(candidate).sort().join(',') !== 'fileVersion,path' ||
          typeof candidate.path !== 'string' || candidate.path.length > 1024 ||
          !/^[a-zA-Z]:\\[^\\]/.test(candidate.path) ||
          (candidate.fileVersion !== null && (typeof candidate.fileVersion !== 'string' || candidate.fileVersion.length > 80)) ||
          seen.has(candidate.path.toLowerCase())) throw Error('Bad candidate');
      seen.add(candidate.path.toLowerCase());
    }
  }
  return data;
}

// Fixed read-only metadata probe. No caller-controlled commands or paths.
// Version is Windows binary FILE metadata; no executable is invoked.
export async function inspectDevEnvironment(input, { spawnProcess = spawn, platform = process.platform, timeoutMs = 10000 } = {}) {
  const { tool } = validateDevEnvironment(input);
  if (platform !== 'win32') throw new Error('Windows development environment inspection unavailable');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid inspection timeout');
  const args = ['-NoLogo','-NoProfile','-NonInteractive','-File',SCRIPT,'-Tool',tool];
  const env = {};
  for (const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT']) {
    const match = Object.keys(process.env).find(k => k.toLowerCase() === key.toLowerCase());
    if (match) env[key] = process.env[match];
  }
  return new Promise((resolve,reject) => {
    const child = spawnProcess(PS7,args,{
      cwd: join(process.env.SystemRoot ?? 'C:\\Windows','System32'),
      env, windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'],
    });
    let stdout = Buffer.alloc(0), stderrSeen = false, settled = false;
    const finish = (err,value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Development environment inspection timed out'));
    },timeoutMs);
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > maxOutput) {
        child.kill();
        finish(new Error('Development environment output exceeded limit'));
      } else stdout = Buffer.concat([stdout,chunk]);
    });
    child.stderr.on('data', () => { stderrSeen = true; });
    child.once('error', () => finish(new Error('Development environment inspection unavailable')));
    child.once('close', code => {
      if (code !== 0 || stderrSeen) return finish(new Error('Development environment inspection failed'));
      try { finish(null,validateResponse(JSON.parse(stdout.toString('utf8')),tool)); }
      catch { finish(new Error('Development environment response invalid')); }
    });
  });
}
