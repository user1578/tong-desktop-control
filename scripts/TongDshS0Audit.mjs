// A pure, read-only inventory of shipped DSH profile dumps (not a sandbox).
// Inputs are only the YAML config text produced by dsh --dump-default-config
// or a *separate* temporary home's dsh --dump-config; never evaluate !!js.
const ID=/^[a-z][a-z0-9-]{0,95}$/;
const MAX_BYTES=2*1024*1024;
export const HIGH_RISK_DSH_IDS=Object.freeze([
  'tool-pwsh','tool-bash','tool-jobs','tool-fs','tool-fs-search',
  'tool-web','tool-workflow','tool-subagent','tool-subagent-fork',
  'tool-plugin-manager','mcp-resources','persistent-bash','persistent-pwsh',
]);

export function inspectDshComposition(text,{profile='headless'}={}) {
  if(typeof text!=='string' || Buffer.byteLength(text)>MAX_BYTES ||
     !['headless','sdk','sdk-minimal'].includes(profile))
    throw new Error('Invalid DSH read-only composition input');
  const rows=[];
  const chunks=text.split(/(?=^- id: )/m);
  for(const part of chunks) {
    const m=/^- id: ([^\r\n]+)/m.exec(part);
    if(!m)continue;
    const id=m[1].trim();
    if(!ID.test(id) || rows.some(row=>row.id===id))
      throw new Error('Invalid or duplicate DSH composition entry id');
    const after=part.slice(m.index+m[0].length).split(/^# == /m)[0];
    const disabled=/^  disabled: (.+)$/m.exec(after)?.[1]?.trim()??null;
    const mode=/^    mode: (.+)$/m.exec(after)?.[1]?.trim()??null;
    rows.push(Object.freeze({id,disabled,mode}));
  }
  if(rows.length<2) throw new Error('Incomplete DSH read-only composition');
  const byId=new Map(rows.map(row=>[row.id,row]));
  return Object.freeze({
    profile,entries:rows.length,
    highRisk: Object.freeze(HIGH_RISK_DSH_IDS.filter(id=>byId.has(id))
      .map(id=>Object.freeze({id,disabled:byId.get(id).disabled==='true'}))),
    sandboxMode:byId.get('sandbox-policy')?.mode??null,
    hasApproval:byId.has('approval'),
    hasPermissionPresets:byId.has('permission'),
    hasSdkJsonRpc:byId.has('sdk-jsonrpc-server'),
    hasHeadlessRunner:byId.has('headless-runner'),
  });
}

// A fail-closed CONFIGURATION proof only; a boot/runtime security proof
// needs separate execution isolation and tool rejection tests.
export function verifyDshCompositionRestriction(inventory,requiredDisabled) {
  if(!inventory||typeof inventory!=='object' ||
     !Array.isArray(inventory.highRisk) ||
     !Array.isArray(requiredDisabled) ||
     requiredDisabled.some(x=>typeof x!=='string'||!ID.test(x)))
    throw new Error('Invalid DSH restriction check');
  const byId=new Map(inventory.highRisk.map(x=>[x.id,x]));
  const missing=requiredDisabled.filter(id=>!byId.get(id)?.disabled);
  return Object.freeze({
    compositionOnly:true,
    sandboxReadOnly:inventory.sandboxMode==='read-only',
    requiredToolEntriesDisabled:missing.length===0,
    missingOrEnabled:Object.freeze(missing),
    passed:inventory.sandboxMode==='read-only'&&missing.length===0,
  });
}
