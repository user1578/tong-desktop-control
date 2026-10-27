export function validateUpgradeBinding({oldApp,oldManager,manifest,expectedOld,expectedNew}){
  if(!/^[a-f0-9]{40}$/.test(expectedOld??'')||!/^[a-f0-9]{40}$/.test(expectedNew??'')||expectedOld===expectedNew||oldApp?.commit!==expectedOld||oldManager?.commit!==expectedOld||manifest?.commit!==expectedNew)throw Error('UPGRADE_BINDING_DENIED');
  for(const old of [oldApp,oldManager])for(const field of ['native','versions']){
    if(!old[field]||!manifest[field]||JSON.stringify(old[field])!==JSON.stringify(manifest[field]))throw Error('UPGRADE_BINDING_DENIED');
  }
  return true;
}
