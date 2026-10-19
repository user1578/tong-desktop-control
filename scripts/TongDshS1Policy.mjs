import { createHash } from 'node:crypto';
import { inspectDshComposition } from './TongDshS0Audit.mjs';
// Two identical dumps from the installed 0.2.0-rc.2 SDK profile confirmed
// this fixed package-name/config baseline. Reject same-id plugin substitution.
export const PINNED_SDK_DEFAULT_SHA256='5441f27ee462033224dda7aa8f2ff304c0b879aae6928ea1f8aab12e2e57fb8c';

// Pin the exact default SDK profile observed in installed Desktop CLI 0.2.0-rc.2.
// Any plugin added/removed/renamed requires explicit review; never infer safety
// from a familiar prefix alone.
export const SDK_021_RC2_IDS=Object.freeze(`tool-plugin-manager,plugin-manager,timer,hmr,llm,deepseek-llm-api-extensions,session,session-log-deepseek,typert,typert-loader,typert-gateway,session-title,session-title-llm,user-questions,agent,plugin-package-inventory-deepseek,agent-default-model,jobs,llm-retry,config-editor,settings,authorization,deepseek-account,credentials,llm-pi-ai,session-persistence-jsonl,attachment-local,session-query-sqlite,session-projection,storage,storage-json,storage-domain,session-projection-cache,otel,session-telemetry-otel,subprocess,sandbox,sandbox-policy,bash-sandbox,pwsh-sandbox,approval,permission,shell-env,tool-bash,tool-pwsh,tool-jobs,fs-observation-policy,tool-fs,tool-fs-search,agent-instructions,skill,skill-filesystem,skill-badge,tool-skill,commands,command-feedback,goal,goal-round-driver,command-goal,plan-mode,token-meter,compaction-basic,command-compact,subagent,subagent-spawn-in-process,subagent-fork-in-process,tool-subagent-control,tool-subagent-list-agents,tool-subagent,tool-subagent-fork,ptc-runtime,workflow-ptc,tool-workflow,timeout-policy,spill-local,spill-policy,session-checkpoint-policy,tool-result-pruner,image-offload,tool-todo,tool-goal,tool-ralph,repeat-tool-reminder,web,web-search-deepseek,web-fetch-http,tool-web,mcp-resources,tools,system-prompt,agent-loop,fs-sandbox,llm-deepseek,llm-deepseek-account,sdk-app-startup,sdk-jsonrpc-server,workspace-dependencies,skill-office`.split(','));
const RISK_EXACT=new Set([
  'plugin-manager','tool-plugin-manager','config-editor','settings',
  'subprocess','bash-sandbox','pwsh-sandbox','shell-env',
  'skill','skill-filesystem','skill-badge','commands','command-feedback',
  'command-goal','goal','goal-round-driver','plan-mode',
  'subagent','subagent-spawn-in-process','subagent-fork-in-process',
  'ptc-runtime','workflow-ptc','web','web-search-deepseek','web-fetch-http',
  'mcp-resources','workspace-dependencies','skill-office',
  'fs-sandbox','fs-observation-policy',
]);
export const DISABLED_SDK_S1_IDS=Object.freeze(SDK_021_RC2_IDS.filter(
  id=>id.startsWith('tool-')||RISK_EXACT.has(id)));
const sorted = a => [...a].sort((x,y)=>x.localeCompare(y,'en'));
const equalArray=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);

function entriesFromText(text) {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>2*1024*1024)
    throw Error('DSH S1 configuration must be bounded text');
  const chunks=text.split(/(?=^- id: )/m);
  const entries=[];
  for(const block of chunks){
    const m=/^- id: ([^\r\n]+)/m.exec(block);
    if(!m)continue;
    const id=m[1].trim();
    if(!/^[a-z][a-z0-9-]{0,95}$/.test(id)||entries.some(item=>item.id===id))
      throw Error('DSH S1 unknown/duplicate identifier');
    // Split out next profile layer. Never eval !!js, read only literal strings.
    const content=block.slice(m.index+m[0].length).split(/^# == /m)[0];
    const disabled=/^  disabled: ([^\r\n]+)/m.exec(content)?.[1].trim()??null;
    const mode=/^    mode: ([^\r\n]+)/m.exec(content)?.[1].trim()??null;
    const approvalPolicy=/^    policy: ([^\r\n]+)/m.exec(content)?.[1].trim()??null;
    entries.push({id,disabled,mode,approvalPolicy});
  }
  return entries;
}

export function prepareDshS1Policy(defaultSdkText,{installedVersion='0.2.0-rc.2',
  syntheticFixtureSha256}={}) {
  if(installedVersion!=='0.2.0-rc.2')throw Error('DSH S1 runtime version changed');
  const baselineHash=createHash('sha256').update(defaultSdkText).digest('hex');
  if(baselineHash!==(syntheticFixtureSha256??PINNED_SDK_DEFAULT_SHA256))
    throw Error('DSH S1 default SDK plugin definitions changed');
  const list=entriesFromText(defaultSdkText);
  const ids=list.map(x=>x.id);
  if(!equalArray(sorted(ids),sorted(SDK_021_RC2_IDS)))
    throw Error('DSH S1 installed SDK profile differs from audited baseline');
  // No CLI process or DSH state is created by this function.
  const overlay=[
    '- id: sandbox-policy','  config:','    mode: read-only',
    '    workspaceRoot: !!js process.cwd()',
    '- id: approval','  config:','    policy: ask',
    ...DISABLED_SDK_S1_IDS.flatMap(id=>['- id: '+id,'  disabled: true']),
  ].join('\n')+'\n';
  const hash=createHash('sha256').update(overlay).digest('hex');
  return Object.freeze({
    profile:'sdk',version:installedVersion,mode:'configuration-only',
    baseCount:ids.length,
    baseSha256:baselineHash,
    disabledIds:DISABLED_SDK_S1_IDS,overlay,
    overlaySha256:hash,
  });
}

export function verifyDshS1ComposedConfig(composedText,policy) {
  if(!policy||policy.profile!=='sdk'||policy.mode!=='configuration-only'||
     typeof policy.overlaySha256!=='string'||typeof policy.overlay!=='string'||
     createHash('sha256').update(policy.overlay).digest('hex')!==policy.overlaySha256)
    throw Error('DSH S1 policy is absent or altered');
  const parsed=entriesFromText(composedText);
  const ids=parsed.map(item=>item.id);
  if(!equalArray(sorted(ids),sorted(SDK_021_RC2_IDS)))throw Error('DSH S1 composed plugin set drifted');
  const byId=new Map(parsed.map(item=>[item.id,item]));
  const unsafe=policy.disabledIds.filter(id=>byId.get(id)?.disabled!=='true');
  const mode=byId.get('sandbox-policy')?.mode;
  const approvalAsk=byId.get('approval')?.approvalPolicy==='ask';
  if(unsafe.length||mode!=='read-only'||!approvalAsk)
    throw Error('DSH S1 composed safety policy rejected');
  const inventory=inspectDshComposition(composedText,{profile:'sdk'});
  if(!inventory.hasSdkJsonRpc)throw Error('DSH S1 SDK transport missing');
  return Object.freeze({
    verified:true,configurationOnly:true,entries:ids.length,
    disabledTools:policy.disabledIds.length,readOnly:true,
    approvalAsk:true,sha256:createHash('sha256').update(composedText).digest('hex'),
  });
}
