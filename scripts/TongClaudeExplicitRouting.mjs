// Stage E: explicit user-owned local CLI routing, not a production provider policy.
// Contains sensitive/private configuration VALUES in memory; never print or log
// the returned environment. No network, files, or model call in this module.
const ROUTING_KEYS=Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
]);
const MODEL_KEYS=ROUTING_KEYS.slice(1);
function getDefined(source,key){
  const matching=Object.keys(source).filter(x=>x.toUpperCase()===key);
  if(matching.length>1)throw new Error('Ambiguous Claude routing variable');
  return matching.length?source[matching[0]]:undefined;
}
export function prepareExplicitClaudeRouting(source = {}){
  if(!source || typeof source!=='object' || Array.isArray(source))
    throw new Error('Invalid Claude routing environment');
  const env={};
  const endpoint=getDefined(source,'ANTHROPIC_BASE_URL');
  if(endpoint!==undefined){
    if(typeof endpoint!=='string'||!endpoint.trim()||endpoint.length>2048 ||
        endpoint!==endpoint.trim()||/[\u0000-\u001f\u007f]/.test(endpoint)) {
      throw new Error('Invalid Claude API endpoint configuration');
    }
    let parsed;
    try{parsed=new URL(endpoint)}catch{throw new Error('Invalid Claude API endpoint configuration')}
    const host=parsed.hostname.toLowerCase();
    const local=['localhost','127.0.0.1','[::1]'].includes(host);
    if(!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash ||
        (parsed.protocol!=='https:' && !(local&&parsed.protocol==='http:'))) {
      throw new Error('Claude API endpoint needs HTTPS (or loopback HTTP) and no URL-embedded credentials');
    }
    env.ANTHROPIC_BASE_URL=endpoint;
  }
  for(const key of MODEL_KEYS){
    const value=getDefined(source,key);
    if(value===undefined)continue;
    if(typeof value!=='string'||!value.trim()||value!==value.trim()||
       value.length>256||/[\s\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('Invalid Claude model override configuration');
    }
    env[key]=value;
  }
  return Object.freeze({
    env:Object.freeze(env),
    endpointInherited:Object.hasOwn(env,'ANTHROPIC_BASE_URL'),
    modelSelectorsInherited:Object.freeze(MODEL_KEYS.filter(key=>Object.hasOwn(env,key))),
  });
}
