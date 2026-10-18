import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { homedir } from 'node:os';
import { discoverDshDesktopRuntime, verifyDshDesktopCliVersion } from '../scripts/TongDshDesktopRuntime.mjs';

const base='C:\\Users\\Example\\AppData\\Local';
const root=win32.join(base,'Programs','DeepSeek Harness');
const exe=win32.join(root,'DeepSeek Harness.exe');
const cli=win32.join(root,'resources','runtime','cli','bin','dsh.cmd');
const observed=[];
function createFileSystem({missing=[],redirect='',symlink=''}={}) {
  return {
    inspect:async path=>{
      observed.push(['inspect',path]);
      if(missing.some(p=>p.toLowerCase()===path.toLowerCase())){const e=Error('no file');e.code='ENOENT';throw e}
      return {isDirectory:()=>path===root,isFile:()=>path===exe||path===cli,
        isSymbolicLink:()=>path===symlink};
    },
    canonicalize:async path=>{
      observed.push(['canonicalize',path]);
      if(path===cli&&redirect)return redirect;
      return path;
    },
  };
}
const desc=await discoverDshDesktopRuntime({platform:'win32',localAppData:base,...createFileSystem()});
assert.equal(desc.distribution,'deepseek-harness-desktop');
assert.equal(desc.installRoot,root);
assert.equal(desc.desktopExecutable,exe);
assert.equal(desc.cliExecutable,cli);
assert.deepEqual(desc.cliVersionArgs,['--version']);
assert.deepEqual(desc.cliHelpArgs,['--profile','headless','--help']);
assert.deepEqual(desc.supportedProfiles,['headless','sdk','acp']);
assert.equal(desc.desktopSessionInterop,'unverified');
assert.equal(desc.modificationsPerformed,false);
assert.ok(Object.isFrozen(desc));
assert.equal(observed.length,6);

for(const opts of [
 {platform:'linux',localAppData:base,...createFileSystem()},
 {platform:'win32',localAppData:'relative',...createFileSystem()},
 {platform:'win32',localAppData:base+'\nmalicious',...createFileSystem()},
 {platform:'win32',localAppData:base,...createFileSystem({missing:[cli]})},
 {platform:'win32',localAppData:base,...createFileSystem({symlink:cli})},
 {platform:'win32',localAppData:base,...createFileSystem({redirect:'C:\\Other\\dsh.cmd'})},
]) await assert.rejects(discoverDshDesktopRuntime(opts),/DSH Desktop runtime:/);

const version=verifyDshDesktopCliVersion({exitCode:0,stdout:'0.2.0-rc.2\r\n'});
assert.deepEqual(version,{version:'0.2.0-rc.2',source:'bundled-cli',profile:'headless',desktopSessionInterop:'unverified'});
for (const reply of [
 {exitCode:1,stdout:'0.2.0-rc.2'}, {exitCode:0,stdout:'whoami'},
 {exitCode:0,stdout:'0.2.0-rc.2\nSECOND LINE'},
 {exitCode:0,stdout:'0.2.0-rc.2',timedOut:true},
 {exitCode:0,stdout:'0.2.0-rc.2',error:'SECRET'},
 {exitCode:0,stdout:'a'.repeat(256)},
]) assert.throws(()=>verifyDshDesktopCliVersion(reply),/DSH Desktop runtime:/);

// The real installation probe is metadata-only and optional on GitHub CI.
if (process.platform==='win32' && process.env.TONG_TEST_INSTALLED_DSH_DESKTOP==='1') {
  const real=await discoverDshDesktopRuntime({
    platform:'win32',localAppData:win32.join(homedir(),'AppData','Local'),
  });
  assert.ok(real.cliExecutable.toLowerCase().endsWith('\\dsh.cmd'));
  assert.equal(real.desktopSessionInterop,'unverified');
}

console.log('PASS: existing DSH Desktop bundled CLI discovery, fixed version probe, path and symlink defense; no command execution.');
