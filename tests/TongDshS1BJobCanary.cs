using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace TongDshS1BJobCanary {
static class MainClass {
    const uint SUSPENDED=4,NO_WINDOW=0x08000000,WAIT_OK=0,ACTIVE_LIMIT=8,KILL_ON_CLOSE=0x2000;
    [StructLayout(LayoutKind.Sequential)] struct STARTUP {
        internal uint cb;
        internal IntPtr reserved,desktop,title;
        internal uint x,y,xSize,ySize,xCount,yCount,fill,flags;
        internal ushort showWindow,reserved2;
        internal IntPtr reserved2Ptr,stdIn,stdOut,stdErr;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS {
        internal IntPtr process,thread; internal uint pid,tid;
    }
    [StructLayout(LayoutKind.Sequential)] struct BASIC {
        internal long processTime,jobTime;
        internal uint flags;
        internal UIntPtr minSet,maxSet;
        internal uint activeLimit;
        internal UIntPtr affinity;
        internal uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO {
        internal ulong read,write,other,readBytes,writeBytes,otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED {
        internal BASIC basic;internal IO io;
        internal UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
        internal long userTime,kernelTime;
        internal ulong periodUser,periodKernel;
        internal uint faults,total,active,terminated;
    }
    [DllImport("kernel32.dll",EntryPoint="CreateJobObjectW",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr sec,string name);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED limits,uint size);
    [DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)]
    static extern bool QueryLimits(IntPtr job,int type,out EXTENDED limits,uint size,IntPtr returned);
    [DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)]
    static extern bool QueryAccounting(IntPtr job,int type,out ACCOUNTING limits,uint size,IntPtr returned);
    [DllImport("kernel32.dll",EntryPoint="CreateProcessW",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool CreateProcess(string app,StringBuilder args,IntPtr attr,IntPtr threadAttr,
        bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP startup,out PROCESS result);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);
    static void Need(bool ok,string name) {
        if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),name);
    }
    static uint Active(IntPtr job) {
        ACCOUNTING a;
        Need(QueryAccounting(job,1,out a,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),
            "QueryInformationJobObject");
        return a.active;
    }
    static void Empty(IntPtr job) {
        var watch=Stopwatch.StartNew();
        while(Active(job)>0&&watch.ElapsedMilliseconds<4000)Thread.Sleep(20);
        if(Active(job)!=0)throw new InvalidOperationException("Job did not terminate every descendant");
    }
    static void Success(string scenario,string status,uint before,uint after) {
        Console.WriteLine("{\"scenario\":\""+scenario+"\",\"status\":\""+status+
            "\",\"assignedBeforeResume\":true,\"killOnJobClose\":true,"+
            "\"activeBeforeStop\":"+before+",\"activeAfterStop\":"+after+
            ",\"onlyFixedMock\":true,\"dshStarted\":false,\"modelCalled\":false,"+
            "\"osPermissionSandbox\":false}");
    }
    static int Canary(string scenario) {
        string self=System.Reflection.Assembly.GetExecutingAssembly().Location;
        IntPtr job=IntPtr.Zero,child=IntPtr.Zero,thread=IntPtr.Zero;
        bool assigned=false;
        try {
            job=CreateJobObject(IntPtr.Zero,null);
            Need(job!=IntPtr.Zero,"CreateJobObject");
            var rule=new EXTENDED();
            rule.basic.flags=KILL_ON_CLOSE|ACTIVE_LIMIT;
            rule.basic.activeLimit=4;
            Need(SetInformationJobObject(job,9,ref rule,(uint)Marshal.SizeOf(typeof(EXTENDED))),"JobLimit");
            EXTENDED actual;
            Need(QueryLimits(job,9,out actual,(uint)Marshal.SizeOf(typeof(EXTENDED)),IntPtr.Zero),
                 "QueryJobLimits");
            if((actual.basic.flags&KILL_ON_CLOSE)==0 ||
               (actual.basic.flags&ACTIVE_LIMIT)==0 || actual.basic.activeLimit!=4)
               throw new InvalidOperationException("Job policy mismatch");
            var startup=new STARTUP();
            startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP));
            PROCESS info;
            var argv=new StringBuilder("\""+self+"\" --mock-child "+scenario);
            Need(CreateProcess(self,argv,IntPtr.Zero,IntPtr.Zero,false,
                SUSPENDED|NO_WINDOW,IntPtr.Zero,
                System.IO.Path.GetDirectoryName(self),ref startup,out info),"SuspendedCreate");
            child=info.process;thread=info.thread;
            Need(AssignProcessToJobObject(job,child),"AssignJobBeforeResume");
            assigned=true;
            if(ResumeThread(thread)==uint.MaxValue)
               throw new InvalidOperationException("ResumeThread failed");
            uint before=Active(job);
            if(before==0)throw new InvalidOperationException("No job process");
            if(scenario=="normal") {
                if(WaitForSingleObject(child,4000)!=WAIT_OK)
                    throw new InvalidOperationException("Normal child did not finish");
                uint exit;
                Need(GetExitCodeProcess(child,out exit),"GetExitCode");
                if(exit!=0)throw new InvalidOperationException("Mock child exit nonzero");
                Empty(job);
                Success(scenario,"completed",before,0);
            } else {
                if(scenario=="tree"){
                    var watch=Stopwatch.StartNew();
                    while(Active(job)<2&&watch.ElapsedMilliseconds<3000)Thread.Sleep(20);
                    if(Active(job)<2)throw new InvalidOperationException("Grandchild not contained in job");
                } else Thread.Sleep(scenario=="cancel"?160:450);
                before=Active(job);
                if(before==0)throw new InvalidOperationException("Canary completed too early");
                Need(TerminateJobObject(job,122),"TerminateEntireJob");
                if(WaitForSingleObject(child,4000)!=WAIT_OK)
                    throw new InvalidOperationException("Child remained running");
                Empty(job);
                Success(scenario,scenario=="timeout"?"timed-out":
                    scenario=="cancel"?"cancelled":"descendants-killed",before,0);
            }
            return 0;
        } finally {
            if(job!=IntPtr.Zero) {if(assigned)TerminateJobObject(job,123);CloseHandle(job);}
            if(thread!=IntPtr.Zero)CloseHandle(thread);
            if(child!=IntPtr.Zero)CloseHandle(child);
        }
    }
    static int Main(string[] args) {
        try {
            if(args.Length==2&&args[0]=="--mock-child") {
                if(args[1]=="normal")return 0;
                if(args[1]=="tree") {
                    string exe=System.Reflection.Assembly.GetExecutingAssembly().Location;
                    var start=new ProcessStartInfo(exe,"--mock-grandchild");
                    start.UseShellExecute=false;start.CreateNoWindow=true;
                    using(var grandchild=Process.Start(start)) {
                        if(grandchild==null)throw new InvalidOperationException("No grandchild");
                        Thread.Sleep(12000);
                    }
                    return 0;
                }
                if(args[1]=="cancel"||args[1]=="timeout"){Thread.Sleep(12000);return 0;}
                return 2;
            }
            if(args.Length==1&&args[0]=="--mock-grandchild"){Thread.Sleep(12000);return 0;}
            if(args.Length==2&&args[0]=="--canary" &&
               (args[1]=="normal"||args[1]=="cancel"||args[1]=="timeout"||args[1]=="tree"))
                return Canary(args[1]);
            Console.Error.WriteLine("DSH-S1B only accepts fixed synthetic test modes.");
            return 2;
        } catch {
            Console.Error.WriteLine("DSH-S1B native canary failed (details suppressed).");
            return 1;
        }
    }
}
}
