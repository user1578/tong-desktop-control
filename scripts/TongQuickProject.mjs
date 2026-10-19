import { createHash } from 'node:crypto';
import { basename, resolve, win32 } from 'node:path';

// Auto-enroll is allowed ONLY below an already locally confirmed trusted root.
// A message containing a new path is NOT a grant for an untrusted folder.
const pathKey=value=>process.platform==='win32' ? win32.normalize(value).toLowerCase():resolve(value);
const matchPath=(a,b)=>pathKey(a)===pathKey(b);
function projectIdFor(path){
  const fragment=basename(path).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,25);
  const slug=/^[a-z]/.test(fragment)?fragment:'project';
  const hash=createHash('sha256').update(win32.normalize(path).toLowerCase()).digest('hex').slice(0,8);
  return (slug+'-'+hash).slice(0,39);
}
export async function prepareTrustedProject({projectPath,projectId,name}={}, {access,policy}={}) {
  if(typeof projectPath!=='string'||!access||!policy||
     typeof access.checkDirectory!=='function'||typeof policy.trustedRootFor!=='function')
    throw new Error('Trusted project preparation unavailable');
  // Always validate before checking the stored root. No symlinks, junctions,
  // forbidden credential folders, nonexistent or drive-root projects.
  const root=await access.checkDirectory(projectPath);
  const rootGrant=await policy.trustedRootFor(root);
  if(!rootGrant) return Object.freeze({ready:false,reason:'folder-needs-local-trust',projectPath:root});
  const trustedRoot=await access.checkDirectory(rootGrant.root);
  if(!matchPath(trustedRoot,rootGrant.root))
    throw new Error('Trusted folder changed; reauthorization required');
  const registry=await access.listProjects();
  let project=registry.find(p=>matchPath(p.root,root));
  if(project && (project.status!=='enabled'||project.permission!=='write'||!project.available))
    throw new Error('Registered project is not enabled for normal development');
  if(projectId!==undefined && (typeof projectId!=='string'||
      !/^[a-z][a-z0-9-]{1,39}$/.test(projectId)))
    throw new Error('Invalid project ID');
  if(project && projectId && project.id!==projectId)
    throw new Error('Project ID does not match registered folder');
  if(!project){
    const id=projectId??projectIdFor(root);
    if(registry.some(p=>p.id===id))
      throw new Error('Project ID conflicts with another folder');
    const displayName=name??basename(root);
    if(typeof displayName!=='string'||!displayName.trim()||displayName.length>80)
      throw new Error('Invalid project name');
    await access.addProject({id,name:displayName,root,permission:'write'});
    project=(await access.listProjects()).find(p=>p.id===id);
    if(!project||!project.available)throw new Error('Project registration failed');
  }
  if(!project.effectiveCapabilities.includes('agent.execute'))
    await access.grantAgentExecution(project.id);
  const current=await policy.read();
  if(!current.enabled||!current.executable ||
     !(await policy.trustedRootFor(root)))
    throw new Error('Trusted folder was revoked');
  if(!current.projects.includes(project.id))await policy.grant(project.id,access);
  const existing=(await policy.read()).developmentGrants?.find(g=>g.projectId===project.id &&
    matchPath(g.root,root));
  if(!existing)await policy.authorizeDevelopment(project.id,access,{
    gitCommit:rootGrant.capabilities.includes('git.commit'),
    gitPush:rootGrant.capabilities.includes('git.push'),
    expectedRoot:root,
    originTrustGrantId:rootGrant.grantId,
  });
  // Verification must happen after all writes; never return success if revoked.
  const verified=(await policy.read()).developmentGrants?.find(g=>g.projectId===project.id &&
    matchPath(g.root,root));
  if(!verified||!(await access.authorize('agent.execute',project.id)))
    throw new Error('Trusted project grant was not established');
  return Object.freeze({
    ready:true,projectId:project.id,projectPath:root,
    authorization:'persistent-project-development',
    gitCommit:verified.capabilities.includes('git.commit'),
    gitPush:verified.capabilities.includes('git.push'),
    needsTaskConfirmation:false,
    highImpactRequiresConfirmation:true,
  });
}
