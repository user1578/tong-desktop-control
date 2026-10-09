using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace TongWorkerSupervisor {
internal static class Native {
    internal const uint TOKEN_ASSIGN_PRIMARY = 0x0001, TOKEN_DUPLICATE = 0x0002, TOKEN_QUERY = 0x0008;
    internal const uint TOKEN_ADJUST_DEFAULT = 0x0080, TOKEN_ADJUST_SESSIONID = 0x0100;
    internal const uint DISABLE_MAX_PRIVILEGE = 1, CREATE_SUSPENDED = 4, CREATE_UNICODE_ENVIRONMENT = 0x400;
    internal const uint CREATE_NO_WINDOW = 0x08000000, STARTF_USESTDHANDLES = 0x100;
    internal const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    internal const uint HANDLE_FLAG_INHERIT = 1;
    internal const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

    [StructLayout(LayoutKind.Sequential)] internal struct SID_AND_ATTRIBUTES { internal IntPtr Sid; internal uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct SECURITY_ATTRIBUTES {
        internal uint nLength; internal IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] internal bool bInheritHandle;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFO {
        internal uint cb; internal IntPtr lpReserved; internal IntPtr lpDesktop; internal IntPtr lpTitle;
        internal uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
        internal uint dwFlags; internal ushort wShowWindow, cbReserved2;
        internal IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct PROCESS_INFORMATION {
        internal IntPtr hProcess, hThread; internal uint dwProcessId, dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFOEX {
        internal STARTUPINFO StartupInfo;
        internal IntPtr lpAttributeList;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        internal long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        internal uint ActiveProcessLimit; internal UIntPtr Affinity;
        internal uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct IO_COUNTERS {
        internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        internal ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        internal IO_COUNTERS IoInfo;
        internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct BY_HANDLE_FILE_INFORMATION {
        internal uint FileAttributes, CreationTimeLow, CreationTimeHigh, LastAccessTimeLow, LastAccessTimeHigh;
        internal uint LastWriteTimeLow, LastWriteTimeHigh, VolumeSerialNumber, FileSizeHigh, FileSizeLow;
        internal uint NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
        internal long TotalUserTime, TotalKernelTime;
        internal ulong ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        internal uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetFileInformationByHandle(IntPtr file, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")]
    internal static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="MoveFileExW")]
    internal static extern bool MoveFileEx(string existing, string destination, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES attributes, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateJobObjectW")]
    internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool QueryInformationJobObject(IntPtr job, int infoClass,
        out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true, EntryPoint="QueryInformationJobObject")]
    internal static extern bool QueryJobLimits(IntPtr job, int infoClass,
        out JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint WaitForSingleObject(IntPtr process, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool GetTokenInformation(IntPtr token, int infoClass,
        IntPtr info, uint length, out uint required);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool CreateRestrictedToken(IntPtr existing,
        uint flags, uint disabledCount, IntPtr disabled, uint privilegeCount, IntPtr privileges,
        uint restrictedCount, IntPtr restricted, out IntPtr token);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern bool ConvertStringSidToSid(string value, out IntPtr sid);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessAsUserW")]
    internal static extern bool CreateProcessAsUser(IntPtr token, string application,
        StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit,
        uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION info);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessAsUserW")]
    internal static extern bool CreateProcessAsUserEx(IntPtr token, string application,
        StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit,
        uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool InitializeProcThreadAttributeList(
        IntPtr list, int attributeCount, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool UpdateProcThreadAttribute(
        IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);

    internal static void Require(bool ok, string operation) {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    internal static string ImagePath(uint pid) {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        Require(handle != IntPtr.Zero, "OpenProcess(peer)");
        try {
            var path = new StringBuilder(32768); uint size = (uint)path.Capacity;
            Require(QueryFullProcessImageName(handle, 0, path, ref size), "QueryFullProcessImageName(peer)");
            return path.ToString();
        } finally { CloseHandle(handle); }
    }
    internal static string FileIdentity(string path) {
        IntPtr handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero);
        Require(handle != new IntPtr(-1), "CreateFile(identity)");
        try {
            BY_HANDLE_FILE_INFORMATION info;
            Require(GetFileInformationByHandle(handle, out info), "GetFileInformationByHandle");
            return info.VolumeSerialNumber.ToString("x8") + ":" + info.FileIndexHigh.ToString("x8") + info.FileIndexLow.ToString("x8");
        } finally { CloseHandle(handle); }
    }
    internal static bool TokenHasSid(IntPtr token, int infoClass, string expected, uint requiredMask, uint requiredValue) {
        uint required; GetTokenInformation(token, infoClass, IntPtr.Zero, 0, out required);
        if (required == 0 || required > 65536) throw new InvalidOperationException("Token group length invalid");
        IntPtr buffer = Marshal.AllocHGlobal((int)required);
        try {
            Require(GetTokenInformation(token, infoClass, buffer, required, out required), "GetTokenInformation");
            int count = Marshal.ReadInt32(buffer); int stride = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            if (count < 0 || count > 1024) throw new InvalidOperationException("Token group count invalid");
            int offset = IntPtr.Size == 8 ? 8 : 4;
            for (int i=0; i<count; i++) {
                var entry = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(IntPtr.Add(buffer, offset + i*stride), typeof(SID_AND_ATTRIBUTES));
                var sid = new SecurityIdentifier(entry.Sid);
                if (sid.Value.Equals(expected, StringComparison.OrdinalIgnoreCase)
                    && (entry.Attributes & requiredMask) == requiredValue) return true;
            }
            return false;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    internal static bool VerifyToken(IntPtr token, string expectedUser, string taskSid, bool requireJob, string serviceSid=null) {
        if (!IsTokenRestricted(token)) return false;
        var identity = new WindowsIdentity(token);
        if (!identity.User.Value.Equals(expectedUser, StringComparison.OrdinalIgnoreCase)) return false;
        // Authenticated Users must be deny-only in the normal access check.
        if (!TokenHasSid(token, 2, "S-1-5-11", 0x10, 0x10)) return false;
        if (!String.IsNullOrEmpty(serviceSid) && !TokenHasSid(token, 2, serviceSid, 0x10, 0x10)) return false;
        if (!TokenHasSid(token, 11, taskSid, 0, 0)) return false;
        if (requireJob) {
            bool inJob; Require(IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inJob), "IsProcessInJob");
            if (!inJob) return false;
        }
        return true;
    }
}
}
