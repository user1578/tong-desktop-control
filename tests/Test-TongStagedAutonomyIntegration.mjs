import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const candidateRoot = process.argv[2];
const expectedCommit = process.argv[3];
if (!isAbsolute(candidateRoot ?? '') || !/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) {
  throw Error('Usage: node tests/Test-TongStagedAutonomyIntegration.mjs ABSOLUTE_CANDIDATE_ROOT FULL_COMMIT_SHA');
}
const app = join(candidateRoot, 'staged-app');
const manager = join(candidateRoot, 'staged-manager');
const artifact = join(candidateRoot, 'release', 'release-manifest.json');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const entrypoint = (root, name) => pathToFileURL(join(root, 'scripts', name)).href;

const manifest = await json(artifact);
const appRestore = await json(join(app, 'release-restore-evidence.json'));
const managerRestore = await json(join(manager, 'release-restore-evidence.json'));
for (const receipt of [appRestore, managerRestore]) {
  assert.equal(receipt.commit, expectedCommit);
  assert.equal(receipt.patchChecked, true);
  assert.equal(receipt.sqliteNativeLoaded, true);
  assert.equal(receipt.sourceFilesVerified, manifest.sourceFiles.length);
}
assert.equal(manifest.commit, expectedCommit);
for (const [root, path] of [
  [app, 'scripts/TongMcpTools.mjs'],
  [app, 'scripts/TongAgentTasks.mjs'],
  [app, 'scripts/TongTrustedCodexBroker.mjs'],
  [manager, 'scripts/TongAgentDockRuntime.mjs'],
  [manager, 'scripts/TongTrustedCodexBroker.mjs'],
]) {
  const f = manifest.sourceFiles.find(item => item.path === path);
  assert.ok(f, 'release manifest is missing ' + path);
  assert.equal(digest(await readFile(join(root, ...path.split('/')))), f.sha256);
}

const { TongProjectAccess } = await import(entrypoint(app, 'TongProjectAccess.mjs'));
const { TongTrustedPolicy: ManagerPolicy } = await import(entrypoint(manager, 'TongTrustedCodexBroker.mjs'));
const { TongTrustedPolicy: AppPolicy, TongTrustedCodexBroker, TongExecutorRouter } = await import(entrypoint(app, 'TongTrustedCodexBroker.mjs'));
const { TongAgentTaskManager } = await import(entrypoint(app, 'TongAgentTasks.mjs'));
const { readinessPolicy } = await import(entrypoint(manager, 'TongAgentDockRuntime.mjs'));
const { revokeRestoredTrustedAuthorization } = await import(entrypoint(app, 'TongRestoredAuthorization.mjs'));

assert.equal(readinessPolicy('devspace', true).totalMs, 75000);
const root = await mkdtemp(join(candidateRoot, 'stage-bridge-'));
const projectRoot = join(root, 'project'), state = join(root, 'state'), demo = join(root, 'demo');
await Promise.all([mkdir(projectRoot), mkdir(state), mkdir(demo)]);
const access = new TongProjectAccess({
  registryPath: join(state, 'project-access.json'),
  agentAccessPath: join(state, 'agent-execution.json'),
  demoRoot: demo,
});
await access.addProject({ id: 'stage-bridge', name: 'Synthetic staged integration', root: projectRoot, permission: 'write' });
await access.grantAgentExecution('stage-bridge');
const policyPath = join(state, 'trusted-codex.json'), taskStatePath = join(state, 'agent-tasks.json');
const managerPolicy = new ManagerPolicy({ policyPath, taskStatePath });
const appPolicy = new AppPolicy({ policyPath, taskStatePath });
const fakeExe = join(root, 'codex.exe');
await writeFile(fakeExe, 'NON_EXECUTABLE_SYNTHETIC_FIXTURE');
await managerPolicy.enable(fakeExe);
await managerPolicy.grant('stage-bridge', access);
await managerPolicy.authorizeDevelopment('stage-bridge', access, { gitCommit: true, gitPush: false, expectedRoot: projectRoot });
assert.equal((await appPolicy.status()).developmentGrants.length, 1, 'app must see manager-written authorization');

const calls = [];
const trusted = new TongTrustedCodexBroker({
  access, policy: appPolicy, pollMs: 5,
  adapterFactory: () => ({
    async selectSession() { return null; },
    async runTask(spec, { onSessionId }) {
      calls.push({ threadId: spec.threadId ?? null, task: spec.task });
      await onSessionId(spec.threadId ?? 'synthetic-native-thread');
      return { threadId: spec.threadId ?? 'synthetic-native-thread', turnStatus: 'completed' };
    },
  }),
});
const isolated = { async preflight() { throw Error('unexpected isolated broker'); }, async runTask() { throw Error('unexpected isolated broker'); }, async close() {} };
const tasks = new TongAgentTaskManager({
  access, statePath: taskStatePath, workerBroker: new TongExecutorRouter({ policy: appPolicy, isolated, trusted }),
  collectResult: async () => ({ changedFiles: [] }), defaultTimeoutMs: 3000, maxTaskRuntimeMs: 5000,
});
async function awaitStatus(taskId, expected) {
  for (let i = 0; i < 200; i++) {
    const current = await tasks.status(taskId);
    if (current.status === expected) return current;
    await new Promise(ok => setTimeout(ok, 10));
  }
  throw Error('Synthetic task did not reach ' + expected);
}
try {
  await tasks.ready;
  const input = { projectId: 'stage-bridge', agent: 'codex', task: 'synthetic code check', scope: 'project only',
    idempotencyKey: 'staged-bridge-unique-task-1', sessionMode: 'new', timeoutSeconds: 3 };
  const one = await tasks.start(input);
  assert.equal(one.authorization.mode, 'project-development');
  await awaitStatus(one.taskId, 'success');
  await tasks.resume(one.taskId, { message: 'resume the synthetic native session' });
  await awaitStatus(one.taskId, 'success');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].threadId, 'synthetic-native-thread');
  const high = await tasks.start({ ...input, idempotencyKey: 'staged-bridge-high-impact-2', workType: 'high-impact' });
  await awaitStatus(high.taskId, 'waiting_user_action');
  assert.equal(calls.length, 2, 'a high-impact task cannot auto-run');
  await managerPolicy.revoke('stage-bridge');
  assert.equal((await appPolicy.status()).developmentGrants.length, 0);
  await assert.rejects(tasks.start({ ...input, idempotencyKey: 'staged-bridge-revoked-3' }), /grant|disabled|authorized/i);
  const sanitized = revokeRestoredTrustedAuthorization({
    enabled: true, projects: ['stage-bridge'], developmentGrants: [{ projectId: 'stage-bridge' }],
    approvals: [{ taskId: 'synthetic' }], generation: 3,
  });
  assert.deepEqual(sanitized.developmentGrants, []);
  assert.equal(sanitized.enabled, false);
  console.log(JSON.stringify({
    passed: true, root, stageHashesVerified: true, appAndManagerSameCommit: true,
    managerAuthorizationReadableByApp: true, appTaskStartAndResume: true, highImpactWaits: true,
    grantRevocationAcrossPackages: true, backupRestoreRevokesGrants: true,
    productionAcceptance: false, realMcpNetwork: false,
  }));
} finally {
  await tasks.close();
  await trusted.close();
}
