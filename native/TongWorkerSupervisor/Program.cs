using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace TongWorkerSupervisor {
internal static class Wire {
    internal const int MaxFrame = 262144, WorkerMaxFrame = 65536;
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=MaxFrame };
    internal static string ReadLine(Stream stream) {
        using (var bytes = new MemoryStream()) {
            while (true) {
                int b = stream.ReadByte();
                if (b < 0) throw new EndOfStreamException("IPC peer closed");
                if (b == 10) return Encoding.UTF8.GetString(bytes.ToArray()).TrimEnd('\r');
                if (bytes.Length >= MaxFrame) throw new InvalidOperationException("IPC frame too large");
                bytes.WriteByte((byte)b);
            }
        }
    }
    internal static void WriteLine(Stream stream, string value) {
        byte[] bytes = Encoding.UTF8.GetBytes(value + "\n");
        if (bytes.Length > MaxFrame) throw new InvalidOperationException("IPC frame too large");
        stream.Write(bytes, 0, bytes.Length); stream.Flush();
    }
    internal static Dictionary<string,object> Object(string line) {
        var value = Json.DeserializeObject(line) as Dictionary<string,object>;
        if (value == null) throw new InvalidOperationException("IPC object expected");
        return value;
    }
    internal static string Text(Dictionary<string,object> value, string key) {
        object item;
        if (!value.TryGetValue(key, out item) || !(item is string)) throw new InvalidOperationException("IPC field invalid: " + key);
        return (string)item;
    }
    internal static int Number(Dictionary<string,object> value, string key) {
        object item;
        if (!value.TryGetValue(key, out item) || !(item is int)) throw new InvalidOperationException("IPC number invalid: " + key);
        return (int)item;
    }
    internal static byte[] Base64Url(string value) {
        if (value.Length != 43) throw new InvalidOperationException("IPC secret invalid");
        string base64 = value.Replace('-', '+').Replace('_', '/') + "=";
        return Convert.FromBase64String(base64);
    }
    internal static string Signature(byte[] key, string payload) {
        using (var hmac = new HMACSHA256(key))
            return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).TrimEnd('=').Replace('+','-').Replace('/','_');
    }
    internal static bool SameSignature(string actual,string expected) {
        if (actual==null || expected==null || actual.Length!=43 || expected.Length!=43) return false;
        int different=0;
        for (int i=0; i<43; i++) different|=actual[i]^expected[i];
        return different==0;
    }
}
internal sealed class PeerRejectedException : Exception {
    internal PeerRejectedException(string message) : base(message) { }
}

internal sealed class PipeHost : IDisposable {
    readonly Policy policy;
    readonly AclJournal journal;
    readonly PipeSecurity security;
    readonly object gate = new object();
    NamedPipeServerStream listening;
    RestrictedProcess active;
    volatile bool stopping;
    internal PipeHost(Policy policy) {
        this.policy=policy;
        if (!policy.syntheticOnly) {
            IntPtr token;
            Native.Require(Native.OpenProcessToken(Native.GetCurrentProcess(),Native.TOKEN_QUERY,out token),"OpenProcessToken(service)");
            try {
                if (!Native.TokenHasSid(token,2,policy.supervisorServiceSid,4,4))
                    throw new UnauthorizedAccessException("Supervisor service SID missing");
            } finally { Native.CloseHandle(token); }
            policy.CheckStateRoot();
            policy.CheckCodexVersion();
        }
        journal=new AclJournal(policy.stateRoot);
        journal.Recover();
        security=new PipeSecurity();
        AddPipeSid("S-1-5-18", PipeAccessRights.FullControl);
        AddPipeSid("S-1-5-32-544", PipeAccessRights.FullControl);
        AddPipeSid(policy.syntheticOnly ? policy.workerSid : policy.supervisorServiceSid, PipeAccessRights.FullControl);
        AddPipeSid(policy.gatewaySid, PipeAccessRights.ReadWrite);
        security.SetAccessRuleProtection(true, false);
    }
    void AddPipeSid(string sid, PipeAccessRights rights) {
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), rights, AccessControlType.Allow));
    }
    internal void Run() {
        while (!stopping) {
            using (var pipe = new NamedPipeServerStream(policy.pipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security)) {
                lock (gate) listening=pipe;
                try {
                    pipe.WaitForConnection();
                    if (!stopping) Handle(pipe);
                } catch (ObjectDisposedException) { if (!stopping) throw; }
                catch (IOException) { if (!stopping) throw; }
                catch (PeerRejectedException) { /* authentication failed before or after safely closing a task */ }
                finally { lock (gate) listening=null; }
            }
        }
    }
    void CheckClient(NamedPipeServerStream pipe) {
        uint pid;
        Native.Require(Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out pid),
            "GetNamedPipeClientProcessId");
        // Pin one process object and use its token and image throughout the
        // handshake. Do not validate a PID, close its handle, then reopen that
        // numeric PID after it could have exited and been reused.
        IntPtr client=Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION,false,pid);
        if (client==IntPtr.Zero) throw new PeerRejectedException("IPC peer process exited during verification");
        IntPtr processToken=IntPtr.Zero;
        try {
            Native.Require(Native.OpenProcessToken(client,Native.TOKEN_QUERY,out processToken),"OpenProcessToken(pipe client)");
            string processUser;
            bool processGroup, processAccount;
            using (var identity=new WindowsIdentity(processToken)) {
                processUser=identity.User.Value;
                processGroup=policy.syntheticOnly
                    ? processUser.Equals(policy.gatewaySid,StringComparison.OrdinalIgnoreCase)
                    : Native.TokenHasSid(processToken,2,policy.gatewaySid,4,4);
                processAccount=policy.syntheticOnly
                    || processUser.Equals(policy.gatewayAccountSid,StringComparison.OrdinalIgnoreCase);
            }
            string pipeUser=null;
            bool pipeGroup=false, pipeAccount=false;
            try {
                pipe.RunAsClient(delegate {
                    using (var identity=WindowsIdentity.GetCurrent(true)) {
                        pipeUser=identity.User.Value;
                        pipeGroup=policy.syntheticOnly
                            ? pipeUser.Equals(policy.gatewaySid,StringComparison.OrdinalIgnoreCase)
                            : Native.TokenHasSid(identity.Token,2,policy.gatewaySid,4,4);
                        pipeAccount=policy.syntheticOnly
                            || pipeUser.Equals(policy.gatewayAccountSid,StringComparison.OrdinalIgnoreCase);
                    }
                });
            } catch (IOException) {
                throw new PeerRejectedException("IPC peer disconnected before token verification");
            }
            if (!processGroup || !processAccount || !pipeGroup || !pipeAccount
                || !String.Equals(pipeUser,processUser,StringComparison.OrdinalIgnoreCase))
                throw new PeerRejectedException("Gateway service or account SID does not match pipe peer process");
            string image=Native.ImagePath(client);
            if (!String.Equals(Path.GetFullPath(image),Path.GetFullPath(policy.bridgeImagePath),StringComparison.OrdinalIgnoreCase))
                throw new PeerRejectedException("Gateway bridge image path mismatch");
            Policy.Pin(image,policy.bridgeImageSha256);
            uint currentPid;
            Native.Require(Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out currentPid),
                "GetNamedPipeClientProcessId(recheck)");
            if (currentPid!=pid) throw new PeerRejectedException("IPC client process changed during verification");
        } finally {
            if (processToken!=IntPtr.Zero) Native.CloseHandle(processToken);
            Native.CloseHandle(client);
        }
    }
    internal static string TaskSid(string id) {
        Guid guid;
        if (!Guid.TryParseExact(id, "D", out guid)) throw new InvalidOperationException("Task ID invalid");
        byte[] data=guid.ToByteArray();
        uint a=BitConverter.ToUInt32(data,0), b=BitConverter.ToUInt32(data,4), c=BitConverter.ToUInt32(data,8), d=BitConverter.ToUInt32(data,12);
        return "S-1-5-21-"+a+"-"+b+"-"+c+"-"+d;
    }
    void Handle(NamedPipeServerStream pipe) {
        CheckClient(pipe);
        var command=Wire.Object(Wire.ReadLine(pipe));
        string kind=Wire.Text(command,"kind");
        if (kind == "inspect") {
            string id=Wire.Text(command,"projectId"), inspectedRoot=Wire.Text(command,"projectRoot");
            policy.RootFor(id,inspectedRoot);
            bool separate=!(policy.syntheticOnly ? policy.gatewaySid : policy.gatewayAccountSid)
                .Equals(policy.workerSid,StringComparison.OrdinalIgnoreCase);
            if (!separate && !policy.syntheticOnly) throw new InvalidOperationException("Worker identity not separate");
            string probeId=Guid.NewGuid().ToString("D");
            using (var probe=new RestrictedProcess()) probe.Prepare(policy.workerSid,TaskSid(probeId),
                policy.supervisorServiceSid,Native.AppContainerName(probeId,policy.syntheticOnly));
            Wire.WriteLine(pipe,Wire.Json.Serialize(new { ok=true, source="native-token-and-pipe",
                gatewaySid=policy.gatewaySid, workerSid=policy.workerSid, ipcPeerSid=policy.gatewaySid,
                projectId=id, projectRoot=inspectedRoot, restrictedToken=true,
                credentialsSeparated=separate, cleanEnvironment=true,
                jobObjectKillOnClose=true, privateIpcAuthenticated=true, appContainerBoundary=true,
                syntheticOnly=policy.syntheticOnly }));
            return;
        }
        if (kind != "launch") throw new InvalidOperationException("Unsupported IPC command");
        string taskId=Wire.Text(command,"taskId"), secret=Wire.Text(command,"bootstrapSecret");
        string execute=Wire.Text(command,"executeFrame");
        string signedPayloadJson=Wire.Text(command,"payloadJson");
        if (Encoding.UTF8.GetByteCount(execute)>Wire.WorkerMaxFrame)
            throw new InvalidOperationException("Worker protocol frame too large");
        if (Encoding.UTF8.GetByteCount(signedPayloadJson)>Wire.WorkerMaxFrame)
            throw new InvalidOperationException("Signed Worker payload too large");
        int timeout=Wire.Number(command,"timeoutMs");
        if (timeout<1000 || timeout>3600000) throw new InvalidOperationException("Task timeout invalid");
        var first=Wire.Object(execute);
        if (Wire.Text(first,"kind")!="execute" || Wire.Number(first,"protocolVersion")!=1
            || Wire.Text(first,"taskId")!=taskId) throw new InvalidOperationException("Worker start frame invalid");
        var envelope=first["envelope"] as Dictionary<string,object>;
        if (envelope==null || Wire.Number(envelope,"protocolVersion")!=1) throw new InvalidOperationException("Worker envelope invalid");
        var payload=envelope["payload"] as Dictionary<string,object>;
        if (payload==null || Wire.Text(payload,"taskId")!=taskId || Wire.Number(payload,"timeoutMs")!=timeout)
            throw new InvalidOperationException("Worker payload invalid");
        string root=policy.RootFor(Wire.Text(payload,"projectId"),Wire.Text(payload,"projectRoot"));
        // Verify the exact UTF-8 bytes signed by Node, then ensure that JSON is
        // exactly the payload in the execute frame. Serializer escaping may differ.
        if (!Wire.Json.Serialize(Wire.Object(signedPayloadJson)).Equals(Wire.Json.Serialize(payload),StringComparison.Ordinal))
            throw new PeerRejectedException("Signed Worker payload changed");
        byte[] key=Wire.Base64Url(secret);
        if (key.Length!=32 || !Wire.SameSignature(Wire.Signature(key,signedPayloadJson),Wire.Text(envelope,"signature")))
            throw new PeerRejectedException("Worker HMAC invalid");
        string taskSid=TaskSid(taskId);
        using (var worker=new RestrictedProcess()) {
            lock (gate) active=worker;
            bool granted=false, stopped=false;
            try {
                worker.Prepare(policy.workerSid,taskSid,policy.supervisorServiceSid,
                    Native.AppContainerName(taskId,policy.syntheticOnly));
                journal.Grant(taskId,root,policy.workerSid,taskSid,worker.AppContainerSid); granted=true;
                // Pin files again immediately before each start.
                policy.PinWorkerFiles();
                worker.Start(policy,taskId,taskSid,secret,root);
                Wire.WriteLine(pipe,Wire.Json.Serialize(new { ok=true, workerTokenVerified=worker.TokenVerified,
                    jobObjectKillOnClose=true, appContainerBoundary=true,
                    appContainerSid=worker.AppContainerSid }));
                string actual=Wire.ReadLine(pipe);
                if (!actual.Equals(execute,StringComparison.Ordinal)) throw new PeerRejectedException("Worker start frame changed");
                Wire.WriteLine(worker.Input,actual);
                var upstream=pipe.CopyToAsync(worker.Input);
                var downstream=worker.Output.CopyToAsync(pipe);
                var stderr=Task.Run(delegate { try { worker.Error.CopyTo(policy.syntheticOnly ? Console.OpenStandardError() : Stream.Null); } catch (IOException) { } });
                var exit=Task.Run(delegate { while (!worker.HasExited) Thread.Sleep(25); });
                var limit=Task.Delay(timeout+5000);
                int completed=Task.WaitAny(new Task[] { upstream, downstream, exit, limit });
                if (policy.syntheticOnly && worker.HasExited)
                    Console.Error.WriteLine("Synthetic Worker exit code: " + worker.ExitCode);
                if (completed==2) downstream.Wait(2000); // drain the child's final result before closing its Job
                if (downstream.IsFaulted) throw downstream.Exception;
                worker.StopAndWait(); stopped=true;
                try { pipe.Dispose(); } catch { }
                Task.WaitAll(new Task[] { upstream, downstream, stderr }, 2000);
            } finally {
                if (!stopped) worker.StopAndWait();
                if (granted) journal.Restore(taskId);
                lock (gate) active=null;
            }
        }
    }
    internal void Stop() {
        if (stopping) return;
        stopping=true;
        NamedPipeServerStream pipe; RestrictedProcess worker;
        lock (gate) { pipe=listening; worker=active; }
        if (pipe!=null) pipe.Dispose();
        if (worker!=null) worker.StopAndWait();
    }
    public void Dispose() { Stop(); journal.Dispose(); }
}

internal sealed class SupervisorService : ServiceBase {
    PipeHost host;
    Thread thread;
    readonly Policy policy;
    internal SupervisorService(Policy policy) { this.policy=policy; ServiceName="TongWorkerSupervisor"; CanStop=true; }
    protected override void OnStart(string[] args) {
        host=new PipeHost(policy);
        thread=new Thread(new ThreadStart(delegate { host.Run(); })); thread.IsBackground=true; thread.Start();
    }
    protected override void OnStop() {
        if (host!=null) {
            host.Stop();
            if (!thread.Join(30000)) throw new InvalidOperationException("Supervisor thread did not stop");
            host.Dispose();
        }
    }
}

internal static class Program {
    static void Bridge(Policy policy) {
        using (var identity=WindowsIdentity.GetCurrent()) {
            if (policy.syntheticOnly) {
                if (!identity.User.Value.Equals(policy.gatewaySid,StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("Synthetic bridge account mismatch");
            } else if (!identity.User.Value.Equals(policy.gatewayAccountSid,StringComparison.OrdinalIgnoreCase)
                || !Native.TokenHasSid(identity.Token,2,policy.gatewaySid,4,4)) {
                throw new UnauthorizedAccessException("Gateway bridge service or account SID missing");
            }
        }
        using (var pipe=new NamedPipeClientStream(".",policy.pipeName,PipeDirection.InOut,
            PipeOptions.Asynchronous,TokenImpersonationLevel.Impersonation)) {
            pipe.Connect(5000);
            uint pid;
            Native.Require(Native.GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out pid),
                "GetNamedPipeServerProcessId");
            IntPtr process=Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION,false,pid), token=IntPtr.Zero;
            Native.Require(process!=IntPtr.Zero,"OpenProcess(supervisor)");
            try {
                uint currentPid;
                Native.Require(Native.GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out currentPid),
                    "GetNamedPipeServerProcessId(recheck)");
                if (currentPid!=pid) throw new UnauthorizedAccessException("Supervisor pipe process changed during verification");
                string image=Native.ImagePath(process);
                if (!String.Equals(Path.GetFullPath(image),Path.GetFullPath(policy.supervisorImagePath),StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("Supervisor image path mismatch");
                Policy.Pin(image,policy.supervisorImageSha256);
                Native.Require(Native.OpenProcessToken(process,Native.TOKEN_QUERY,out token),"OpenProcessToken(supervisor)");
                using (var identity=new WindowsIdentity(token))
                    if (!identity.User.Value.Equals(policy.workerSid,StringComparison.OrdinalIgnoreCase)
                        || (!String.IsNullOrEmpty(policy.supervisorServiceSid)
                            && !Native.TokenHasSid(token,2,policy.supervisorServiceSid,0x10,0x10)))
                        throw new UnauthorizedAccessException("Supervisor account mismatch");
            } finally { if (token!=IntPtr.Zero) Native.CloseHandle(token); Native.CloseHandle(process); }
            var input=Console.OpenStandardInput(); var output=Console.OpenStandardOutput();
            string first=Wire.ReadLine(input);
            Wire.WriteLine(pipe,first);
            string reply=Wire.ReadLine(pipe);
            Wire.WriteLine(output,reply);
            if (!reply.Contains("\"ok\":true") || first.Contains("\"inspect\"")) return;
            var toServer=input.CopyToAsync(pipe);
            var toGateway=pipe.CopyToAsync(output);
            Task.WaitAny(toServer,toGateway);
        }
    }
    static void Attest(string userSid,string taskSid,string gatewayAccountSid,string projectRoot,string taskId,
        string serviceSid,string appContainerSid) {
        IntPtr token;
        Native.Require(Native.OpenProcessToken(Native.GetCurrentProcess(),Native.TOKEN_QUERY,out token),"OpenProcessToken(attest)");
        try {
            bool verified=Native.VerifyToken(token,userSid,taskSid,true,serviceSid,IntPtr.Zero,appContainerSid);
            Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
            Native.Require(Native.QueryJobLimits(IntPtr.Zero,9,out limits,
                (uint)Marshal.SizeOf(typeof(Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION)),IntPtr.Zero),"QueryInformationJobObject(limits)");
            bool killOnClose=(limits.BasicLimitInformation.LimitFlags & Native.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)!=0;
            bool separated=!userSid.Equals(gatewayAccountSid,StringComparison.OrdinalIgnoreCase);
            bool acl=AclJournal.CheckGrant(projectRoot,userSid,taskSid,appContainerSid);
            bool env=Environment.GetEnvironmentVariable("TONG_WORKER_TASK_ID")==taskId
                && Environment.GetEnvironmentVariable("TONG_WORKER_TASK_SID")==taskSid
                && Environment.GetEnvironmentVariable("OPENAI_API_KEY")==null
                && Environment.GetEnvironmentVariable("CODEX_API_KEY")==null
                && Environment.GetEnvironmentVariable("GH_TOKEN")==null;
            verified=verified && killOnClose && acl && env && separated;
            Console.WriteLine(Wire.Json.Serialize(new { verified=verified,
                actualSid=WindowsIdentity.GetCurrent().User.Value, restrictingSid=taskSid,
                appContainerSid=appContainerSid,
                restrictedToken=Native.IsTokenRestricted(token), jobObjectKillOnClose=killOnClose,
                taskAclVerified=acl, cleanEnvironment=env, credentialsSeparated=separated }));
            if (!verified) Environment.ExitCode=2;
        } finally { Native.CloseHandle(token); }
    }
    static int Main(string[] args) {
        try {
            if (args.Length==8 && args[0]=="--attest") { Attest(args[1],args[2],args[3],args[4],args[5],args[6],args[7]); return Environment.ExitCode; }
            if (args.Length==4 && args[0]=="--acl-grant-synthetic") {
                var testPolicy=Policy.Load(args[1],true);
                using (var journal=new AclJournal(testPolicy.stateRoot)) {
                    string appContainerSid=Native.DeriveAppContainerSid(Native.AppContainerName(args[2],true));
                    journal.Grant(args[2],testPolicy.RootFor(args[3],testPolicy.projectRoots[args[3]]),
                        testPolicy.workerSid,PipeHost.TaskSid(args[2]),appContainerSid);
                }
                return 0;
            }
            if (args.Length==2 && args[0]=="--acl-recover-synthetic") {
                var testPolicy=Policy.Load(args[1],true);
                using (var journal=new AclJournal(testPolicy.stateRoot)) journal.Recover();
                return 0;
            }
            if (args.Length==1 && args[0]=="--appcontainer-sid-synthetic") {
                Native.EnsureAppContainerProfile("TongDesktopControlNativeSynthetic",new[] {
                    Native.WINSOCK_CATALOG_READ_SID });
                Console.WriteLine(Native.DeriveAppContainerSid("TongDesktopControlNativeSynthetic"));
                return 0;
            }
            if (args.Length==1 && args[0]=="--appcontainer-delete-synthetic") {
                Native.DeleteAppContainerProfile("TongDesktopControlNativeSynthetic");
                return 0;
            }
            if (args.Length!=2) throw new InvalidOperationException("Expected --service, --serve, --bridge or synthetic equivalent and an absolute policy path");
            bool synthetic=args[0].EndsWith("-synthetic",StringComparison.Ordinal);
            var policy=Policy.Load(args[1],synthetic);
            if (args[0]=="--service") { ServiceBase.Run(new SupervisorService(policy)); return 0; }
            if (args[0]=="--serve" || args[0]=="--serve-synthetic") {
                if (!WindowsIdentity.GetCurrent().User.Value.Equals(policy.workerSid,StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("Supervisor account mismatch");
                using (var host=new PipeHost(policy)) host.Run();
                return 0;
            }
            if (args[0]=="--bridge" || args[0]=="--bridge-synthetic") { Bridge(policy); return 0; }
            throw new InvalidOperationException("Unsupported supervisor mode");
        } catch (Exception error) {
            Console.Error.WriteLine("TongWorkerSupervisor: " + (args.Length>0 && args[0].EndsWith("-synthetic",StringComparison.Ordinal)
                ? error.ToString() : error.Message));
            return 1;
        }
    }
}
}
