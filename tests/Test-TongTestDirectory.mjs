import assert from 'node:assert/strict';
import { access, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createTongTestDirectory, tongTestRoot } from './fixtures/TongTestDirectory.mjs';

const outside = await createTongTestDirectory('tong-temp-sentinel-');
const temporary = await createTongTestDirectory('tong-temp-lifecycle-');
let passed = false;
try {
  assert.equal(dirname(temporary.path), resolve(tongTestRoot));
  assert.notEqual(dirname(temporary.path), resolve('D:/'));
  await writeFile(join(outside.path, 'canary.txt'), 'keep external target');
  await symlink(outside.path, join(temporary.path, 'junction'), 'junction');
  await temporary.finish(false);
  await access(temporary.path);
  await temporary.finish(true);
  await assert.rejects(access(temporary.path), { code: 'ENOENT' });
  assert.equal(await readFile(join(outside.path, 'canary.txt'), 'utf8'), 'keep external target');
  await assert.rejects(createTongTestDirectory('../outside-'));
  passed = true;
  console.log('PASS: dedicated test container, failure retention, success cleanup, and junction target preservation.');
} finally {
  await outside.finish(passed);
}
