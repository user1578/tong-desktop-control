import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const PROVIDER_ID = /^[a-z][a-z0-9-]{1,39}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const MAX_TIMEOUT = 3_600_000;
const MODES = new Set(['new','existing','latest']);

function fail(message) { return new Error('Multi-agent provider: ' + message); }

export class TongAgentProviderRegistry {
  #providers = new Map();

  register(provider) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider) ||
        !PROVIDER_ID.test(provider.id ?? '') ||
        !Array.isArray(provider.sessionModes) || !provider.sessionModes.length ||
        provider.sessionModes.some(mode => !MODES.has(mode)) ||
        new Set(provider.sessionModes).size !== provider.sessionModes.length ||
        typeof provider.preflight !== 'function' || typeof provider.runTask !== 'function' ||
        typeof provider.normalizeResult !== 'function') {
      throw fail('invalid provider contract');
    }
    if (this.#providers.has(provider.id)) throw fail('duplicate provider ID');
    this.#providers.set(provider.id, provider);
    return this;
  }

  describe() {
    return [...this.#providers.values()].map(provider => Object.freeze({
      id: provider.id,
      sessionModes: Object.freeze([...provider.sessionModes]),
      authorization: 'required-per-task',
      // Registration is not evidence of a current project grant.
    }));
  }

  get(id) {
    if (!PROVIDER_ID.test(id ?? '')) throw fail('invalid provider ID');
    const provider = this.#providers.get(id);
    if (!provider) throw fail('provider unavailable or not registered');
    return provider;
  }
}

// Bridge the existing reviewed Tong ExecutorRouter. It still performs its own
// Codex/project preflight, project locking and native session ownership checks.
export function codexProvider(broker) {
  if (!broker || typeof broker.preflight !== 'function' ||
      typeof broker.runTask !== 'function' || typeof broker.selectSession !== 'function') {
    throw fail('Codex ExecutorRouter contract unavailable');
  }
  return {
    id: 'codex',
    sessionModes: ['new','existing','latest'],
    async preflight(spec) {
      return broker.preflight({
        projectId: spec.projectId, projectRoot: spec.projectRoot,
        workType: spec.workType, requiredCapabilities: spec.requiredCapabilities,
      });
    },
    normalizeResult(raw) {
      return {
        completed: raw?.turnStatus === 'completed',
        summary: raw?.summary,
        sessionId: raw?.threadId,
      };
    },
    async runTask(spec, callbacks) {
      let threadId = spec.sessionId;
      if (spec.sessionMode === 'latest') {
        threadId = await broker.selectSession({
          projectId: spec.projectId, projectRoot: spec.projectRoot, sessionMode: 'latest',
        });
      }
      return broker.runTask({
        taskId: spec.taskId, projectId: spec.projectId, cwd: spec.projectRoot,
        task: spec.task, scope: spec.scope, prompt: spec.prompt,
        timeoutMs: spec.timeoutMs, threadId: threadId || undefined,
        executorMode: spec.authorization.mode, workType: spec.workType,
        requiredCapabilities: spec.requiredCapabilities,
      }, callbacks);
    },
  };
}

// Claude execution remains unavailable unless an authorized local manager
// supplies BOTH an approved Job-backed adapter AND an independent preflight.
// No implicit fallback to the Codex grant or a local process spawn.
export function claudeProvider({ adapter, authorize } = {}) {
  if (!adapter || typeof adapter.runTask !== 'function' || typeof authorize !== 'function') {
    throw fail('Claude approved runner and authorization are required');
  }
  return {
    id: 'claude',
    sessionModes: ['new','existing'],
    async preflight(spec) {
      const grant = await authorize({
        projectId: spec.projectId, projectRoot: spec.projectRoot,
        workType: spec.workType, requiredCapabilities: spec.requiredCapabilities,
        workflowId: spec.workflowId, stepIndex: spec.stepIndex,
        approvalDigest: spec.approvalDigest, task: spec.task, scope: spec.scope,
        sessionMode: spec.sessionMode, agent: 'claude',
      });
      if (grant?.approved !== true || grant?.mode !== 'trusted-windows' ||
          grant?.agent !== 'claude' || grant?.projectId !== spec.projectId ||
          grant?.projectRoot !== spec.projectRoot ||
          grant?.workflowId !== spec.workflowId || grant?.stepIndex !== spec.stepIndex ||
          grant?.approvalDigest !== spec.approvalDigest) {
        throw fail('Claude execution is not independently authorized');
      }
      return Object.freeze({ mode: grant.mode, grantId: grant.grantId ?? null });
    },
    normalizeResult(raw) {
      return {
        completed: raw?.status === 'completed',
        summary: raw?.text,
        sessionId: raw?.sessionId,
      };
    },
    async runTask(spec, callbacks) {
      if (spec.authorization?.mode !== 'trusted-windows') {
        throw fail('Claude execution requires a trusted Windows grant');
      }
      return adapter.runTask({
        cwd: spec.projectRoot, task: spec.prompt, scope: spec.scope,
        sessionMode: spec.sessionMode === 'latest' ? 'new' : spec.sessionMode,
        ...(spec.sessionId ? { sessionId: spec.sessionId } : {}),
        timeoutMs: spec.timeoutMs,
      }, callbacks);
    },
  };
}

// The SDK owns its own credentials, persisted sessions and plugin tools.
// This bridge is registered ONLY by an authorized manager supplying an
// independently reviewed DSH runner, not by merely finding dsh on PATH.
export function dshProvider({ adapter, authorize } = {}) {
  if (!adapter || typeof adapter.runTask !== 'function' ||
      typeof adapter.runtimeVersion !== 'string' ||
      typeof adapter.dshHome !== 'string' || typeof authorize !== 'function') {
    throw fail('DeepSeek Harness runner, state root and authorization are required');
  }
  return {
    id: 'dsh',
    sessionModes: ['new','existing'],
    async preflight(spec) {
      const grant = await authorize({
        agent: 'dsh', projectId: spec.projectId, projectRoot: spec.projectRoot,
        task: spec.task, scope: spec.scope, sessionMode: spec.sessionMode,
        workType: spec.workType, requiredCapabilities: spec.requiredCapabilities,
        workflowId: spec.workflowId, stepIndex: spec.stepIndex,
        approvalDigest: spec.approvalDigest, runtimeVersion: adapter.runtimeVersion,
        dshHome: resolve(adapter.dshHome), profile: 'sdk',
      });
      if (grant?.approved !== true || grant?.mode !== 'trusted-windows' ||
          grant?.agent !== 'dsh' || grant?.projectId !== spec.projectId ||
          grant?.projectRoot !== spec.projectRoot || grant?.workflowId !== spec.workflowId ||
          grant?.stepIndex !== spec.stepIndex || grant?.approvalDigest !== spec.approvalDigest ||
          grant?.runtimeVersion !== adapter.runtimeVersion ||
          grant?.dshHome !== resolve(adapter.dshHome) || grant?.profile !== 'sdk') {
        throw fail('DeepSeek Harness execution is not independently authorized');
      }
      return Object.freeze({ mode: grant.mode, grantId: grant.grantId ?? null });
    },
    normalizeResult(raw) {
      return {
        completed: raw?.status === 'completed',
        summary: raw?.text,
        sessionId: raw?.sessionId,
      };
    },
    async runTask(spec, callbacks) {
      if (spec.authorization?.mode !== 'trusted-windows')
        throw fail('DeepSeek Harness requires a trusted Windows grant');
      return adapter.runTask({
        cwd: spec.projectRoot, task: spec.prompt, scope: spec.scope,
        sessionMode: spec.sessionMode, ...(spec.sessionId ? { sessionId: spec.sessionId } : {}),
        timeoutMs: spec.timeoutMs,
      }, callbacks);
    },
  };
}

export function validateMultiAgentWorkflow(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some(key => !['projectId','projectRoot','steps','workflowId'].includes(key)) ||
      !PROVIDER_ID.test(spec.projectId ?? '') ||
      typeof spec.projectRoot !== 'string' || !isAbsolute(spec.projectRoot) ||
      /[\r\n\0]/.test(spec.projectRoot) ||
      !Array.isArray(spec.steps) || spec.steps.length < 2 || spec.steps.length > 6 ||
      (spec.workflowId !== undefined && (typeof spec.workflowId !== 'string' ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(spec.workflowId)))) throw fail('invalid workflow specification');
  const steps = spec.steps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) ||
        Object.keys(step).some(key => !['agent','task','scope','sessionMode','sessionId','timeoutMs','requiredCapabilities'].includes(key)) ||
        !PROVIDER_ID.test(step.agent ?? '') ||
        typeof step.task !== 'string' || !step.task.trim() || step.task.length > 16000 || step.task.includes('\0') ||
        typeof step.scope !== 'string' || !step.scope.trim() || step.scope.length > 2000 || step.scope.includes('\0') ||
        (step.sessionMode !== undefined && !MODES.has(step.sessionMode)) ||
        ((step.sessionMode === 'existing') !== (step.sessionId !== undefined)) ||
        (step.sessionId !== undefined && (typeof step.sessionId !== 'string' || !SESSION_ID.test(step.sessionId))) ||
        (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) ||
          step.timeoutMs < 1000 || step.timeoutMs > MAX_TIMEOUT)) ||
        (step.requiredCapabilities !== undefined && (!Array.isArray(step.requiredCapabilities) ||
          step.requiredCapabilities.length < 1 || step.requiredCapabilities.length > 8 ||
          step.requiredCapabilities.some(value => typeof value !== 'string' ||
            !/^[a-z][a-z0-9.-]{1,63}$/.test(value)) ||
          new Set(step.requiredCapabilities).size !== step.requiredCapabilities.length))) {
      throw fail('invalid workflow step');
    }
    return Object.freeze({
      agent: step.agent, task: step.task.trim(), scope: step.scope.trim(),
      sessionMode: step.sessionMode ?? 'new', sessionId: step.sessionId,
      timeoutMs: step.timeoutMs ?? 180000,
      requiredCapabilities: Object.freeze([...(step.requiredCapabilities ?? ['project.read'])]),
    });
  });
  return Object.freeze({
    workflowId: spec.workflowId ?? randomUUID(),
    projectId: spec.projectId,
    projectRoot: resolve(spec.projectRoot),
    steps: Object.freeze(steps),
  });
}
