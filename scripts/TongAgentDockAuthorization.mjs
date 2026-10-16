import {createHash,randomUUID} from 'node:crypto';
import {appendFile,open,readFile,rename,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {AGENTDOCK_READ_TOOLS} from './TongAgentDockClient.mjs';
import {checkedAgentDockPath,within} from './TongAgentDockPaths.mjs';
import {TongTrustedPolicy} from './TongTrustedCodexBroker.mjs';

// Local management only. Never registered as an MCP tool.
export async function authorizeAgentDockDevelopment(access,policyPath,projectId,{gitExe,pythonExe,pytestEntry,gitDiffPaths=[],trustedPolicyPath}={}) {
  if(!isAbsolute(policyPath)) throw new Error('AgentDock policy path must be absolute');
  const project=(await access.listProjects()).find(p=>p.id===projectId&&p.available&&p.status==='enabled'&&p.permission==='write');
  if(!project || !await access.authorize('agent.execute',projectId)) throw new Error('Project requires write and agent.execute authorization');
  const projects=await access.listProjects();
  if(!trustedPolicyPath||!isAbsolute(trustedPolicyPath)||projects.some(p=>p.root&&(within(resolve(p.root),resolve(policyPath))||within(resolve(p.root),resolve(trustedPolicyPath))))) throw new Error('Policy must be outside all projects');
  const trusted=await new TongTrustedPolicy({policyPath:trustedPolicyPath}).read();
  const developmentGrant=trusted.developmentGrants?.find(g=>g.projectId===projectId&&g.root===project.root);
  if(!trusted.enabled||!developmentGrant?.grantId)throw new Error('Persistent development authorization is required');
  const parent=await checkedAgentDockPath(dirname(policyPath),'.',{directory:true});
  const lock=await open(policyPath+'.lock','wx',0o600);
  try {
    const checked=await checkedAgentDockPath(dirname(policyPath),basename(policyPath));
    const original=await readFile(checked.target,'utf8');
    await checked.recheck({ignoreDirectoryTimes:true});
    const policy=JSON.parse(original);
    if(policy.schemaVersion!==1||!Array.isArray(policy.projects)||!Array.isArray(policy.approvals)) throw new Error('Invalid AgentDock policy');
    const commands={};const operations=[];
    const executable=async path=>{
      if(!isAbsolute(path)||!path.toLowerCase().endsWith('.exe')||projects.some(p=>p.root&&within(resolve(p.root),resolve(path)))) throw new Error('Command executable must be outside projects');
      const file=await checkedAgentDockPath(dirname(path),basename(path));
      const hash=createHash('sha256').update(await readFile(file.target)).digest('hex');await file.recheck();return {path:file.target,sha256:hash};
    };
    if(gitExe){commands.git=await executable(gitExe);operations.push('git_status');}
    if(gitDiffPaths.length){for(const path of gitDiffPaths)await checkedAgentDockPath(project.root,path);commands.gitDiffPaths=gitDiffPaths;if(!gitExe)throw new Error('git_diff requires a Git executable');operations.push('git_diff');}
    if(pytestEntry){if(!pythonExe)throw new Error('pytest requires a Python executable');await checkedAgentDockPath(project.root,pytestEntry);commands.python=await executable(pythonExe);commands.pytestEntry=pytestEntry;operations.push('pytest');}
    const grant={projectId,root:project.root,scope:'project-development',tools:[...AGENTDOCK_READ_TOOLS],development:{fileWrite:true,commands:operations},authorization:{trustedPolicyPath,grantId:developmentGrant.grantId},commands};
    const auditPath=join(dirname(policyPath),'agentdock-authorization-audit.jsonl');
    // The local lock and task manager legitimately update directory timestamps;
    // still verify directory identity, reparse state and the exact policy file.
    await parent.recheck({ignoreDirectoryTimes:true});await checked.recheck({ignoreDirectoryTimes:true});
    if(!await access.authorize('agent.execute',projectId)||!await access.authorize('project.write',projectId))throw new Error('Project authorization revoked');
    const current=(await access.listProjects()).find(p=>p.id===projectId);
    if(current?.root!==project.root)throw new Error('Project changed during confirmation');
    const temporary=policyPath+'.'+randomUUID()+'.tmp';
    policy.projects=policy.projects.filter(p=>p.projectId!==projectId);policy.projects.push(grant);
    await appendFile(auditPath,JSON.stringify({at:new Date().toISOString(),action:'authorize-development',projectId,root:project.root,commands:operations})+'\n',{mode:0o600});
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(policy,null,2)+'\n');}finally{await file.close();}
    await rename(temporary,policyPath);
    return grant;
  }finally{await lock.close();await unlink(policyPath+'.lock');}
}
