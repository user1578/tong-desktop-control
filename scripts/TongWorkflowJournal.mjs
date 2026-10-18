import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, lstat, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const ID = /^[A-Za-z0-9_-]{16,128}$/;
const AGENT = /^[a-z][a-z0-9-]{1,39}$/;
const EVENTS = new Set(['step-started','step-completed','step-failed']);
const MAX_EVENTS = 40;
const hash = s => createHash('sha256').update(s).digest('hex');
const fail = m => new Error('Workflow journal: ' + m);

export class TongWorkflowJournal {
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== 'string' || !isAbsolute(rootDir)) throw fail('absolute state directory required');
    this.rootDir = resolve(rootDir);
  }

  async checkDir(dir) {
    await mkdir(dir, { recursive:true });
    const details = await lstat(dir);
    const canonical = await realpath(dir);
    const same = process.platform === 'win32'
      ? canonical.toLowerCase() === resolve(dir).toLowerCase()
      : canonical === resolve(dir);
    if (!details.isDirectory() || details.isSymbolicLink() || !same)
      throw fail('state directory is not an ordinary canonical directory');
  }

  statePath(workflowId) {
    if (typeof workflowId !== 'string' || !ID.test(workflowId)) throw fail('invalid workflow ID');
    return join(this.rootDir, hash(workflowId) + '.json');
  }

  async read(workflowId) {
    const data = JSON.parse(await readFile(this.statePath(workflowId), 'utf8'));
    if (data?.schemaVersion !== 1 || data.workflowId !== workflowId ||
        !Array.isArray(data.events)) throw fail('invalid persisted workflow state');
    return data;
  }

  async start(workflow) {
    if (!workflow || !ID.test(workflow.workflowId ?? '') ||
        !AGENT.test(workflow.projectId ?? '') ||
        typeof workflow.projectRoot !== 'string' || !isAbsolute(workflow.projectRoot))
      throw fail('invalid workflow identity');
    await this.checkDir(this.rootDir);
    const locks = join(this.rootDir, 'locks');
    await this.checkDir(locks);
    const canonicalRoot = process.platform === 'win32'
      ? resolve(workflow.projectRoot).toLowerCase() : resolve(workflow.projectRoot);
    const lockPath = join(locks, hash(canonicalRoot) + '.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error?.code === 'EEXIST') throw fail('project workflow lock exists; inspect it before recovery');
      throw error;
    }
    const now = new Date().toISOString();
    const state = { schemaVersion:1, workflowId:workflow.workflowId,
      projectId:workflow.projectId, projectRootDigest:hash(canonicalRoot),
      status:'running', createdAt:now, updatedAt:now, events:[] };
    const path=this.statePath(workflow.workflowId);
    const save=async()=>{
      const tmp=path+'.'+randomUUID()+'.tmp';
      const handle=await open(tmp,'wx',0o600);
      try { await handle.writeFile(JSON.stringify(state)+'\n','utf8'); }
      finally { await handle.close(); }
      try { await rename(tmp,path); }
      catch(error) { await unlink(tmp).catch(()=>{}); throw error; }
    };
    try {
      const file=await open(path,'wx',0o600);
      try { await file.writeFile(JSON.stringify(state)+'\n','utf8'); }
      finally { await file.close(); }
      // Written once; a restart must never quietly re-use an old workflow id.
    } catch(error) {
      await lock.close();
      await unlink(lockPath);
      if(error?.code==='EEXIST') throw fail('workflow ID already exists; no automatic retry');
      throw error;
    }
    let closed=false;
    return Object.freeze({
      record:async event=>{
        if(closed)throw fail('workflow already finished');
        if(!event || !EVENTS.has(event.type) ||
            !Number.isInteger(event.index) || event.index<0 || event.index>5 ||
            !AGENT.test(event.agent??'') ||
            (event.sessionId!==undefined &&
              (typeof event.sessionId!=='string' || event.sessionId.length>200)) ||
            (event.taskId!==undefined && (typeof event.taskId!=='string' || event.taskId.length>80)) ||
            Object.keys(event).some(k=>!['type','index','agent','sessionId','taskId'].includes(k)) ||
            state.events.length>=MAX_EVENTS)throw fail('invalid workflow event');
        state.events.push({...event,at:new Date().toISOString()});
        state.updatedAt=new Date().toISOString();
        await save();
      },
      finish:async outcome=>{
        if(closed)throw fail('workflow already finished');
        if(!['completed','failed','cancelled'].includes(outcome))throw fail('invalid outcome');
        state.status=outcome;
        state.updatedAt=new Date().toISOString();
        await save();
        closed=true;
        await lock.close();
        await unlink(lockPath);
      },
    });
  }
}
