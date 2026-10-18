import assert from "node:assert/strict";
import { trustedCodexEnvironment } from "../scripts/TongTrustedCodexBroker.mjs";

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
console.log("PASS: optional Codex-only loopback proxy; remote, authenticated and invalid proxy addresses rejected.");
