import {readFile,writeFile,rename,open,unlink,appendFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {TongCleanupAuthorization,validateCleanupGrants,cleanupOrdinaryPath,cleanupCategories} from './TongCleanupAuthorization.mjs';
import {confirmLocally} from './TongLocalConfirmation.mjs';
import {assertProtectedPaths} from './TongRuntimeSecurity.mjs';

const id='tong-state-cleanup',root='D:\\Tong\\state';
const policy=new TongCleanupAuthorization('D:\\Tong\\app\\runtime'),state=dirname(policy.path),[command,...extra]=process.argv.slice(2);
try{
  if(extra.length||!['status','grant-state','revoke-state'].includes(command))throw Error('Usage: status | grant-state | revoke-state');
  await assertProtectedPaths([state]);await cleanupOrdinaryPath(state);
  if(command==='status'){console.log(JSON.stringify(await policy.read()));}
  else{
    if(fileURLToPath(import.meta.url).toLowerCase()!=='d:\\tong\\runtime\\releases\\manager\\scripts\\tongcleanupcontrol.mjs')throw Error('Use the installed formal Manager entry');
    const enabled=command==='grant-state';
    await confirmLocally({action:enabled?'启用受管历史缓存与已核验候选的持久递归删除许可':'撤销受管历史清理许可',targets:root,
      scope:'本次任务已批准的清理能力；仅缓存类别和具有完整匹配保留release的两种历史候选，读写/命令执行权限不随之扩大',
      risk:'获准目录内的可重建文件会被永久删除；误判可能丢失文件',recovery:'仅从匹配保留release或锁文件重建；原数据删除不可撤销。可运行 revoke-state 立即阻止后续删除',
      duration:'持续到本人撤销；每次执行仍核对短时计划、精确路径、当前pin、链接和保留归档；不包含生产、凭据、真实数据库、Git及独有用户文件'});
    await cleanupOrdinaryPath(root);
    const lock=await open(policy.path+'.lock','wx');
    try{
      const value=await policy.read();
      value.grants=value.grants.filter(g=>g.id!==id);
      value.grants.push({id,root,enabled,revision:randomUUID(),scopes:[{relativeRoot:'.',categories:[...cleanupCategories]}]});
      validateCleanupGrants(value);
      const temp=policy.path+'.'+randomUUID()+'.tmp';
      await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
      await assertProtectedPaths([temp]);
      await appendFile(join(state,'disk-cleanup-authorization-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),id,root,enabled,revision:value.grants.at(-1).revision})+'\n',{mode:0o600});
      await rename(temp,policy.path);await assertProtectedPaths([policy.path]);
      console.log(JSON.stringify({id,root,enabled}));
    }finally{await lock.close();await unlink(policy.path+'.lock');}
  }
}catch(e){console.error(e.code??e.message);process.exitCode=1;}
