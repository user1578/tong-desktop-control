import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// A small live acceptance project only. An incomplete scan fails instead of claiming no changes.
export async function snapshotProject(root) {
  const entries=[];
  let bytes=0;
  async function walk(directory) {
    for(const name of (await readdir(directory)).sort()) {
      if(entries.length>=2000) throw new Error('Acceptance snapshot file limit exceeded');
      if(/^\.env(?:\.|$)|^(?:credentials|auth)\.json$|\.(?:pem|key|p12|pfx|kdbx)$/i.test(name)) {
        throw new Error('Sensitive file in acceptance project; use a synthetic project');
      }
      const path=join(directory,name),info=await lstat(path),label=relative(root,path).replaceAll('\\','/');
      if(info.isSymbolicLink()) throw new Error('Links are not allowed in the acceptance project');
      if(info.isDirectory()) { entries.push([label,'directory']);await walk(path); }
      else {
        if(!info.isFile()||info.nlink!==1) throw new Error('Acceptance project requires regular, unlinked files');
        bytes+=info.size;
        if(bytes>16*1024*1024) throw new Error('Acceptance snapshot byte limit exceeded');
        const hash=createHash('sha256');
        for await(const chunk of createReadStream(path)) hash.update(chunk);
        entries.push([label,hash.digest('hex')]);
      }
    }
  }
  await walk(root);
  return entries;
}
