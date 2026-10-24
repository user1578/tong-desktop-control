// Subscribe in the same turn as spawn, before any I/O or await. A closed child
// must remain observable even when the caller reaches cleanup much later.
export function childLifecycle(child,{timeoutMs=10000}={}) {
  let closed=false,result,resolveClose,resolveReady;
  const close=new Promise(resolve=>{resolveClose=resolve;});
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  let output='',stderr='';
  child.stdin?.on('error',error=>{stderr=(stderr+'\nstdin:'+error.code).slice(-4096);});
  child.stderr?.on('data',data=>{stderr=(stderr+data).slice(-4096);});
  child.stdout?.on('data',data=>{output=(output+data).slice(-4096);if(output.includes('READY'))resolveReady({ready:true});});
  child.once('error',error=>{result={error:error.code??'SPAWN_ERROR'};resolveReady(result);resolveClose(result);});
  child.once('close',(code,signal)=>{closed=true;result={code,signal,stderr};resolveReady(result);resolveClose(result);});
  async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),timeoutMs);})]);}finally{clearTimeout(timer);}}
  return {
    async ready(){const value=await bounded(ready,'CHILD_READY_TIMEOUT');if(!value.ready)throw Error('CHILD_EXIT_BEFORE_READY:'+JSON.stringify(value));},
    async close(){
      if(!closed)child.stdin?.end();
      try{return await bounded(close,'CHILD_CLOSE_TIMEOUT');}
      catch(error){
        // This is the exact child returned by spawn, never a PID lookup. A
        // broken fixture must not leave its Job owner running after timeout.
        if(!closed)child.kill();
        await bounded(close,'CHILD_TERMINATION_TIMEOUT');throw error;
      }
    },
  };
}
