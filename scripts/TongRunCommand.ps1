# Private command host: the parent passes one JSON request on stdin. No shell interpolation.
# PowerShell 7 compiles this small helper in memory; no binaries or global configuration are installed.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $request = [Console]::ReadLine() | ConvertFrom-Json
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

public static class TongCommandHost {
    // Same kill-on-close Job Object primitive used by TongWorkerSupervisor.
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    static IntPtr job;
    static void Require(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static int Run(string executable, string[] args, string cwd) {
        job = CreateJobObject(IntPtr.Zero, null);
        Require(job != IntPtr.Zero);
        var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
        Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
        // Enroll this host BEFORE spawning. Children inherit the job even if their parent exits.
        // Keep the handle until host exit; closing it explicitly here would also kill this host.
        Require(AssignProcessToJobObject(job, GetCurrentProcess()));
        var info = new ProcessStartInfo(executable) {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using (var child = Process.Start(info)) {
            child.StandardInput.Close();
            var stdout = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var stderr = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
            child.WaitForExit();
            Task.WaitAll(stdout, stderr);
            return child.ExitCode;
        }
    }
}
'@
    $code = [TongCommandHost]::Run([string]$request.executable, [string[]]$request.arguments, [string]$request.cwd)
    [Environment]::Exit($code)
} catch {
    [Console]::Error.WriteLine('Tong command host failed: ' + $_.Exception.Message)
    [Environment]::Exit(126)
}
