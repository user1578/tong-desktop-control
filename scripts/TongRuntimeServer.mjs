import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const [settings] = await once(process, 'message');
if (settings.schemaVersion !== 1 || !['devspace','gateway'].includes(settings.role)) throw new Error('Runtime child settings rejected');
if(settings.recoveryGrantId){
  const {withLoginRecovery}=await import('./TongLoginRecovery.mjs');
  await withLoginRecovery(settings.root,'child',()=>serve(settings),{grantId:settings.recoveryGrantId});
}else await serve(settings);
async function serve(settings){
const preserved=settings.profile!==undefined;
const stage=(name,details={})=>process.send({event:'stage',stage:name,...details});
stage('settings_received');
if(preserved){
  const {validateProductionProfile,verifyRuntimeApproval,readApprovedEnabledState}=await import('./TongProductionProfile.mjs');
  const profile=validateProductionProfile(settings.profile);
  if(profile.root!==settings.root||profile.codeRoot!==settings.tongRoot||profile.gatewayPort!==settings.gatewayPort||profile.upstreamPort!==settings.upstreamPort)throw new Error('Approved runtime settings rejected');
  await verifyRuntimeApproval(profile,'start');if(profile.agentdockEnabled)await readApprovedEnabledState(profile);
  stage('approval_verified');
  const {verifyRuntimeCandidate}=await import('./TongRuntimeCandidate.mjs');await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});
  stage('candidate_verified');
}else{
  const marker=JSON.parse(await readFile(join(settings.root,'runtime-synthetic.json'),'utf8'));
  if(marker.scope!=='synthetic-only')throw new Error('Synthetic runtime marker required');
}
let closing, server, upstream;
if (settings.role === 'devspace') {
  let config;
  if(preserved){
    const profile=settings.profile;
    if(profile.mode==='production'){
      const {dirname}=await import('node:path');const home=dirname(profile.configDir);
      Object.assign(process.env,{USERPROFILE:home,APPDATA:join(home,'AppData','Roaming'),LOCALAPPDATA:join(home,'AppData','Local')});
    }
    Object.assign(process.env,{TONG_RESTRICTED_MCP:'1',TONG_RESTRICTED_ROOT:profile.demoRoot,DEVSPACE_CONFIG_DIR:profile.configDir,DEVSPACE_STATE_DIR:profile.oauthStateDir,
      HOST:'127.0.0.1',PORT:String(profile.upstreamPort),DEVSPACE_PUBLIC_BASE_URL:profile.publicOrigin,DEVSPACE_TOOL_MODE:'minimal',DEVSPACE_SKILLS:'0',DEVSPACE_SUBAGENTS:'0',DEVSPACE_ARTIFACTS:'0',DEVSPACE_AGENT_DIR:profile.demoRoot});
    if(profile.mode==='production-simulation')process.env.DEVSPACE_OAUTH_OWNER_TOKEN=settings.ownerToken;
    if(profile.agentdockEnabled)Object.assign(process.env,{TONG_AGENTDOCK_ENABLED:'1',TONG_AGENTDOCK_URL:`http://127.0.0.1:${profile.agentdockPort}/mcp`,TONG_AGENTDOCK_TOKEN:settings.agentdockToken,
      TONG_AGENTDOCK_POLICY_PATH:join(profile.root,'tong-policy','agentdock-access.json'),TONG_AGENTDOCK_AUDIT_PATH:join(profile.root,'logs','agentdock-audit.jsonl')});
    const {loadConfig}=await import(pathToFileURL(join(profile.codeRoot,'node_modules','@waishnav','devspace','dist','config.js')).href);
    try{config=loadConfig(process.env);}catch{throw new Error('Original DevSpace configuration unavailable');}
    stage('config_loaded');
    delete process.env.DEVSPACE_OAUTH_OWNER_TOKEN;
    const loggingReady=once(process,'message');process.send({event:'logging_secret',ownerToken:config.oauth.ownerToken});
    const [loggingAck]=await loggingReady;if(loggingAck.event!=='logging_ready')throw new Error('Private log protection unavailable');
    stage('log_protection_ready');
    if(config.host!=='127.0.0.1'||config.port!==profile.upstreamPort||config.stateDir.toLowerCase()!==profile.oauthStateDir.toLowerCase()||config.publicBaseUrl!==profile.publicOrigin||config.allowedRoots.length!==1||config.allowedRoots[0].toLowerCase()!==profile.demoRoot.toLowerCase()||config.subagents.enabled)throw new Error('Original runtime configuration mismatch');
    const tools=await import(pathToFileURL(join(profile.codeRoot,'scripts','TongMcpTools.mjs')).href);
    if(typeof tools.configureTongMcpState==='function')tools.configureTongMcpState({stateDir:profile.runtimeDir,demoRoot:profile.demoRoot,...(profile.mode==='production-simulation'?{scanRoots:[]}:{})});
    // Old 58786 code uses the same default codeRoot/runtime path; no state env override.
  }else{
  Object.assign(process.env, { TONG_RESTRICTED_MCP: '1', TONG_RESTRICTED_ROOT: join(settings.root, 'workspace', 'demo'), TONG_LOCAL_STATE_DIR: join(settings.root, 'tong-state'),
    TONG_AGENTDOCK_ENABLED: '1', TONG_AGENTDOCK_URL: 'http://127.0.0.1:18765/mcp', TONG_AGENTDOCK_TOKEN: settings.agentdockToken,
    TONG_AGENTDOCK_POLICY_PATH: join(settings.root, 'tong-policy', 'agentdock-access.json'), TONG_AGENTDOCK_AUDIT_PATH: join(settings.root, 'logs', 'agentdock-audit.jsonl'), DEVSPACE_CONFIG_DIR: join(settings.root, 'tong-state', 'config') });
  }
  stage('server_import_begin');
  const importBegan=performance.now(),importCpu=process.cpuUsage();
  const { createServer } = await import(pathToFileURL(join(settings.tongRoot, 'node_modules', '@waishnav', 'devspace', 'dist', 'server.js')).href);
  const cpu=process.cpuUsage(importCpu);
  stage('server_import_complete',{importDurationMs:Math.round(performance.now()-importBegan),importCpuUserMs:Math.round(cpu.user/1000),importCpuSystemMs:Math.round(cpu.system/1000),rssBytes:process.memoryUsage().rss});
  if(settings.preflightOnly===true&&settings.profile?.mode==='production-simulation'){stage('preflight_complete');process.disconnect();process.exit(0);}
  server = createServer(config??{ host:'127.0.0.1', port:settings.upstreamPort, publicBaseUrl:`http://127.0.0.1:${settings.gatewayPort}`,
    oauth:{ownerToken:settings.ownerToken,accessTokenTtlSeconds:3600,refreshTokenTtlSeconds:7200,scopes:['devspace'],allowedRedirectHosts:['127.0.0.1']},
    allowedHosts:['127.0.0.1','localhost'],allowedRoots:[process.env.TONG_RESTRICTED_ROOT],agentDir:process.env.TONG_RESTRICTED_ROOT,
    stateDir:join(settings.root,'tong-state','devspace'),worktreeRoot:join(settings.root,'tong-state','unused-worktrees'),
    toolMode:'minimal',widgets:'off',skillsEnabled:false,artifactsEnabled:false,subagents:{enabled:false,providers:[]},logging:{level:'warn',format:'json'} });
  upstream=server.app.listen(settings.upstreamPort,'127.0.0.1'); await once(upstream,'listening');
} else {
  if (Object.keys(process.env).some(key => /TOKEN|TONG_|AGENTDOCK_|DEVSPACE_/i.test(key))) throw new Error('Gateway inherited secret environment');
  const { startMcpGateway }=await import(pathToFileURL(join(settings.tongRoot,'scripts','TongMcpGateway.mjs')).href);
  upstream=startMcpGateway({listenPort:settings.gatewayPort,upstreamPort:settings.upstreamPort,workspaceRoot:preserved?settings.profile.demoRoot:join(settings.root,'workspace','demo')}); await once(upstream,'listening');
}
process.send({event:'ready',role:settings.role,pid:process.pid,secretEnvironmentPresent:settings.role==='devspace'});
async function stop() {
  closing ??= (async()=>{ upstream.closeAllConnections(); if(server) await server.close(); await new Promise(ok=>upstream.close(ok)); process.send({event:'stopped',role:settings.role}); process.disconnect(); })();
  await closing;
}
process.on('message',message=>{if(message?.event==='stop') void stop().catch(()=>{process.exitCode=1;process.disconnect();});});
process.on('disconnect',()=>{if(!closing) void stop().catch(()=>{process.exitCode=1;});});
process.on('SIGTERM',()=>{void stop();});
}
