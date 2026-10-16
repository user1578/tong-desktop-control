import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Outside the checkout and AppData, which Tong's project-path policy excludes.
export const tongTestRoot = fileURLToPath(new URL('../../../test-temp/tong-desktop-control/', import.meta.url));

export async function createTongTestDirectory(prefix) {
  assert.match(prefix, /^[a-z][a-z0-9-]*-$/);
  await mkdir(tongTestRoot, { recursive: true });
  const canonicalRoot = await realpath(tongTestRoot);
  const samePath = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
  assert.ok(samePath(canonicalRoot, tongTestRoot), 'Test container must not redirect through a link');
  const path = await mkdtemp(join(tongTestRoot, prefix));
  const report = () => console.error(`Test diagnostics retained: ${path}`);
  // Setup failures before a test's try/finally must still report their location.
  process.once('exit', report);
  return {
    path,
    async finish(passed) {
      process.off('exit', report);
      if (!passed) { report(); return; }
      try {
        assert.ok(samePath(dirname(path), canonicalRoot));
        assert.ok(samePath(await realpath(path), path));
        assert.ok(!(await lstat(path)).isSymbolicLink());
        // Only this invocation's mkdtemp directory; rm does not follow junctions.
        await rm(path, { recursive: true });
      } catch (error) { report(); throw error; }
    },
  };
}
