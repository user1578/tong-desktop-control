import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../scripts/TongLoginHost.cs',import.meta.url),'utf8');
assert.match(source,/SpecialFolder\.ProgramFiles/);
assert.match(source,/PowerShell\\7\\pwsh\.exe/);
assert.doesNotMatch(source,/ExecutionPolicy|EncodedCommand|AddScript|Unblock/);
assert.match(source,/-NonInteractive -File/);
console.log(JSON.stringify({passed:true,supportedPwsh7FileMode:true,noPolicyOverride:true}));
