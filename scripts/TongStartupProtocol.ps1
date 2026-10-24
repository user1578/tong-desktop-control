# Shared by the pinned PS5.1 Launcher and Guardian. No production test switches.
# Every preflight descendant inherits a private kill-on-close Job. The child is
# bound by CreateProcess itself. Suspending then assigning still leaks a child
# if its owner dies between those two calls. JOB_LIST is required; no fallback.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Diagnostics;
using System.Threading;
public sealed class TongStartupPreflight : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr c,d; public uint e; public UIntPtr f; public uint g,h; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public int size; public string reserved,desktop,title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reservedSize; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,IntPtr info,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",EntryPoint="CreateProcessW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateBoundProcess(string exe,StringBuilder args,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetHandleInformation(IntPtr h,out uint flags);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct RenameInfo { public uint flags;public IntPtr root;public uint length;public ushort name; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(IntPtr file,int kind,IntPtr info,uint size);
 public static void AtomicReplace(string from,string to){
  // MoveFileEx cannot replace an open target even with FILE_SHARE_DELETE.
  // FileRenameInfoEx + REPLACE_IF_EXISTS | POSIX_SEMANTICS is one kernel
  // rename: existing readers keep the old file, new opens see the new file.
  // Do not ignore readonly attributes, change ACLs, delete first, or fall back
  // on unsupported filesystems/Windows versions. Failed files remain evidence.
  var file=CreateFile(from,0x10000,7,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
  if(file==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error(),"STATE_OPEN_FAILED");
  IntPtr info=IntPtr.Zero;
  try{
   var path=Encoding.Unicode.GetBytes(System.IO.Path.GetFullPath(to));
   int offset=Marshal.OffsetOf(typeof(RenameInfo),"name").ToInt32(),size=checked(offset+path.Length+2);
   info=Marshal.AllocHGlobal(size);for(int n=0;n<size;n++)Marshal.WriteByte(info,n,0);
   Marshal.WriteInt32(info,3);Marshal.WriteInt32(info,offset-4,path.Length);Marshal.Copy(path,0,IntPtr.Add(info,offset),path.Length);
   if(!SetFileInformationByHandle(file,22,info,(uint)size))throw new Win32Exception(Marshal.GetLastWin32Error(),"STATE_REPLACE_FAILED");
  }finally{if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info);CloseHandle(file);}
 }
 IntPtr job,process;
 static void Check(bool success,string code){if(!success)throw new Win32Exception(Marshal.GetLastWin32Error(),code);}
 // Explicit handle allowlist: preflight inherits only NUL. Neither Guardian
 // nor runtime children inherit an owner Job handle (including CodeDom/csc).
 static ProcessInfo Spawn(IntPtr job,string exe,string args,string cwd,IntPtr environment,IntPtr inherited,uint flags) {
  IntPtr size=IntPtr.Zero,list=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero;bool initialized=false;
  try {
   InitializeProcThreadAttributeList(IntPtr.Zero,inherited==IntPtr.Zero?1:2,0,ref size);
   list=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(list,inherited==IntPtr.Zero?1:2,0,ref size),"ATTRIBUTE_INIT_FAILED");initialized=true;
   jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);
   Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"JOB_LIST_FAILED");
   if(inherited!=IntPtr.Zero){handles=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(handles,inherited);Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"HANDLE_LIST_FAILED");}
   var startup=new StartupEx();startup.startup.size=Marshal.SizeOf(startup);startup.attributes=list;
   if((flags&0x08000000)!=0&&inherited!=IntPtr.Zero){startup.startup.flags=0x100;startup.startup.input=inherited;startup.startup.output=inherited;startup.startup.error=inherited;}
   else{startup.startup.flags=1;startup.startup.show=0;}
   ProcessInfo info;
   Check(CreateBoundProcess(exe,new StringBuilder("\""+exe+"\" "+args),IntPtr.Zero,IntPtr.Zero,inherited!=IntPtr.Zero,flags|0x80000|0x400,environment,cwd,ref startup,out info),"BOUND_CREATE_FAILED");
   return info;
  }finally{if(initialized)DeleteProcThreadAttributeList(list);if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);}
 }
 public static Process StartNode(IntPtr job,string exe,string args,string cwd,string environment) {
  IntPtr env=Marshal.StringToHGlobalUni(environment);ProcessInfo info=new ProcessInfo();
  try{info=Spawn(job,exe,args,cwd,env,IntPtr.Zero,0x08000004);var child=Process.GetProcessById((int)info.pid);var handle=child.Handle;Check(ResumeThread(info.thread)!=0xffffffff,"RESUME_FAILED");return child;}
  catch{if(info.process!=IntPtr.Zero){TerminateProcess(info.process,1);WaitForSingleObject(info.process,10000);}throw;}
  finally{Marshal.FreeHGlobal(env);if(info.thread!=IntPtr.Zero)CloseHandle(info.thread);if(info.process!=IntPtr.Zero)CloseHandle(info.process);}
 }
 static IntPtr guardianLease;
 public static string GuardianStartTicks {get;private set;}
 public static void AdoptGuardian(string name) {
  var lease=OpenJobObject(4,false,name);Check(lease!=IntPtr.Zero,"GUARDIAN_JOB_OPEN_FAILED");
  try{bool member;Check(IsProcessInJob(GetCurrentProcess(),lease,out member),"GUARDIAN_JOB_QUERY_FAILED");if(!member)throw new Exception("GUARDIAN_JOB_MISMATCH");
   uint flags;Check(GetHandleInformation(lease,out flags),"GUARDIAN_HANDLE_QUERY_FAILED");if((flags&1)!=0)throw new Exception("GUARDIAN_HANDLE_INHERITABLE");
   // Keep a NON-inheritable handle until native process teardown. Closing the
   // final handle inside finally would kill this process before its exit code.
   using(var ready=EventWaitHandle.OpenExisting(name+"-adopted")){guardianLease=lease;lease=IntPtr.Zero;ready.Set();}
  }finally{if(lease!=IntPtr.Zero)CloseHandle(lease);}
 }
 public static uint StartGuardian(string name,string exe,string args,string cwd,int timeoutMs) {
  IntPtr owner=IntPtr.Zero;ProcessInfo info=new ProcessInfo();
  bool created;using(var ready=new EventWaitHandle(false,EventResetMode.ManualReset,name+"-adopted",out created)){
  if(!created)throw new Exception("GUARDIAN_EVENT_EXISTS");
  try{owner=NewJob(name);info=Spawn(owner,exe,args,cwd,IntPtr.Zero,IntPtr.Zero,0x01000010);
   long createdAt,ended,kernel,user;Check(GetProcessTimes(info.process,out createdAt,out ended,out kernel,out user),"GUARDIAN_IDENTITY_FAILED");GuardianStartTicks=(DateTime.FromFileTimeUtc(createdAt).Ticks/10*10).ToString();
   var watch=Stopwatch.StartNew();
   while(!ready.WaitOne(50)){if(Wait(info.process,0)==0)throw new Exception("GUARDIAN_EXIT_BEFORE_ADOPTION");if(watch.ElapsedMilliseconds>=timeoutMs)throw new Exception("GUARDIAN_ADOPTION_TIMEOUT");}
   return info.pid;
  }
  catch(Exception failure){
   if(info.process!=IntPtr.Zero){
    failure.Data["guardianPid"]=(int)info.pid;failure.Data["guardianExe"]=exe;
    long a,b,c,d;if(GetProcessTimes(info.process,out a,out b,out c,out d))failure.Data["guardianStartTicks"]=(DateTime.FromFileTimeUtc(a).Ticks/10*10).ToString();
    bool clean=false;
    try{if(owner!=IntPtr.Zero&&TerminateJobObject(owner,1)){
     WaitForSingleObject(info.process,10000);var until=Stopwatch.StartNew();
     while(QueryActive(owner)>0&&until.ElapsedMilliseconds<10000)Thread.Sleep(50);
     clean=QueryActive(owner)==0;
    }}catch{clean=false;}
    failure.Data["guardianTreeClean"]=clean;
    uint code;if(GetExitCodeProcess(info.process,out code)&&code!=259)failure.Data["childExitCode"]=(long)code;
   }
   throw;
  }
  finally{if(info.thread!=IntPtr.Zero)CloseHandle(info.thread);if(info.process!=IntPtr.Zero)CloseHandle(info.process);if(owner!=IntPtr.Zero)CloseHandle(owner);}
  }
 }
 static int QueryActive(IntPtr handle){var p=Marshal.AllocHGlobal(48);try{Check(QueryInformationJobObject(handle,1,p,48,IntPtr.Zero),"JOB_QUERY_FAILED");return Marshal.ReadInt32(p,40);}finally{Marshal.FreeHGlobal(p);}}
 static IntPtr NewJob(string name) {
  var handle=CreateJobObject(IntPtr.Zero,name);int error=Marshal.GetLastWin32Error();if(handle==IntPtr.Zero)throw new Win32Exception(error,"JOB_CREATE_FAILED");
  try{if(error==183)throw new Win32Exception(error,"JOB_ALREADY_EXISTS");var data=new Extended();data.basic.flags=0x2000;int size=Marshal.SizeOf(data);var p=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(data,p,false);Check(SetInformationJobObject(handle,9,p,(uint)size),"JOB_CONFIG_FAILED");}finally{Marshal.FreeHGlobal(p);}return handle;}catch{CloseHandle(handle);throw;}
 }
 public TongStartupPreflight(string name,string exe,string args,string cwd) {
  IntPtr nul=IntPtr.Zero; ProcessInfo info=new ProcessInfo();
  try {
   job=NewJob(name);
   nul=CreateFile("NUL",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);
   Check(nul!=new IntPtr(-1),"PREFLIGHT_IO_FAILED");Check(SetHandleInformation(nul,1,1),"PREFLIGHT_IO_FAILED");
   info=Spawn(job,exe,args,cwd,IntPtr.Zero,nul,0x08000004);
   process=info.process;
   Check(ResumeThread(info.thread)!=0xffffffff,"PREFLIGHT_RESUME_FAILED");
  }catch{if(process!=IntPtr.Zero){TerminateProcess(process,1);WaitForSingleObject(process,10000);}Dispose();throw;}
  finally{if(info.thread!=IntPtr.Zero)CloseHandle(info.thread);if(nul!=IntPtr.Zero&&nul!=new IntPtr(-1))CloseHandle(nul);}
 }
 static uint Wait(IntPtr handle,uint timeout){uint status=WaitForSingleObject(handle,timeout);if(status==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error(),"PROCESS_WAIT_FAILED");return status;}
 public bool Exited { get{return Wait(process,0)==0;} }
 public uint ExitCode { get{uint code;Check(GetExitCodeProcess(process,out code),"PREFLIGHT_STATUS_FAILED");return code;} }
 public int Active { get{var p=Marshal.AllocHGlobal(48);try{Check(QueryInformationJobObject(job,1,p,48,IntPtr.Zero),"PREFLIGHT_JOB_FAILED");return Marshal.ReadInt32(p,40);}finally{Marshal.FreeHGlobal(p);}} }
 public void Cancel(){Check(TerminateJobObject(job,1),"PREFLIGHT_CANCEL_FAILED");}
 public void Dispose(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}}
}
'@
function Get-TongStartupIdentity([int]$ProcessId) {
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$ProcessId)
    if($null -eq $p){return $null}
    return [ordered]@{pid=[int]$p.ProcessId;exe=[string]$p.ExecutablePath;startTicks=$p.CreationDate.ToUniversalTime().Ticks.ToString();markerMatches=([string]$p.CommandLine -like ('*'+$RunId+'*'))}
}
function Initialize-TongStartup([string]$Role) {
    $request=Get-Content -LiteralPath (Join-Path $Root 'run\request.json') -Raw | ConvertFrom-Json
    if($request.runId -cne $RunId){throw 'INVALID_RUN'}
    $script:tongDeadline=if($request.PSObject.Properties['startupDeadline']){[long]$request.startupDeadline}else{[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+120000}
    $script:tongRole=$Role
    $script:tongStartup=[ordered]@{schemaVersion=2;runId=$RunId;role=$Role;owner=Get-TongStartupIdentity $PID;launcher=$(if($Role -eq 'launcher'){Get-TongStartupIdentity $PID}else{$null});stage='initializing';guardianCreated=$false;preflightClean=$true;nodeCreated=$false;runtimeClean=$false;jobName=('Local\TongRuntime-'+$RunId);jobActiveAfterCleanup=$null}
    Set-TongStartupStage 'initializing'
}
function Set-TongStartupStage([string]$Stage) {
    $script:tongStartup.stage=$Stage
    $script:tongStartup['at']=[DateTime]::UtcNow.ToString('o')
    $path=Join-Path $Root ('run\'+$script:tongRole+'.'+$RunId+'.json')
    $tempPath=$path+'.'+[guid]::NewGuid().ToString()+'.tmp'
    [IO.File]::WriteAllText($tempPath,($script:tongStartup|ConvertTo-Json -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
    [TongStartupPreflight]::AtomicReplace($tempPath,$path)
}
function Assert-TongStartupActive {
    $request=Get-Content -LiteralPath (Join-Path $Root 'run\request.json') -Raw | ConvertFrom-Json
    if($request.runId -cne $RunId){throw 'INVALID_RUN'}
    $abortPath=Join-Path $Root 'run\abort.json'
    if(Test-Path -LiteralPath $abortPath){$abort=Get-Content -LiteralPath $abortPath -Raw|ConvertFrom-Json;if($abort.runId -ceq $RunId){throw 'START_ABORT'}}
    if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $script:tongDeadline){throw 'START_TIMEOUT'}
}
function Invoke-TongStartupPreflight([string]$Arguments) {
    Assert-TongStartupActive
    $script:tongStartup.preflightClean=$false;Set-TongStartupStage 'preflight'
    $probe=$null
    try {
        $probe=[TongStartupPreflight]::new(('Local\TongPreflight-'+$script:tongRole+'-'+$RunId),$NodeExe,$Arguments,$Root)
        while(-not $probe.Exited){Assert-TongStartupActive;Start-Sleep -Milliseconds 100}
        $script:tongStartup['preflightExitCode']=[long]$probe.ExitCode
        if($probe.ExitCode -ne 0){throw 'APPROVAL_DENIED'}
    }finally{
        if($null -ne $probe){
            try {
                if($probe.Active -gt 0){$probe.Cancel()}
                $until=[DateTime]::UtcNow.AddSeconds(10)
                while($probe.Active -gt 0 -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 50}
                $script:tongStartup.preflightClean=($probe.Active -eq 0)
            }finally{$probe.Dispose()}
        }
    }
    if(-not $script:tongStartup.preflightClean){throw 'PREFLIGHT_CLEANUP_REQUIRED'}
    Assert-TongStartupActive
    Set-TongStartupStage 'preflight_complete'
}
function Complete-TongStartupFailure($Failure,[string]$Stage=$script:tongStartup.stage) {
    $exception=$Failure.Exception
    while($exception.InnerException){$exception=$exception.InnerException}
    $code=$exception.Message
    $script:tongStartup['failure']=[ordered]@{role=$script:tongRole;stage=$Stage;code=$(if($code -cmatch '^[A-Z_]{1,64}$'){$code}else{'SUPERVISOR_START_FAILED'});exceptionType=$exception.GetType().FullName;errorId=$(if($Failure.FullyQualifiedErrorId -cmatch '^[A-Za-z0-9_.,-]{1,128}$'){$Failure.FullyQualifiedErrorId}else{'REDACTED'});hresult=$exception.HResult;win32Error=$(if($exception -is [ComponentModel.Win32Exception]){$exception.NativeErrorCode}else{$null});exitCode=2;diagnosticId=($RunId+'/'+$script:tongRole)}
    if($script:tongStartup.Contains('preflightExitCode')){$script:tongStartup.failure['preflightExitCode']=$script:tongStartup.preflightExitCode}
    if($exception.Data.Contains('childExitCode')){$script:tongStartup.failure['childExitCode']=$exception.Data['childExitCode']}
    $script:tongStartup['finishedAt']=[DateTime]::UtcNow.ToString('o')
    $script:tongStartup['code']=$script:tongStartup.failure.code
    Set-TongStartupStage $Stage
}
