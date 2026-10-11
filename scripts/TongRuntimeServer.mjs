import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const [settings] = await once(process, 'message');
if (settings.schemaVersion !== 1 || !['devspace','gateway'].includes(settings.role)) throw new Error('Runtime child settings rejected');
const marker = JSON.parse(await readFile(join(settings.root, 'runtime-synthetic.json'), 'utf8'));
if (marker.scope !== 'synthetic-only') throw new Error('Synthetic runtime marker required');
let closing, server, upstream;
if (settings.role === 'devspace') {
  Object.assign(process.env, { TONG_RESTRICTED_MCP: '1', TONG_RESTRICTED_ROOT: join(settings.root, 'workspace', 'demo'), TONG_LOCAL_STATE_DIR: join(settings.root, 'tong-state'),
    TONG_AGENTDOCK_ENABLED: '1', TONG_AGENTDOCK_URL: 'http://127.0.0.1:18765/mcp', TONG_AGENTDOCK_TOKEN: settings.agentdockToken,
    TONG_AGENTDOCK_POLICY_PATH: join(settings.root, 'tong-policy', 'agentdock-access.json'), TONG_AGENTDOCK_AUDIT_PATH: join(settings.root, 'logs', 'agentdock-audit.jsonl'), DEVSPACE_CONFIG_DIR: join(settings.root, 'tong-state', 'config') });
  const { createServer } = await import(pathToFileURL(join(settings.tongRoot, 'node_modules', '@waishnav', 'devspace', 'dist', 'server.js')).href);
  server = createServer({ host:'127.0.0.1', port:settings.upstreamPort, publicBaseUrl:`http://127.0.0.1:${settings.gatewayPort}`,
    oauth:{ownerToken:settings.ownerToken,accessTokenTtlSeconds:3600,refreshTokenTtlSeconds:7200,scopes:['devspace'],allowedRedirectHosts:['127.0.0.1']},
    allowedHosts:['127.0.0.1','localhost'],allowedRoots:[process.env.TONG_RESTRICTED_ROOT],agentDir:process.env.TONG_RESTRICTED_ROOT,
    stateDir:join(settings.root,'tong-state','devspace'),worktreeRoot:join(settings.root,'tong-state','unused-worktrees'),
    toolMode:'minimal',widgets:'off',skillsEnabled:false,artifactsEnabled:false,subagents:{enabled:false,providers:[]},logging:{level:'warn',format:'json'} });
  upstream=server.app.listen(settings.upstreamPort,'127.0.0.1'); await once(upstream,'listening');
} else {
  if (Object.keys(process.env).some(key => /TOKEN|TONG_|AGENTDOCK_|DEVSPACE_/i.test(key))) throw new Error('Gateway inherited secret environment');
  const { startMcpGateway }=await import(pathToFileURL(join(settings.tongRoot,'scripts','TongMcpGateway.mjs')).href);
  upstream=startMcpGateway({listenPort:settings.gatewayPort,upstreamPort:settings.upstreamPort,workspaceRoot:join(settings.root,'workspace','demo')}); await once(upstream,'listening');
}
process.send({event:'ready',role:settings.role,pid:process.pid,secretEnvironmentPresent:settings.role==='devspace'});
async function stop() {
  closing ??= (async()=>{ upstream.closeAllConnections(); if(server) await server.close(); await new Promise(ok=>upstream.close(ok)); process.send({event:'stopped',role:settings.role}); process.disconnect(); })();
  await closing;
}
process.on('message',message=>{if(message?.event==='stop') void stop().catch(()=>{process.exitCode=1;process.disconnect();});});
process.on('disconnect',()=>{if(!closing) void stop().catch(()=>{process.exitCode=1;});});
process.on('SIGTERM',()=>{void stop();});
