import assert from "node:assert/strict";
import { trustedCodexEnvironment, codexEnvironmentForPolicy, TongTrustedPolicy } from "../scripts/TongTrustedCodexBroker.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = {
  USERPROFILE: "C:\\Users\\TestUser",
  SystemRoot: "C:\\Windows",
  PATH: "C:\\Tools",
  OPENAI_API_KEY: "synthetic-not-inherited-secret",
  HTTP_PROXY: "http://remote.invalid:8118",
  HTTPS_PROXY: "http://remote.invalid:8118",
};
const without = trustedCodexEnvironment(base);
assert.equal(without.USERPROFILE, base.USERPROFILE);
assert.equal(without.HTTP_PROXY, undefined, "unapproved network proxies are never implicitly inherited");
assert.equal(without.HTTPS_PROXY, undefined);
assert.equal(without.OPENAI_API_KEY, undefined, "the child environment stays allowlisted");
// A trusted Codex subprocess must never inherit Tong's protected runtime temp:
// Codex's Windows sandbox adds sandbox-token ACLs to its TEMP directory.
const isolated = trustedCodexEnvironment({...base,TEMP:"D:\\Tong\\runtime\\temp",TMP:"D:\\Tong\\runtime\\temp"});
assert.equal(isolated.TEMP, "D:\\Tong\\state\\codex-sandbox-temp");
assert.equal(isolated.TMP, isolated.TEMP);
const ordinary = trustedCodexEnvironment({...base,TEMP:"C:\\Users\\TestUser\\AppData\\Local\\Temp",TMP:"C:\\Users\\TestUser\\AppData\\Local\\Temp"});
assert.equal(ordinary.TEMP, "C:\\Users\\TestUser\\AppData\\Local\\Temp",
  "normal user TEMP roots are not rewritten");
assert.equal(isolated.OPENAI_API_KEY, undefined);
for(const url of ["http://127.0.0.1:7897","http://localhost:1234","http://[::1]:7897",
  "https://127.0.0.1:1234"]) {
  const result = trustedCodexEnvironment({...base,TONG_CODEX_PROXY_URL:url});
  assert.equal(result.HTTP_PROXY,new URL(url).origin);
  assert.equal(result.HTTPS_PROXY,result.HTTP_PROXY);
  assert.equal(result.NO_PROXY,"localhost,127.0.0.1,::1");
  assert.equal(result.TONG_CODEX_PROXY_URL,undefined);
  assert.equal(result.OPENAI_API_KEY,undefined);
}
for(const url of ["http://remote.invalid:7897", "socks5://127.0.0.1:7897",
  "http://u:p@127.0.0.1:7897", "http://127.0.0.1", "http://127.0.0.1:0",
  "http://127.0.0.1:7897/other", "http://127.0.0.1:7897/?x=1",
  "http://127.0.0.1:7897/#test", "bad-proxy", "", "http://127.0.0.2:7897"]) {
  assert.throws(()=>trustedCodexEnvironment({...base,TONG_CODEX_PROXY_URL:url}),
    /Invalid trusted Codex loopback proxy/, "must reject unsafe proxy "+url);
}
const temp=await mkdtemp(join(tmpdir(),"tong-codex-proxy-"));
try {
  const policy=new TongTrustedPolicy({policyPath:join(temp,"trusted-codex.json"),
    taskStatePath:join(temp,"agent-tasks.json")});
  const initial=await policy.status();
  assert.equal(initial.codexProxyUrl,null);
  const accepted=await policy.configureCodexProxy("http://127.0.0.1:7897");
  assert.equal(accepted,"http://127.0.0.1:7897");
  const reread=new TongTrustedPolicy({policyPath:join(temp,"trusted-codex.json"),
    taskStatePath:join(temp,"agent-tasks.json")});
  assert.equal((await reread.status()).codexProxyUrl,accepted,
    "proxy setting must survive policy reinitialization");
  const resolved=codexEnvironmentForPolicy((await reread.read()).codexProxyUrl,base);
  assert.equal(resolved.HTTP_PROXY,accepted);
  assert.equal(resolved.HTTPS_PROXY,accepted);
  assert.equal(resolved.OPENAI_API_KEY,undefined);
  await assert.rejects(policy.configureCodexProxy("http://outside.invalid:7897"),
    /Invalid trusted Codex loopback proxy/);
  assert.equal((await policy.status()).codexProxyUrl,accepted,"invalid updates must preserve earlier settings");
  await policy.configureCodexProxy(null);
  assert.equal((await reread.status()).codexProxyUrl,null);
  const disabled=codexEnvironmentForPolicy(null,{...base,TONG_CODEX_PROXY_URL:accepted});
  assert.equal(disabled.HTTP_PROXY,undefined,"policy off takes precedence over inherited environment");
  assert.equal(disabled.HTTPS_PROXY,undefined);
  const legacy=codexEnvironmentForPolicy(undefined,{...base,TONG_CODEX_PROXY_URL:accepted});
  assert.equal(legacy.HTTP_PROXY,accepted,"unset policy retains isolated runner compatibility");
}finally{
  await rm(temp,{recursive:true,force:true});
}
console.log("PASS: Codex-only proxy validation, persistent local policy, isolated child environment, disable and legacy behavior.");
