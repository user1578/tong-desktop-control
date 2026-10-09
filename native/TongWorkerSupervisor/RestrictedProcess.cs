using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace TongWorkerSupervisor {
internal sealed class RestrictedProcess : IDisposable {
    readonly List<IntPtr> sidMemory = new List<IntPtr>();
    readonly object lifetime = new object();
    bool stopped;
    IntPtr sourceToken, restrictedToken, disabledArray, privilegeArray, environment, appContainerSid;
    string appContainerSidValue;
    IntPtr job, process, thread, childIn, childOut, childError;
    internal Stream Input, Output, Error;
    internal bool Started { get; private set; }
    internal bool TokenVerified { get; private set; }
    internal string AppContainerSid { get { return appContainerSidValue; } }

    static IntPtr Sid(string text, List<IntPtr> allocations) {
        IntPtr value; Native.Require(Native.ConvertStringSidToSid(text, out value), "ConvertStringSidToSid");
        allocations.Add(value); return value;
    }
    static void SetSid(IntPtr array, int index, IntPtr sid) {
        Marshal.StructureToPtr(new Native.SID_AND_ATTRIBUTES { Sid=sid, Attributes=0 },
            IntPtr.Add(array, index*Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES))), false);
    }
    internal void Prepare(string workerSid, string taskSid, string serviceSid, string appContainerName) {
        uint access = Native.TOKEN_ASSIGN_PRIMARY | Native.TOKEN_DUPLICATE | Native.TOKEN_QUERY
            | Native.TOKEN_ADJUST_DEFAULT | Native.TOKEN_ADJUST_SESSIONID;
        Native.Require(Native.OpenProcessToken(Native.GetCurrentProcess(), access, out sourceToken), "OpenProcessToken");
        Native.EnsureAppContainerProfile(appContainerName,new[] { Native.WINSOCK_CATALOG_READ_SID });
        appContainerSidValue=Native.DeriveAppContainerSid(appContainerName);
        appContainerSid=Sid(appContainerSidValue,sidMemory);
        int disabledCount=String.IsNullOrEmpty(serviceSid) ? 0 : 1;
        if (disabledCount!=0) {
            disabledArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES)));
            SetSid(disabledArray,0,Sid(serviceSid,sidMemory));
        }
        Native.LUID changeNotify;
        Native.Require(Native.LookupPrivilegeValue(null,"SeChangeNotifyPrivilege",out changeNotify),
            "LookupPrivilegeValue(change notify)");
        var privilegesToDelete=new List<Native.LUID_AND_ATTRIBUTES>();
        foreach (var privilege in Native.TokenPrivileges(sourceToken))
            if (privilege.Luid.LowPart!=changeNotify.LowPart || privilege.Luid.HighPart!=changeNotify.HighPart)
                privilegesToDelete.Add(privilege);
        if (privilegesToDelete.Count!=0) {
            int stride=Marshal.SizeOf(typeof(Native.LUID_AND_ATTRIBUTES));
            privilegeArray=Marshal.AllocHGlobal(stride*privilegesToDelete.Count);
            for (int i=0;i<privilegesToDelete.Count;i++)
                Marshal.StructureToPtr(privilegesToDelete[i],IntPtr.Add(privilegeArray,i*stride),false);
        }
        Native.Require(Native.CreateRestrictedToken(sourceToken, 0,
            (uint)disabledCount, disabledArray, (uint)privilegesToDelete.Count, privilegeArray,
            0, IntPtr.Zero, out restrictedToken),
            "CreateRestrictedToken");
        if (!Native.VerifyToken(restrictedToken, workerSid, taskSid, false, serviceSid)) {
            var identity=new WindowsIdentity(restrictedToken);
            throw new InvalidOperationException("Restricted token inspection failed (restricted="
                + Native.IsTokenRestricted(restrictedToken) + ", user=" + identity.User.Value
                + ", changeNotify=" + Native.HasOnlyChangeNotifyPrivilege(restrictedToken)
                + ", everyone=" + Native.TokenHasSid(restrictedToken,11,Native.EVERYONE_SID,0,0)
                + ", users=" + Native.TokenHasSid(restrictedToken,11,Native.USERS_SID,0,0)
                + ", auth=" + Native.TokenHasSid(restrictedToken,11,Native.AUTHENTICATED_USERS_SID,0,0)
                + ", task=" + Native.TokenHasSid(restrictedToken,11,taskSid,0,0)
                + ", ti=" + Native.TokenHasSid(restrictedToken,11,Native.TRUSTED_INSTALLER_SID,0,0)
                + ", restrictedCode=" + Native.TokenHasSid(restrictedToken,11,Native.RESTRICTED_CODE_SID,0,0)
                + ", service=" + (String.IsNullOrEmpty(serviceSid) || Native.TokenHasSid(restrictedToken,2,serviceSid,0x10,0x10))
                + ", privileges=" + Native.DescribePrivileges(restrictedToken) + ")");
        }
        job = Native.CreateJobObject(IntPtr.Zero, null);
        Native.Require(job != IntPtr.Zero, "CreateJobObject");
        var limits = new Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = Native.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        Native.Require(Native.SetInformationJobObject(job, 9, ref limits,
            (uint)Marshal.SizeOf(typeof(Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION))), "SetInformationJobObject");
    }
    static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    static IntPtr Env(Dictionary<string,string> entries) {
        var keys = new List<string>(entries.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase);
        var buffer = new StringBuilder();
        foreach (string key in keys) {
            if (key.IndexOfAny(new[] {'=', '\0'}) >= 0 || entries[key].IndexOf('\0') >= 0)
                throw new InvalidOperationException("Worker environment contains invalid text");
            buffer.Append(key).Append('=').Append(entries[key]).Append('\0');
        }
        buffer.Append('\0');
        return Marshal.StringToHGlobalUni(buffer.ToString());
    }
    internal void Start(Policy policy, string taskId, string taskSid, string secret, string root) {
        if (job == IntPtr.Zero || restrictedToken == IntPtr.Zero) throw new InvalidOperationException("Token and Job not prepared");
        if (!AclJournal.CheckGrant(root,policy.workerSid,taskSid,appContainerSidValue))
            throw new InvalidOperationException("Worker project ACL grant is incomplete");
        var searchPath=new List<string> { Path.GetDirectoryName(policy.workerExecutablePath) };
        searchPath.AddRange(policy.toolDirectories);
        searchPath.Add(Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32"));
        var env = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
            {"SystemRoot", Environment.GetEnvironmentVariable("SystemRoot")}, {"WINDIR", Environment.GetEnvironmentVariable("SystemRoot")},
            {"USERPROFILE", policy.profileRoot}, {"APPDATA", Path.Combine(policy.profileRoot, "AppData", "Roaming")},
            {"LOCALAPPDATA", Path.Combine(policy.profileRoot, "AppData", "Local")},
            {"TEMP", policy.tempRoot}, {"TMP", policy.tempRoot}, {"HOME", policy.profileRoot},
            {"CODEX_HOME", Path.Combine(policy.profileRoot, ".codex")},
            {"PATH", String.Join(";",searchPath)},
            {"PATHEXT", ".COM;.EXE;.BAT;.CMD"}, {"ComSpec", Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"), "System32", "cmd.exe")},
            {"TONG_WORKER_BOOTSTRAP", secret}, {"TONG_WORKER_TASK_ID", taskId},
            {"TONG_WORKER_TASK_SID", taskSid}, {"TONG_WORKER_SID", policy.workerSid},
            {"TONG_WORKER_PROJECT_ROOT", root}, {"TONG_WORKER_TOKEN_VERIFIED", "1"},
            {"TONG_WORKER_TASK_ACL_VERIFIED", "1"}, {"TONG_WORKER_JOB_VERIFIED", "1"},
            {"TONG_WORKER_IPC_VERIFIED", "1"},
            {"TONG_GATEWAY_SID", policy.gatewaySid},
            {"TONG_GATEWAY_ACCOUNT_SID", policy.gatewayAccountSid ?? policy.gatewaySid},
            {"TONG_SUPERVISOR_SERVICE_SID", policy.supervisorServiceSid ?? ""},
            {"TONG_WORKER_APPCONTAINER_SID", appContainerSidValue},
            {"TONG_WORKER_NATIVE", policy.supervisorImagePath},
            {"TONG_WORKER_CODEX", policy.codexExecutablePath},
            {"TONG_WORKER_CODEX_SHA256", policy.codexExecutableSha256}
        };
        environment = Env(env);
        var attrs = new Native.SECURITY_ATTRIBUTES { nLength=(uint)Marshal.SizeOf(typeof(Native.SECURITY_ATTRIBUTES)), bInheritHandle=true };
        IntPtr parentIn=IntPtr.Zero, parentOut=IntPtr.Zero, parentError=IntPtr.Zero;
        IntPtr attributeList=IntPtr.Zero, handleList=IntPtr.Zero, capabilitiesMemory=IntPtr.Zero,
            capabilitiesArray=IntPtr.Zero, appPackagesPolicy=IntPtr.Zero;
        bool attributeInitialized=false;
        try {
            Native.Require(Native.CreatePipe(out childIn, out parentIn, ref attrs, 0), "CreatePipe(stdin)");
            Native.Require(Native.CreatePipe(out parentOut, out childOut, ref attrs, 0), "CreatePipe(stdout)");
            Native.Require(Native.CreatePipe(out parentError, out childError, ref attrs, 0), "CreatePipe(stderr)");
            foreach (IntPtr handle in new[] { parentIn, parentOut, parentError })
                Native.Require(Native.SetHandleInformation(handle, Native.HANDLE_FLAG_INHERIT, 0), "SetHandleInformation");
            IntPtr required=IntPtr.Zero;
            Native.InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref required);
            if (required==IntPtr.Zero) throw new InvalidOperationException("Handle inheritance attribute length missing");
            attributeList=Marshal.AllocHGlobal(required);
            Native.Require(Native.InitializeProcThreadAttributeList(attributeList,3,0,ref required),
                "InitializeProcThreadAttributeList");
            attributeInitialized=true;
            handleList=Marshal.AllocHGlobal(IntPtr.Size*3);
            Marshal.WriteIntPtr(handleList,0,childIn);
            Marshal.WriteIntPtr(handleList,IntPtr.Size,childOut);
            Marshal.WriteIntPtr(handleList,IntPtr.Size*2,childError);
            Native.Require(Native.UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x20002),
                handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute(handle list)");
            string[] appContainerCapabilities = { Native.WINSOCK_CATALOG_READ_SID };
            int capabilityStride=Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES));
            capabilitiesArray=Marshal.AllocHGlobal(capabilityStride*appContainerCapabilities.Length);
            for (int i=0;i<appContainerCapabilities.Length;i++)
                Marshal.StructureToPtr(new Native.SID_AND_ATTRIBUTES {
                    Sid=Sid(appContainerCapabilities[i],sidMemory), Attributes=0x4 },
                    IntPtr.Add(capabilitiesArray,i*capabilityStride),false);
            var capabilities=new Native.SECURITY_CAPABILITIES { AppContainerSid=appContainerSid,
                Capabilities=capabilitiesArray, CapabilityCount=(uint)appContainerCapabilities.Length };
            capabilitiesMemory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.SECURITY_CAPABILITIES)));
            Marshal.StructureToPtr(capabilities,capabilitiesMemory,false);
            Native.Require(Native.UpdateProcThreadAttribute(attributeList,0,
                new IntPtr(Native.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES),capabilitiesMemory,
                new IntPtr(Marshal.SizeOf(typeof(Native.SECURITY_CAPABILITIES))),IntPtr.Zero,IntPtr.Zero),
                "UpdateProcThreadAttribute(security capabilities)");
            appPackagesPolicy=Marshal.AllocHGlobal(sizeof(int));
            Marshal.WriteInt32(appPackagesPolicy,(int)Native.PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT);
            Native.Require(Native.UpdateProcThreadAttribute(attributeList,0,
                new IntPtr(Native.PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY),appPackagesPolicy,
                new IntPtr(sizeof(int)),IntPtr.Zero,IntPtr.Zero),
                "UpdateProcThreadAttribute(LPAC all-packages opt-out)");
            var startup = new Native.STARTUPINFOEX();
            startup.StartupInfo.cb=(uint)Marshal.SizeOf(typeof(Native.STARTUPINFOEX));
            startup.StartupInfo.dwFlags=Native.STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput=childIn;
            startup.StartupInfo.hStdOutput=childOut;
            startup.StartupInfo.hStdError=childError;
            startup.lpAttributeList=attributeList;
            var info = new Native.PROCESS_INFORMATION();
            var command = new StringBuilder(Quote(policy.workerExecutablePath)
                + " --preserve-symlinks-main " + Quote(policy.workerScriptPath));
            Native.Require(Native.CreateProcessAsUserEx(restrictedToken, policy.workerExecutablePath,
                command, IntPtr.Zero, IntPtr.Zero, true,
                Native.CREATE_SUSPENDED | Native.CREATE_UNICODE_ENVIRONMENT | Native.CREATE_NO_WINDOW
                    | Native.EXTENDED_STARTUPINFO_PRESENT,
                environment, root, ref startup, out info), "CreateProcessAsUser");
            process = info.hProcess; thread = info.hThread;
            if (!Native.AssignProcessToJobObject(job, process)) {
                Native.TerminateProcess(process, 125);
                Native.Require(false, "AssignProcessToJobObject");
            }
            IntPtr workerToken;
            Native.Require(Native.OpenProcessToken(process,Native.TOKEN_QUERY,out workerToken),"OpenProcessToken(Worker)");
            try {
                TokenVerified=Native.VerifyToken(workerToken,policy.workerSid,taskSid,true,
                    policy.supervisorServiceSid,process,appContainerSidValue);
                if (!TokenVerified) throw new InvalidOperationException("Worker process token inspection failed");
            } finally { Native.CloseHandle(workerToken); }
            if (Native.ResumeThread(thread) == 0xffffffff) {
                Native.TerminateJobObject(job, 126);
                Native.Require(false, "ResumeThread");
            }
            Started = true;
            Input = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(parentIn, true), FileAccess.Write, 4096, false);
            Output = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(parentOut, true), FileAccess.Read, 4096, false);
            Error = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(parentError, true), FileAccess.Read, 4096, false);
            parentIn=parentOut=parentError=IntPtr.Zero;
        } finally {
            if (attributeInitialized) Native.DeleteProcThreadAttributeList(attributeList);
            if (attributeList!=IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (capabilitiesMemory!=IntPtr.Zero) Marshal.FreeHGlobal(capabilitiesMemory);
            if (capabilitiesArray!=IntPtr.Zero) Marshal.FreeHGlobal(capabilitiesArray);
            if (appPackagesPolicy!=IntPtr.Zero) Marshal.FreeHGlobal(appPackagesPolicy);
            foreach (IntPtr handle in new[] { childIn, childOut, childError, parentIn, parentOut, parentError })
                if (handle != IntPtr.Zero) Native.CloseHandle(handle);
            childIn=childOut=childError=IntPtr.Zero;
        }
    }
    internal bool HasExited { get { return process != IntPtr.Zero && Native.WaitForSingleObject(process, 0) == 0; } }
    internal uint ExitCode { get { uint code; Native.Require(Native.GetExitCodeProcess(process,out code),"GetExitCodeProcess"); return code; } }
    internal void StopAndWait() {
        lock (lifetime) {
            if (stopped) return;
            if (job == IntPtr.Zero) {
                if (Started) throw new InvalidOperationException("Worker Job handle disappeared before cleanup");
                return;
            }
            Native.Require(Native.TerminateJobObject(job, 127), "TerminateJobObject");
            for (int i=0; i<100; i++) {
                Native.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
                Native.Require(Native.QueryInformationJobObject(job, 1, out accounting,
                    (uint)Marshal.SizeOf(typeof(Native.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero), "QueryInformationJobObject");
                if (accounting.ActiveProcesses == 0) { stopped=true; return; }
                System.Threading.Thread.Sleep(50);
            }
            throw new InvalidOperationException("Job still contains processes; ACL journal retained");
        }
    }
    public void Dispose() {
        lock (lifetime) {
            if (Input != null) Input.Dispose(); if (Output != null) Output.Dispose(); if (Error != null) Error.Dispose();
            if (job != IntPtr.Zero) { Native.CloseHandle(job); job=IntPtr.Zero; }
        }
        if (process != IntPtr.Zero) Native.CloseHandle(process);
        if (thread != IntPtr.Zero) Native.CloseHandle(thread);
        if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        if (privilegeArray != IntPtr.Zero) Marshal.FreeHGlobal(privilegeArray);
        if (disabledArray != IntPtr.Zero) Marshal.FreeHGlobal(disabledArray);
        if (restrictedToken != IntPtr.Zero) Native.CloseHandle(restrictedToken);
        if (sourceToken != IntPtr.Zero) Native.CloseHandle(sourceToken);
        foreach (IntPtr sid in sidMemory) Native.LocalFree(sid);
    }
}
}
