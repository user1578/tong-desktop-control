import { lstat, readFile, realpath } from 'node:fs/promises';
import { win32 } from 'node:path';

// Report validation only: never search for existing sessions or read their
// transcripts. This is local acceptance, not the production trusted runner.
function validateResumeReportLocation(reportPath,tempRoot) {
  if(typeof reportPath!=='string' || !win32.isAbsolute(reportPath) ||
     typeof tempRoot!=='string' || !win32.isAbsolute(tempRoot)) {
    throw new Error('Invalid local resume request');
  }
  const file=win32.normalize(reportPath);
  const base=win32.dirname(file);
  const expectedTempRoot=win32.normalize(tempRoot);
  if(win32.basename(file).toLowerCase()!=='acceptance-result.json' ||
     win32.dirname(base).toLowerCase()!==expectedTempRoot.toLowerCase() ||
     !/^tong-p3-local-acceptance-[A-Za-z0-9_-]{6,}$/.test(win32.basename(base))) {
    throw new Error('Resume report must be from a dedicated temp acceptance directory');
  }
  return {file,base};
}

export function validateClaudeResumeContext({
  reportPath, tempRoot, receipt, sessionId, expectedVersion, binarySha256,
} = {}) {
  const {file,base}=validateResumeReportLocation(reportPath,tempRoot);
  if(typeof sessionId!=='string' || typeof binarySha256!=='string' ||
     !/^[0-9a-f]{64}$/i.test(binarySha256)) {
    throw new Error('Invalid local resume request');
  }
  if(!receipt || typeof receipt!=='object' || Array.isArray(receipt) ||
     receipt.provider!=='claude' || receipt.status!=='passed' ||
     receipt.markerConfirmed!==true || receipt.sessionId!==sessionId ||
     receipt.expectedVersion!==expectedVersion ||
     receipt.binarySha256?.toLowerCase()!==binarySha256.toLowerCase() ||
     receipt.environment!=='local-interactive-unisolated') {
    throw new Error('Previous Claude native session receipt does not match');
  }
  return Object.freeze({
    workdir:win32.join(base,'empty-workdir'),
    base,reportPath:file,sessionId,
  });
}

export async function loadClaudeResumeContext(args,{
  inspect=lstat, canonicalize=realpath, read=readFile,
} = {}) {
  const location=validateResumeReportLocation(args.reportPath,args.tempRoot);
  const check=async (path,kind)=>{
    const data=await inspect(path);
    const resolved=await canonicalize(path);
    if(data.isSymbolicLink() ||
       !(kind==='file'?data.isFile():data.isDirectory()) ||
       win32.normalize(resolved).toLowerCase()!==win32.normalize(path).toLowerCase()) {
      throw new Error('Claude local resume path is redirected or invalid');
    }
    if(kind==='file' && (data.size<32 || data.size>16384)) {
      throw new Error('Claude local resume report size is invalid');
    }
  };
  await check(location.base,'dir');
  await check(location.file,'file');
  await check(win32.join(location.base,'empty-workdir'),'dir');
  let receipt;
  try { receipt=JSON.parse(await read(location.file,'utf8')); }
  catch { throw new Error('Claude local resume report is not valid JSON'); }
  return validateClaudeResumeContext({...args,receipt});
}
