// Name/path vetoes run BEFORE opening bodies, including in archived dependencies.
const privateDirectories=new Set(['.git','.hg','.svn','.ssh','.codex','.claude','.agents','.agent','.cursor','.continue','.windsurf','.vscode','.venv','venv','.devspace','.aws','.azure','.kube','.docker','.config','.gnupg','skills','workflows','sessions','session','credentials','secrets','oauth','profile','profiles','local storage','session storage','indexeddb','config','configuration','state-backups','state-restores','documents','desktop','downloads','pictures','videos']);
const packageDocs=/^(?:readme|changelog|changes|history|license|licence|notice|authors|contributors|contributing|security)(?:[._-][a-z0-9-]+)?\.md$/i;
export function cleanupProtectedName(name,{dependency=false,directory=false,archivedSource=false}={}){
 const n=name.toLowerCase();
 if(privateDirectories.has(n)||/^(?:agents?|claude)\.md$/i.test(n))return true;
 if(/\.md$/i.test(n)&&!(dependency&&packageDocs.test(n)))return true;
 if(/^\.env(?:\.|$)|^(?:credentials?|secrets?|cookies?|login data|web data|local state|preferences|secure preferences)(?:[._ -]|$)/i.test(n))return true;
 if(/^(?:ntuser\.dat|usrclass\.dat|sam|security|system|bookmarks|history|favicons|network persistent state|wallet)(?:[._ -]|$)/i.test(n))return true;
 if(/^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|authorized_keys|known_hosts|kubeconfig|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.gitconfig|credentials\.json|service-account\.json)(?:[._ -]|$)/i.test(n))return true;
 if(/(?:^|[._ -])(?:tokens?|api[._ -]?keys?|passwords?|sessions?|dpapi|mcp)(?:[._ -]|$)/i.test(n))return true;
 if(/^\.?(?:agents?|codex|claude|mcp)[._ -].*\.(?:json|ya?ml|toml|ini|md)$/i.test(n)||/^\.?(?:codex|claude)\.(?:json|toml)$/i.test(n))return true;
 if(!dependency&&/(?:^|[._ -])(?:agents?|claude|rules?|skills?|workflows?)(?:[._ -]|$)/i.test(n))return true;
 if(/\.(?:db|db3|sqlite|sqlite3|mdb|accdb|sql|dump|pem|key|pfx|p12|cer|crt|kdbx|vhd|vhdx|vmdk|bak|backup|dmp|safetensors|gguf|pt|pth|ckpt|onnx|zip|7z|rar|tar|tgz)(?:-(?:wal|shm|journal))?$/i.test(n))return true;
 if(!dependency&&!archivedSource&&/^(?:package(?:-lock)?\.json|.*\.(?:json|xml|ya?ml|toml|ini|cfg|conf|lock|ps1|mjs|js|ts|py))$/i.test(n))return true;
 if(directory&&/^(?:accounts?|auth|authentication|certificates?|backups?)$/i.test(n))return true;
 // A verified third-party build/Release is package content. Tong production
 // app/runtime/release roots are separately vetoed by absolute path and pins.
 return !dependency&&directory&&/^(?:runtime|releases?|staged(?:-.*)?)$/i.test(n);
}
// A cache directory name is not proof that every child is disposable. Unknown
// files stay untouched without reading their contents to guess what they are.
export function cleanupCacheFile(cacheName,relativePath){
 const p=relativePath.replaceAll('\\','/'),name=p.split('/').at(-1);
 if(/\.py[co]$/i.test(name))return true;
 if(cacheName==='node-compile-cache')return /^[a-f0-9]{8,64}$/i.test(name);
 if(['npm-cache','.npm-cache'].includes(cacheName))return /^_cacache\/(?:content-v2\/sha(?:1|256|512)|index-v5)\/[a-f0-9/]+$/i.test(p);
 if(cacheName==='.pytest_cache')return p==='CACHEDIR.TAG'||/^v\/cache\/(?:nodeids|lastfailed|stepwise)$/.test(p);
 if(['.mypy_cache','.ruff_cache'].includes(cacheName))return p==='CACHEDIR.TAG'||cacheName==='.ruff_cache'&&/^[a-f0-9/.-]+$/i.test(p);
 return false;
}
