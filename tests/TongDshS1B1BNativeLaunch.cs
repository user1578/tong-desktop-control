using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Threading;

namespace TongDshS1B1BNativeProbe {
static class Canary {
    const uint TOKEN_ASSIGN_PRIMARY=1,TOKEN_DUPLICATE=2,TOKEN_QUERY=8,
        TOKEN_ADJUST_DEFAULT=0x80,TOKEN_ADJUST_SESSIONID=0x100;
    const uint CREATE_SUSPENDED=4,CREATE_NO_WINDOW=0x08000000,CREATE_UNICODE_ENVIRONMENT=0x400;
    const uint KILL_ON_CLOSE=0x2000,ACTIVE_LIMIT=8,WAIT_OK=0;
    const string RESTRICT_SID="S-1-5-32-545";
    [StructLayout(LayoutKind.Sequential)]struct SID_ATTRIBUTES {internal IntPtr sid;internal uint attributes;}
    [StructLayout(LayoutKind.Sequential)]struct STARTUP {
        internal uint cb;internal IntPtr reserved,desktop,title;
        internal uint x,y,width,height,countX,countY,fill,flags;
        internal ushort show,reserved2;
        internal IntPtr reservedPointer,stdin,stdout,stderr;
    }
    [StructLayout(LayoutKind.Sequential)]struct PROC {
        internal IntPtr process,thread;internal uint processId,threadId;
    }
    [StructLayout(LayoutKind.Sequential)]struct BASIC {
        internal long processTime,jobTime;internal uint flags;
        internal UIntPtr minWorking,maxWorking;internal uint activeLimit;
        internal UIntPtr affinity;internal uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]struct IO {
        internal ulong reads,writes,other,readBytes,writeBytes,otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]struct EXTENDED {
        internal BASIC basic;internal IO io;
        internal UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [StructLayout(LayoutKind.Sequential)]struct ACCOUNTING {
        internal long userTime,kernelTime;internal ulong periodUser,periodKernel;
        internal uint faults,total,active,terminated;
    }
    [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(
        IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]static extern bool CreateRestrictedToken(
        IntPtr source,uint flags,uint disableCount,IntPtr disable,
        uint deleteCount,IntPtr deleted,uint sidCount,IntPtr sids,out IntPtr result);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool ConvertStringSidToSid(string sid,out IntPtr value);
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,EntryPoint="CreateProcessAsUserW",SetLastError=true)]
    static extern bool CreateProcessAsUser(IntPtr token,string path,StringBuilder args,
        IntPtr procAttr,IntPtr threadAttr,bool inherit,uint flags,IntPtr env,
        string cwd,ref STARTUP startup,out PROC info);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,EntryPoint="CreateProcessWithTokenW",SetLastError=true)]
    static extern bool CreateProcessWithToken(IntPtr token,uint logon,string path,
        StringBuilder args,uint flags,IntPtr env,string cwd,ref STARTUP startup,out PROC info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="CreateJobObjectW",SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED info,uint size);
    [DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)]
    static extern bool QueryAccounting(IntPtr job,int kind,out ACCOUNTING value,uint size,IntPtr used);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool TerminateProcess(IntPtr process,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr process,uint duration);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr process,out uint status);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr ptr);

    static void Require(bool value,string operation) {
        if(!value)throw new Win32Exception(Marshal.GetLastWin32Error(),operation);
    }
    static uint Active(IntPtr job) {
        ACCOUNTING info;
        Require(QueryAccounting(job,1,out info,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),
            "JobAccounting");
        return info.active;
    }
    static void AwaitEmpty(IntPtr job) {
        var watch=Stopwatch.StartNew();
        while(Active(job)>0&&watch.ElapsedMilliseconds<4000)Thread.Sleep(30);
        if(Active(job)!=0)throw new InvalidOperationException("job-not-empty");
    }
    static void Protect(string path,bool isDirectory,bool forRestricted,FileSystemRights rights) {
        FileSystemSecurity security=isDirectory?(FileSystemSecurity)Directory.GetAccessControl(path):
            (FileSystemSecurity)File.GetAccessControl(path);
        security.SetAccessRuleProtection(true,false);
        InheritanceFlags inherit=isDirectory?
            InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None;
        foreach(SecurityIdentifier principal in new[]{
            WindowsIdentity.GetCurrent().User,new SecurityIdentifier("S-1-5-18"),
            new SecurityIdentifier("S-1-5-32-544")}) {
            security.AddAccessRule(new FileSystemAccessRule(principal,
                FileSystemRights.FullControl,inherit,PropagationFlags.None,AccessControlType.Allow));
        }
        if(forRestricted)security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(RESTRICT_SID),rights,inherit,
            PropagationFlags.None,AccessControlType.Allow));
        if(isDirectory)Directory.SetAccessControl(path,(DirectorySecurity)security);
        else File.SetAccessControl(path,(FileSecurity)security);
    }
    static int Run(bool withRestrictingSid) {
        // The child is fixed, compiled at this test's temporary directory.
        // NEVER accept arbitrary executable path or DSH model instructions.
        string parentBinary=System.Reflection.Assembly.GetExecutingAssembly().Location;
        string executable=Path.Combine(Path.GetDirectoryName(parentBinary),"TongDshS1B1BNativeChild.exe");
        if(!File.Exists(executable))throw new InvalidOperationException("fixed-child-missing");
        string executableDigest;
        using(var file=File.OpenRead(executable))
        using(var hash=SHA256.Create()){
            executableDigest=BitConverter.ToString(hash.ComputeHash(file)).Replace("-","").ToLowerInvariant();
        }
        string temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd('\\')+"\\";
        string data=Path.GetFullPath(Path.Combine(temp,"TongDshS1B1BNative-"+Guid.NewGuid().ToString("N")));
        if(!data.StartsWith(temp,StringComparison.OrdinalIgnoreCase)||Directory.Exists(data))
            throw new InvalidOperationException("unsafe-temp-directory");
        Directory.CreateDirectory(data);
        IntPtr original=IntPtr.Zero,restricted=IntPtr.Zero,sid=IntPtr.Zero,sidArray=IntPtr.Zero;
        IntPtr environment=IntPtr.Zero,job=IntPtr.Zero,process=IntPtr.Zero,thread=IntPtr.Zero;
        bool assigned=false;
        try{
            var open=Path.Combine(data,"allowed.txt");
            var closed=Path.Combine(data,"private.txt");
            var output=Path.Combine(data,"result.txt");
            File.WriteAllText(open,"canary");
            File.WriteAllText(closed,"canary");
            File.WriteAllText(output,"000");
            Protect(data,true,true,FileSystemRights.ReadAndExecute|FileSystemRights.WriteData);
            Protect(open,false,true,FileSystemRights.ReadData);
            Protect(closed,false,false,FileSystemRights.ReadData);
            Protect(output,false,true,FileSystemRights.WriteData|FileSystemRights.ReadData);
            Require(OpenProcessToken(GetCurrentProcess(),
                TOKEN_ASSIGN_PRIMARY|TOKEN_DUPLICATE|TOKEN_QUERY|
                TOKEN_ADJUST_DEFAULT|TOKEN_ADJUST_SESSIONID,out original),"OpenProcessToken");
            Require(ConvertStringSidToSid(RESTRICT_SID,out sid),"ConvertStringSidToSid");
            sidArray=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SID_ATTRIBUTES)));
            Marshal.StructureToPtr(new SID_ATTRIBUTES{sid=sid,attributes=0},sidArray,false);
            Require(CreateRestrictedToken(original,1,0,IntPtr.Zero,0,IntPtr.Zero,
                withRestrictingSid?1u:0u,
                withRestrictingSid?sidArray:IntPtr.Zero,out restricted),"CreateRestrictedToken");
            if(withRestrictingSid && !IsTokenRestricted(restricted))
                throw new InvalidOperationException("not-restricted");
            job=CreateJobObject(IntPtr.Zero,null);
            Require(job!=IntPtr.Zero,"CreateJobObject");
            var jobLimits=new EXTENDED();
            jobLimits.basic.flags=KILL_ON_CLOSE|ACTIVE_LIMIT;
            jobLimits.basic.activeLimit=4;
            Require(SetInformationJobObject(job,9,ref jobLimits,
                (uint)Marshal.SizeOf(typeof(EXTENDED))),"SetInformationJobObject");
            // Do not forward user tokens, keys, home or network credentials.
            string win=Environment.GetEnvironmentVariable("SystemRoot")??@"C:\Windows";
            string envBlock="SystemRoot="+win+"\0WINDIR="+win+"\0TEMP="+data+"\0TMP="+data+"\0\0";
            environment=Marshal.StringToHGlobalUni(envBlock);
            string command="\""+executable+"\" --fixed-acl-canary \""+data+"\"";
            var startup=new STARTUP();
            startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP));
            PROC info;
            uint mode=CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT;
            bool started=CreateProcessAsUser(restricted,executable,new StringBuilder(command),
                IntPtr.Zero,IntPtr.Zero,false,mode,environment,data,ref startup,out info);
            if(!started) {
                int error=Marshal.GetLastWin32Error();
                if(error!=1314)throw new Win32Exception(error,"CreateProcessAsUser");
                // No ordinary CreateProcess fallback; the restriction is required.
                Require(CreateProcessWithToken(restricted,0,executable,new StringBuilder(command),
                    mode,environment,data,ref startup,out info),"CreateProcessWithToken");
            }
            process=info.process;thread=info.thread;
            IntPtr childToken=IntPtr.Zero;
            try{
                Require(OpenProcessToken(process,TOKEN_QUERY,out childToken),"OpenChildToken");
                if(withRestrictingSid && !IsTokenRestricted(childToken))
                    throw new InvalidOperationException("child-not-restricted");
            } finally { if(childToken!=IntPtr.Zero)CloseHandle(childToken); }
            if(!AssignProcessToJobObject(job,process)){
                int error=Marshal.GetLastWin32Error();
                TerminateProcess(process,125);
                throw new Win32Exception(error,"AssignProcessToJobObject");
            }
            assigned=true;
            uint suspendedCount=ResumeThread(thread);
            if(suspendedCount!=1)
                throw new InvalidOperationException("child-was-not-suspended-before-job");
            if(WaitForSingleObject(process,9000)!=WAIT_OK)
                throw new InvalidOperationException("child-timeout");
            uint exitCode;Require(GetExitCodeProcess(process,out exitCode),"GetExitCodeProcess");
            if(!withRestrictingSid && exitCode==3){
                string resultBits=File.ReadAllText(output);
                AwaitEmpty(job);
                if(resultBits!="110" && resultBits!="010")
                    throw new InvalidOperationException("unexpected-baseline-bits");
                Console.WriteLine("{\"status\":\"passed\",\"comparisonOnly\":true,"+
                    "\"fixedNativeChildLoaded\":true,\"privateFileDenied\":false,"+
                    "\"jobAssignedBeforeResume\":true,\"modelCalled\":false,"+
                    "\"dshStarted\":false,\"fullSandboxVerified\":false}");
                return 0;
            }
            if(exitCode!=0) {
                string bits=File.ReadAllText(output);
                Console.Error.WriteLine("Native child exit=0x"+exitCode.ToString("x8")+
                  " flags="+(System.Text.RegularExpressions.Regex.IsMatch(bits,"^[01]{3}$")?bits:"unknown"));
                throw new InvalidOperationException("native-child-failed");
            }
            AwaitEmpty(job);
            if(File.ReadAllText(output)!="111")
                throw new InvalidOperationException("canary-access-results");
            // Verify parent still can read the private file.
            using(var f=File.OpenRead(closed)){if(f.Length==0)throw new InvalidOperationException("private-empty");}
            Console.WriteLine("{\"status\":\"passed\",\"fixedNativeChild\":true,"+
                "\"restrictedChildStarted\":true,\"restrictedChildTokenVerified\":true,"+
                "\"readAllowed\":true,\"privateDenied\":true,\"parentPrivateReadable\":true,"+
                "\"jobAssignedBeforeResume\":true,\"activeAfterStop\":0,"+
                "\"modelCalled\":false,\"dshStarted\":false,\"networkIsolationVerified\":false,"+
                "\"fullSandboxVerified\":false,\"childSha256\":\""+executableDigest+"\"}");
            return 0;
        } finally {
            if(job!=IntPtr.Zero){if(assigned)TerminateJobObject(job,124);CloseHandle(job);}
            if(process!=IntPtr.Zero && !assigned)TerminateProcess(process,125);
            if(thread!=IntPtr.Zero)CloseHandle(thread);
            if(process!=IntPtr.Zero)CloseHandle(process);
            if(restricted!=IntPtr.Zero)CloseHandle(restricted);
            if(original!=IntPtr.Zero)CloseHandle(original);
            if(sid!=IntPtr.Zero)LocalFree(sid);
            if(sidArray!=IntPtr.Zero)Marshal.FreeHGlobal(sidArray);
            if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
            try{Directory.Delete(data,true);}catch{Console.Error.WriteLine("Temporary native canary requires cleanup");}
        }
    }
    static int Main(string[] args){
        if(args.Length!=1||(args[0]!="--fixed-test"&&args[0]!="--baseline-test"))return 2;
        try{return Run(args[0]=="--fixed-test");}
        catch(Exception ex) {
            string[] allowedReasons={"not-restricted","child-not-restricted",
                "unexpected-baseline-bits","native-child-failed","canary-access-results",
                "job-not-empty","child-timeout","private-empty","fixed-child-missing"};
            string reason=Array.IndexOf(allowedReasons,ex.Message)>=0?ex.Message:"other";
            Console.Error.WriteLine("Native B1B test stopped: "+ex.GetType().Name+
                " reason="+reason+
                (ex is Win32Exception?" Win32="+((Win32Exception)ex).NativeErrorCode:""));
            return 1;
        }
    }
}
}
