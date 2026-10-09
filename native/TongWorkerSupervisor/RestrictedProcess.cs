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
    IntPtr sourceToken, restrictedToken, disabledArray, restrictedArray, environment;
    IntPtr job, process, thread, childIn, childOut, childError;
    internal Stream Input, Output, Error;
    internal bool Started { get; private set; }

    static IntPtr Sid(string text, List<IntPtr> allocations) {
        IntPtr value; Native.Require(Native.ConvertStringSidToSid(text, out value), "ConvertStringSidToSid");
        allocations.Add(value); return value;
    }
    static void SetSid(IntPtr array, int index, IntPtr sid) {
        Marshal.StructureToPtr(new Native.SID_AND_ATTRIBUTES { Sid=sid, Attributes=0 },
            IntPtr.Add(array, index*Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES))), false);
    }
    internal void Prepare(string workerSid, string taskSid, string serviceSid) {
        uint access = Native.TOKEN_ASSIGN_PRIMARY | Native.TOKEN_DUPLICATE | Native.TOKEN_QUERY
            | Native.TOKEN_ADJUST_DEFAULT | Native.TOKEN_ADJUST_SESSIONID;
        Native.Require(Native.OpenProcessToken(Native.GetCurrentProcess(), access, out sourceToken), "OpenProcessToken");
        string[] restriction = { "S-1-1-0", "S-1-5-32-545", "S-1-5-11", "S-1-5-12", workerSid, taskSid };
        int disabledCount=String.IsNullOrEmpty(serviceSid) ? 1 : 2;
        disabledArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES))*disabledCount);
        SetSid(disabledArray, 0, Sid("S-1-5-11", sidMemory));
        if (disabledCount==2) SetSid(disabledArray,1,Sid(serviceSid,sidMemory));
        restrictedArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES))*restriction.Length);
        for (int i=0; i<restriction.Length; i++) SetSid(restrictedArray, i, Sid(restriction[i], sidMemory));
        Native.Require(Native.CreateRestrictedToken(sourceToken, Native.DISABLE_MAX_PRIVILEGE,
            (uint)disabledCount, disabledArray, 0, IntPtr.Zero, (uint)restriction.Length, restrictedArray, out restrictedToken),
            "CreateRestrictedToken");
        if (!Native.VerifyToken(restrictedToken, workerSid, taskSid, false, serviceSid))
            throw new InvalidOperationException("Restricted token inspection failed");
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
            {"TONG_GATEWAY_SID", policy.gatewaySid},
            {"TONG_GATEWAY_ACCOUNT_SID", policy.gatewayAccountSid ?? policy.gatewaySid},
            {"TONG_SUPERVISOR_SERVICE_SID", policy.supervisorServiceSid ?? ""},
            {"TONG_WORKER_NATIVE", policy.supervisorImagePath},
            {"TONG_WORKER_CODEX", policy.codexExecutablePath},
            {"TONG_WORKER_CODEX_SHA256", policy.codexExecutableSha256}
        };
        environment = Env(env);
        var attrs = new Native.SECURITY_ATTRIBUTES { nLength=(uint)Marshal.SizeOf(typeof(Native.SECURITY_ATTRIBUTES)), bInheritHandle=true };
        IntPtr parentIn=IntPtr.Zero, parentOut=IntPtr.Zero, parentError=IntPtr.Zero;
        IntPtr attributeList=IntPtr.Zero, handleList=IntPtr.Zero;
        bool attributeInitialized=false;
        try {
            Native.Require(Native.CreatePipe(out childIn, out parentIn, ref attrs, 0), "CreatePipe(stdin)");
            Native.Require(Native.CreatePipe(out parentOut, out childOut, ref attrs, 0), "CreatePipe(stdout)");
            Native.Require(Native.CreatePipe(out parentError, out childError, ref attrs, 0), "CreatePipe(stderr)");
            foreach (IntPtr handle in new[] { parentIn, parentOut, parentError })
                Native.Require(Native.SetHandleInformation(handle, Native.HANDLE_FLAG_INHERIT, 0), "SetHandleInformation");
            IntPtr required=IntPtr.Zero;
            Native.InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref required);
            if (required==IntPtr.Zero) throw new InvalidOperationException("Handle inheritance attribute length missing");
            attributeList=Marshal.AllocHGlobal(required);
            Native.Require(Native.InitializeProcThreadAttributeList(attributeList,1,0,ref required),
                "InitializeProcThreadAttributeList");
            attributeInitialized=true;
            handleList=Marshal.AllocHGlobal(IntPtr.Size*3);
            Marshal.WriteIntPtr(handleList,0,childIn);
            Marshal.WriteIntPtr(handleList,IntPtr.Size,childOut);
            Marshal.WriteIntPtr(handleList,IntPtr.Size*2,childError);
            Native.Require(Native.UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x20002),
                handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute(handle list)");
            var startup = new Native.STARTUPINFOEX();
            startup.StartupInfo.cb=(uint)Marshal.SizeOf(typeof(Native.STARTUPINFOEX));
            startup.StartupInfo.dwFlags=Native.STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput=childIn;
            startup.StartupInfo.hStdOutput=childOut;
            startup.StartupInfo.hStdError=childError;
            startup.lpAttributeList=attributeList;
            var info = new Native.PROCESS_INFORMATION();
            var command = new StringBuilder(Quote(policy.workerExecutablePath) + " " + Quote(policy.workerScriptPath));
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
        if (restrictedArray != IntPtr.Zero) Marshal.FreeHGlobal(restrictedArray);
        if (disabledArray != IntPtr.Zero) Marshal.FreeHGlobal(disabledArray);
        if (restrictedToken != IntPtr.Zero) Native.CloseHandle(restrictedToken);
        if (sourceToken != IntPtr.Zero) Native.CloseHandle(sourceToken);
        foreach (IntPtr sid in sidMemory) Native.LocalFree(sid);
    }
}
}
