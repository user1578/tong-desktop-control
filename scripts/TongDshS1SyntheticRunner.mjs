import { createHash,randomUUID } from 'node:crypto';
import { win32 } from 'node:path';

const SESSION=/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const SHORT=/^[a-z][a-z0-9_-]{1,63}$/;
const within=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\0\r\n]/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalizePath=value=>win32.normalize(value).toLowerCase();
const fail=message=>new Error('DSH S1 synthetic: '+message);

// S1 is deliberately a MOCK/IN-MEMORY harness. It never starts dsh, does
// not write a profile, and cannot attest to OS isolation or live grants.
// Its only backend entry is an injected *synthetic events* callback.
export class TongDshS1SyntheticRunner {
  #simulate;
  #now;
  #active=new Set();
  #sessions=new Map();
  #newId;
  constructor({simulate,now=()=>Date.now(),newId=randomUUID}={}){
    if(typeof simulate!=='function'||typeof now!=='function'||typeof newId!=='function')
      throw fail('synthetic backend, clock and ID generator required');
    this.#simulate=simulate;this.#now=now;this.#newId=newId;
  }
  async runTask(request,{authorization,signal}={}){
    if(!request||typeof request!=='object'||Array.isArray(request)||
       !SHORT.test(request.projectId??'')||
       !SHORT.test(request.taskId??'')||
       !within(request.prompt,16000)||!within(request.scope,1000)||
       !win32.isAbsolute(request.projectRoot??'')||
       !['new','existing'].includes(request.sessionMode)||
       (request.sessionMode==='existing')!==Boolean(request.sessionId)||
       (request.sessionId && !SESSION.test(request.sessionId))||
       !Number.isInteger(request.timeoutMs)||request.timeoutMs<10||request.timeoutMs>120000){
      throw fail('invalid synthetic request');
    }
    const canonical=normalizePath(request.projectRoot);
    const scopeDigest=hash(JSON.stringify([request.projectId,canonical,request.scope,request.prompt,
      request.taskId,request.sessionMode,request.sessionId??null]));
    const approved=()=>{
      if(!authorization||authorization.syntheticApproval!==true||
         authorization.projectId!==request.projectId||
         authorization.taskId!==request.taskId||
         authorization.scopeDigest!==scopeDigest||
         !Number.isFinite(authorization.expiresAt)||
         authorization.expiresAt<=this.#now()){
        throw fail('synthetic scoped approval denied or expired');
      }
    };
    approved();signal?.throwIfAborted();
    const sessionId=request.sessionMode==='existing'?
      request.sessionId:this.#newId();
    if(!SESSION.test(sessionId))throw fail('synthetic session id invalid');
    if(request.sessionMode==='existing'){
      const record=this.#sessions.get(sessionId);
      if(!record || record.projectId!==request.projectId||
         record.root!==canonical ||record.status!=='completed')
        throw fail('synthetic session missing or belongs to another project');
    } else if(this.#sessions.has(sessionId))throw fail('synthetic session collision');
    const resource=request.projectId+'|'+canonical;
    if(this.#active.has(resource))throw fail('project already has a running DSH simulation');
    this.#active.add(resource);
    const abort=new AbortController();
    const cascade=()=>abort.abort(signal?.reason??new Error('cancelled'));
    signal?.addEventListener('abort',cascade,{once:true});
    let timer;
    let abortHandler;
    let timedOut=false;
    try{
      approved();signal?.throwIfAborted();
      const simulatorPromise=Promise.resolve().then(()=>this.#simulate(Object.freeze({
        backend:'synthetic-only',protocol:'dsh-sdk-jsonrpc',
        sessionId,sessionMode:request.sessionMode,projectId:request.projectId,
        prompt:request.prompt,signal:abort.signal,
      })));
      // The injected simulator is non-executable. This timeout does NOT prove
      // actual child-process termination. Runtime cancellation needs a Job.
      const deadline=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          timedOut=true;abort.abort(new Error('synthetic timeout'));
          reject(fail('synthetic timeout'));
        },request.timeoutMs);
      });
      const cancellation=new Promise((_,reject)=>{
        abortHandler=()=>{abort.abort(new Error('synthetic cancelled'));
          reject(fail('synthetic cancelled'));};
        signal?.addEventListener('abort',abortHandler,{once:true});
        if(signal?.aborted)abortHandler();
      });
      const events=await Promise.race([simulatorPromise,deadline,cancellation]);
      signal?.throwIfAborted();
      if(timedOut||abort.signal.aborted)throw fail('synthetic cancelled');
      approved(); // mimic grant revalidation immediately after provider return
      if(!Array.isArray(events)||events.length>100||
         events.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
        throw fail('invalid synthetic SDK event stream');
      const open=events.find(e=>e.type==='session-open');
      const queued=events.find(e=>e.type==='message-enqueued');
      const final=events.find(e=>e.type==='session-completed');
      if(events.filter(e=>e.type==='session-open').length!==1||
         events.filter(e=>e.type==='message-enqueued').length!==1||
         events.filter(e=>e.type==='session-completed').length!==1||
         open?.sessionId!==sessionId||queued?.sessionId!==sessionId||
         final?.sessionId!==sessionId||
         !SESSION.test(queued.messageId??'')||
         !within(final.response,16000)||
         events.indexOf(open)>events.indexOf(queued)||
         events.indexOf(queued)>events.indexOf(final))
         throw fail('SDK must complete the exact native session, not only enqueue');
      this.#sessions.set(sessionId,{projectId:request.projectId,root:canonical,status:'completed'});
      return Object.freeze({status:'completed',sessionId,
        resumed:request.sessionMode==='existing',messageId:queued.messageId,
        text:final.response,syntheticOnly:true,osIsolated:false});
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort',cascade);
      if(abortHandler)signal?.removeEventListener('abort',abortHandler);
      if(!abort.signal.aborted)abort.abort(new Error('synthetic finalized'));
      this.#active.delete(resource);
    }
  }
  // The test harness can create authorization fixtures; no production
  // approval grant or credential can be minted by these functions.
  static syntheticDigest(request){
    if(!request||!win32.isAbsolute(request.projectRoot??''))throw fail('invalid synthetic digest');
    return hash(JSON.stringify([
      request.projectId,normalizePath(request.projectRoot),request.scope,
      request.prompt,request.taskId,request.sessionMode,request.sessionId??null,
    ]));
  }
}
