// Diagnostic-only environment differencing for Claude CLI authentication.
// Never use the resulting environment to execute a model; it may contain
// credentials, API billing overrides or executable injection settings.
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_KEY = /(?:TOKEN|SECRET|CREDENTIAL|PASSWORD|PASSWD|AUTH|API.?KEY|COOKIE|PRELOAD)/i;
// Injection-related selectors are not copied into new CLI processes, even for
// read-only auth tests. Their presence warrants separate operator review.
const EXECUTION_MODIFIER = /^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|BASH_ENV|ENV|PYTHONPATH|PYTHONSTARTUP|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.+|JAVA_TOOL_OPTIONS)$/i;
const MAX_KEYS = 128;
const MAX_PROBES = 16;

function checkedEntries(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Invalid diagnostic environment');
  }
  const entries = Object.entries(source)
    .filter(([key,value]) => VALID_KEY.test(key) && typeof value === 'string');
  return new Map(entries.map(([key,value])=>[key.toUpperCase(),[key,value]]));
}

export async function isolateClaudeAuthDifference({
  source, baseline, check, maxProbes = MAX_PROBES,
} = {}) {
  if (typeof check !== 'function' || !Number.isInteger(maxProbes) ||
      maxProbes < 1 || maxProbes > MAX_PROBES) {
    throw new Error('Invalid authentication diagnostic');
  }
  const full=checkedEntries(source);
  const base=checkedEntries(baseline);
  const extras=[...full].filter(([normalized])=>!base.has(normalized))
    .map(([,entry])=>entry).sort(([a],[b])=>a.localeCompare(b,'en'));
  const blocked=extras.filter(([name])=>EXECUTION_MODIFIER.test(name))
    .map(([name])=>name);
  const remaining=extras.filter(([name])=>!EXECUTION_MODIFIER.test(name));
  if(remaining.length>MAX_KEYS) {
    return Object.freeze({status:'too-many-variables',variableNames:[],tested:0,
      remainingCount:remaining.length});
  }
  let tested=0;
  const probe=async extras=>{
    if(tested>=maxProbes) return null;
    tested++;
    const env={...baseline};
    for(const [name,value] of extras) env[name]=value;
    const outcome=await check(env);
    if(!['authenticated','not-authenticated','unavailable'].includes(outcome)) {
      throw new Error('Invalid authentication diagnostic result');
    }
    return outcome==='authenticated';
  };
  if(remaining.length===0) {
    return Object.freeze({status:blocked.length?'execution-modifiers-excluded':'no-excluded-variables',
      variableNames:[],blockedVariableNames:Object.freeze(blocked),tested:0,remainingCount:0});
  }
  if(await probe(remaining)!==true) {
    return Object.freeze({status:blocked.length?'execution-modifiers-excluded':'full-environment-did-not-authenticate',
      variableNames:[],blockedVariableNames:Object.freeze(blocked),
      tested,remainingCount:remaining.length});
  }
  let subset=remaining;
  while(subset.length>1 && tested+2<=maxProbes) {
    const middle=Math.floor(subset.length/2);
    const left=subset.slice(0,middle);
    const right=subset.slice(middle);
    if(await probe(left)===true){subset=left;continue}
    if(await probe(right)===true){subset=right;continue}
    return Object.freeze({status:'multiple-variables-needed',
      variableNames:[],tested,remainingCount:subset.length});
  }
  if(subset.length!==1){
    return Object.freeze({status:'probe-limit',variableNames:[],tested,remainingCount:subset.length});
  }
  const name=subset[0][0];
  return Object.freeze({
    status:'single-variable-candidate',
    variableNames:Object.freeze([name]),
    requiresManualReview:SENSITIVE_KEY.test(name),
    tested,remainingCount:1,
  });
}
