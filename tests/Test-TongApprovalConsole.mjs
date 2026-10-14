import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Exercise only the real challenge comparison expressions, never the signing
// branches. Native input belongs to a fresh hidden diagnostic console and has
// no approval meaning. Reverting to Console.ReadLine must reject the 259-char
// exact input with a single Enter on Windows PowerShell 5.1.
const helper=fileURLToPath(new URL('../scripts/TongProductionApproval.ps1',import.meta.url));
const shell=process.argv[2]??'powershell.exe';
const resultPath='D:\\Tong\\state\\p26-cold-start-20261014\\console-probe-'+randomUUID()+'.json';
const script=`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version Latest
$output=[Console]::Out
try {
Add-Type -OutputAssembly '${resultPath}.dll' -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
public static class TongDiagnosticConsole {
    public static bool NeededSecondEnter;
    static Timer readerDeadline;
    public static void StartReaderDeadline(int milliseconds) {
        // Survives controller termination: this callback runs in the reader.
        readerDeadline=new Timer(state => Environment.Exit(124), null, milliseconds, Timeout.Infinite);
    }
    [StructLayout(LayoutKind.Explicit, Size=20)]
    public struct Input {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(4)] public int Down;
        [FieldOffset(8)] public ushort Repeat;
        [FieldOffset(10)] public ushort Key;
        [FieldOffset(14)] public char Character;
    }
    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AllocConsole();
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern short VkKeyScan(char character);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetStdHandle(int kind, IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetConsoleMode(IntPtr handle, uint mode);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FlushConsoleInputBuffer(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNumberOfConsoleInputEvents(IntPtr handle, out uint count);
    [DllImport("kernel32.dll", EntryPoint="WriteConsoleInputW", SetLastError=true)]
    static extern bool WriteConsoleInput(IntPtr handle, Input[] input, uint count, out uint written);
    public static void Start() {
        FreeConsole();
        if (!AllocConsole()) throw new Win32Exception();
        ShowWindow(GetConsoleWindow(), 0);
        IntPtr input=CreateFile("CONIN$", 0xc0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (input==new IntPtr(-1) || !SetHandleInformation(input,1,1) || !SetStdHandle(-10,input)) throw new Win32Exception();
        if (!SetConsoleMode(GetStdHandle(-10), 7)) throw new Win32Exception();
    }
    public static void Feed(string value) {
        IntPtr handle=GetStdHandle(-10);
        if (!FlushConsoleInputBuffer(handle)) throw new Win32Exception();
        string line=value+"\\r";
        Input[] records=new Input[line.Length];
        for (int i=0; i<line.Length; ++i) records[i]=new Input {
            Type=1, Down=1, Repeat=1, Character=line[i], Key=(ushort)(line[i]=='\\r'?13:VkKeyScan(line[i])&255)
        };
        uint written;
        if (!WriteConsoleInput(handle, records, (uint)records.Length, out written) || written!=records.Length)
            throw new Win32Exception();
    }
    public static void Stop() { FreeConsole(); }
    public static int Run(string shell, string script, string value, string id, bool finishLegacy) {
        FlushConsoleInputBuffer(GetStdHandle(-10));
        var info=new ProcessStartInfo(shell, "-NoLogo -NoProfile -NonInteractive -EncodedCommand "+script);
        info.UseShellExecute=false;
        info.WindowStyle=ProcessWindowStyle.Hidden;
        using (var ready=new EventWaitHandle(false, EventResetMode.ManualReset, id))
        using (var process=Process.Start(info)) {
            try {
                if (!ready.WaitOne(5000)) throw new Exception("Diagnostic child not ready");
                Feed(value);
                // Framework's small reader can wait again after consuming the
                // long line's Enter. Characterize separately from the fixed gate.
                NeededSecondEnter=finishLegacy && !process.WaitForExit(200);
                if (NeededSecondEnter) Feed("");
                if (!process.WaitForExit(5000)) {
                    uint pending; GetNumberOfConsoleInputEvents(GetStdHandle(-10),out pending);
                    throw new Exception("Diagnostic child timed out; pending input="+pending);
                }
                return process.ExitCode;
            } finally {
                if (!process.HasExited) process.Kill();
            }
        }
    }
}
'@
[void][Reflection.Assembly]::LoadFrom('${resultPath}.dll')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'","''")}',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Helper parse failed'}
$conditions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst]},$true) |
    ForEach-Object {$_.Clauses[0].Item1.Extent.Text} |
    Where-Object {$_ -match '\\$challenge' -and $_ -match '-cne'})
if($conditions.Count -ne 2){throw 'Expected both typed challenge comparisons'}
$challenge='DIAGNOSTIC '+('x'*248)
$cases=@(
    @{name='empty';input='';refused=$true},
    @{name='exact-259';input=$challenge;refused=$false},
    @{name='missing-suffix';input=$challenge.Substring(0,254);refused=$true},
    @{name='wrong-case';input='diagnostic '+('x'*248);refused=$true},
    @{name='extra-character';input=$challenge+'x';refused=$true}
)
$results=@()
try {
    [TongDiagnosticConsole]::Start()
    $id=[Guid]::NewGuid().ToString('N')
    $legacy=@'
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
'@
    $legacy+=[Environment]::NewLine+"[void][Reflection.Assembly]::LoadFrom('${resultPath}.dll');[TongDiagnosticConsole]::StartReaderDeadline(7000)"
    $legacy+=[Environment]::NewLine+"[Threading.EventWaitHandle]::OpenExisting('$id').Set()|Out-Null"
    $legacy+=[Environment]::NewLine+'$received=[Console]::ReadLine()'
    $legacy+=[Environment]::NewLine+'[IO.File]::WriteAllText(''${resultPath}'',(@{length=$received.Length;exact=($received -ceq (''DIAGNOSTIC ''+(''x''*248)))}|ConvertTo-Json -Compress))'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($legacy))
    $code=[TongDiagnosticConsole]::Run([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName,$encoded,$challenge,$id,$true)
    if($code -ne 0){throw 'Legacy characterization failed'}
    $legacyResult=[IO.File]::ReadAllText('${resultPath}')|ConvertFrom-Json
    $legacyResult|Add-Member -NotePropertyName neededSecondEnter -NotePropertyValue ([TongDiagnosticConsole]::NeededSecondEnter)
    foreach($condition in $conditions){
        foreach($case in $cases){
            # A fresh CLR must inherit the diagnostic console before it caches
            # standard handles. The controller began with redirected stdio.
            $child=@'
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
try {
'@
            $child+=[Environment]::NewLine+"[void][Reflection.Assembly]::LoadFrom('${resultPath}.dll');[TongDiagnosticConsole]::StartReaderDeadline(7000)"
            foreach($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-TypedChallenge'},$false)){$child+=[Environment]::NewLine+$fn.Extent.Text}
            $id=[Guid]::NewGuid().ToString('N')
            $child+=[Environment]::NewLine+"[Threading.EventWaitHandle]::OpenExisting('$id').Set()|Out-Null"
            $child+=[Environment]::NewLine+'$challenge='''+$challenge+''''+[Environment]::NewLine+'$refused='+$condition
            $child+=[Environment]::NewLine+'[IO.File]::WriteAllText(''${resultPath}'',([bool]$refused|ConvertTo-Json -Compress))'
            $child+=[Environment]::NewLine+'} catch {[IO.File]::WriteAllText(''${resultPath}'',(@{error=$_.Exception.Message;stack=$_.ScriptStackTrace}|ConvertTo-Json -Compress));exit 1}'
            $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
            try {$code=[TongDiagnosticConsole]::Run([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName,$encoded,$case.input,$id,$false)}catch{throw ($case.name+': '+$_.Exception.Message)}
            if($code -ne 0){throw ('Diagnostic child: '+[IO.File]::ReadAllText('${resultPath}'))}
            $refused=[IO.File]::ReadAllText('${resultPath}')|ConvertFrom-Json
            $results+=@{name=$case.name;expectedRefused=$case.refused;actualRefused=$refused}
        }
    }
} finally {[TongDiagnosticConsole]::Stop()}
[IO.File]::WriteAllText('${resultPath}',(@{cases=$results;legacy=$legacyResult}|ConvertTo-Json -Depth 4 -Compress))
} catch {
    [IO.File]::WriteAllText('${resultPath}',(@{error=$_.Exception.Message;stack=$_.ScriptStackTrace}|ConvertTo-Json -Compress))
    exit 1
}
`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:20000});
assert.equal(result.error?.message,undefined);
const data=JSON.parse(readFileSync(resultPath,'utf8'));
assert.equal(result.status,0,JSON.stringify(data));
if(shell.toLowerCase().endsWith('powershell.exe')){
    assert.equal(data.legacy.neededSecondEnter,true,'Framework default reader cannot finish the long line with one Enter');
}
for(const item of data.cases)assert.equal(item.actualRefused,item.expectedRefused,item.name);
// The same reader watchdog exits independently while the main thread blocks.
const watchdogScript=`[void][Reflection.Assembly]::LoadFrom('${resultPath}.dll');[TongDiagnosticConsole]::StartReaderDeadline(100);[Threading.Thread]::Sleep([Threading.Timeout]::Infinite)`;
const watchdog=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(watchdogScript,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(watchdog.error?.message,undefined);
assert.equal(watchdog.status,124,'reader must exit without the controller or input');
// Full entry-point refusals still happen before any descriptor or signing I/O.
const marker='PRIVATE_DIAGNOSTIC_INPUT_12345';
for(const [mode,input,stage] of [['approve','', 'interactive-entry'],['receipt-unseal',marker,'operation']]){
    const refused=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Mode',mode,'-ProfileJson',marker],{env,input,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(refused.error,undefined);
    assert.equal(refused.status,2);
    assert.match(refused.stderr,new RegExp('stage='+stage+'; type='));
    assert.match(refused.stderr,/TongProductionApproval.ps1/);
    assert.ok(!refused.stderr.includes(marker),'diagnostics must not echo input');
    assert.ok(!refused.stdout.includes('"approved":true'));
}
console.log(JSON.stringify({passed:true,consoleCases:data.cases.length,legacyReadLength:data.legacy.length,legacyNeededSecondEnter:data.legacy.neededSecondEnter,diagnosticRefusals:2,independentReaderDeadline:true,shell,productionSigningExecuted:false,evidence:resultPath}));
