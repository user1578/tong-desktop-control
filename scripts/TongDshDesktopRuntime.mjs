import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32 } from 'node:path';

// Desktop's installed command is supported even when the user did not add
// 'dsh' to PATH. This probe never reads Desktop sessions, launches applications,
// modifies profiles, registers PATH, or calls an LLM.
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/;
const EXE = 'DeepSeek Harness.exe';
const CLI = 'resources\\runtime\\cli\\bin\\dsh.cmd';

function failure(message) { return new Error('DSH Desktop runtime: ' + message); }
function normalize(path) { return win32.normalize(path).toLowerCase(); }

export async function discoverDshDesktopRuntime({
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'),
  inspect = lstat, canonicalize = realpath,
} = {}) {
  if (platform !== 'win32') throw failure('Windows Desktop discovery unavailable');
  if (typeof localAppData !== 'string' || !win32.isAbsolute(localAppData) ||
      /[\r\n\0]/.test(localAppData)) throw failure('invalid Windows local-app-data root');

  const installRoot = win32.join(localAppData, 'Programs', 'DeepSeek Harness');
  const desktopExecutable = win32.join(installRoot, EXE);
  const cliExecutable = win32.join(installRoot, CLI);
  let realRoot;
  try {
    const rootInfo = await inspect(installRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error('unexpected directory');
    realRoot = await canonicalize(installRoot);
    if (typeof realRoot !== 'string' || !win32.isAbsolute(realRoot)) throw Error('not absolute');
    for (const path of [desktopExecutable, cliExecutable]) {
      const info = await inspect(path);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('not a regular file');
      const real = await canonicalize(path);
      if (normalize(real) !== normalize(win32.join(realRoot, win32.relative(installRoot, path))))
        throw Error('unexpected runtime path');
    }
  } catch {
    // Do not return untrusted alternative executables or fall back to npm.
    throw failure('Desktop-bundled runtime not found or could not be verified');
  }
  return Object.freeze({
    distribution: 'deepseek-harness-desktop',
    installRoot: realRoot,
    desktopExecutable: win32.join(realRoot, EXE),
    cliExecutable: win32.join(realRoot, CLI),
    cliVersionArgs: Object.freeze(['--version']),
    cliHelpArgs: Object.freeze(['--profile','headless','--help']),
    supportedProfiles: Object.freeze(['headless','sdk','acp']),
    // A CLI-managed Session must not be advertised as a Desktop UI session.
    desktopSessionInterop: 'unverified',
    modificationsPerformed: false,
  });
}

export function verifyDshDesktopCliVersion(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      result.exitCode !== 0 || result.timedOut || result.cancelled || result.error ||
      typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout, 'utf8') > 128)
    throw failure('CLI version probe failed');
  const version = result.stdout.trim();
  if (!RELEASE.test(version)) throw failure('CLI version result invalid');
  return Object.freeze({ version, source: 'bundled-cli', profile: 'headless',
    desktopSessionInterop: 'unverified' });
}
