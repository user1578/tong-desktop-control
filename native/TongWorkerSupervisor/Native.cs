using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace TongWorkerSupervisor {
internal static class Native {
    internal const string TRUSTED_INSTALLER_SID = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    internal const string RESTRICTED_CODE_SID = "S-1-5-12";
    internal const string WINSOCK_CATALOG_READ_SID = "S-1-15-3-1024-1065365936-1281604716-3511738428-1654721687-432734479-3232135806-4053264122-3456934681";
    internal const string EVERYONE_SID = "S-1-1-0", USERS_SID = "S-1-5-32-545", AUTHENTICATED_USERS_SID = "S-1-5-11";
    internal const uint PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
    internal const uint PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY = 0x0002000f;
    internal const uint PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT = 0x1;
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
    [StructLayout(LayoutKind.Sequential)] internal struct LUID { internal uint LowPart; internal int HighPart; }
    [StructLayout(LayoutKind.Sequential)] internal struct LUID_AND_ATTRIBUTES { internal LUID Luid; internal uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct SECURITY_CAPABILITIES {
        internal IntPtr AppContainerSid, Capabilities; internal uint CapabilityCount, Reserved;
    }
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
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
    [DllImport("advapi32.dll", SetLastError=true)] internal static extern bool CreateRestrictedToken(IntPtr existing,
        uint flags, uint disabledCount, IntPtr disabled, uint privilegeCount, IntPtr privileges,
        uint restrictedCount, IntPtr restricted, out IntPtr token);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern bool ConvertStringSidToSid(string value, out IntPtr sid);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
    static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
    static extern int CreateAppContainerProfile(string name,string displayName,string description,
        IntPtr capabilities,uint capabilityCount,out IntPtr sid);
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
        if (!ok) {
            int error=Marshal.GetLastWin32Error();
            throw new Win32Exception(error, operation + " (Win32 " + error + ")");
        }
    }
    internal static string ImagePath(uint pid) {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        Require(handle != IntPtr.Zero, "OpenProcess(peer)");
        try { return ImagePath(handle); } finally { CloseHandle(handle); }
    }
    internal static string ImagePath(IntPtr process) {
        var path = new StringBuilder(32768); uint size = (uint)path.Capacity;
        Require(QueryFullProcessImageName(process, 0, path, ref size), "QueryFullProcessImageName(peer)");
        return path.ToString();
    }
    internal static string DeriveAppContainerSid(string name) {
        IntPtr sid;
        int hr=DeriveAppContainerSidFromAppContainerName(name,out sid);
        if (hr<0) Marshal.ThrowExceptionForHR(hr);
        try { return new SecurityIdentifier(sid).Value; }
        finally { LocalFree(sid); }
    }
    internal static void EnsureAppContainerProfile(string name,string[] capabilitySids) {
        IntPtr sid=IntPtr.Zero, capabilities=IntPtr.Zero;
        var allocated=new System.Collections.Generic.List<IntPtr>();
        try {
            int stride=Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            capabilities=Marshal.AllocHGlobal(stride*capabilitySids.Length);
            for (int i=0;i<capabilitySids.Length;i++) {
                IntPtr capability;
                Require(ConvertStringSidToSid(capabilitySids[i],out capability),"ConvertStringSidToSid(AppContainer capability)");
                allocated.Add(capability);
                Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid=capability, Attributes=0x4 },
                    IntPtr.Add(capabilities,i*stride),false);
            }
            int hr=CreateAppContainerProfile(name,name,"Tong Desktop Control Worker sandbox",capabilities,
                (uint)capabilitySids.Length,out sid);
            if (hr>=0 || unchecked((uint)hr)==0x800700b7) return;
            Marshal.ThrowExceptionForHR(hr);
        } finally {
            if (sid!=IntPtr.Zero) LocalFree(sid);
            if (capabilities!=IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
            foreach (IntPtr capability in allocated) LocalFree(capability);
        }
    }
    internal static void DeleteAppContainerProfile(string name) {
        int hr=DeleteAppContainerProfileNative(name);
        if (hr>=0 || unchecked((uint)hr)==0x80070002) return;
        Marshal.ThrowExceptionForHR(hr);
    }
    [DllImport("userenv.dll", CharSet=CharSet.Unicode, PreserveSig=true, EntryPoint="DeleteAppContainerProfile")]
    static extern int DeleteAppContainerProfileNative(string name);
    internal static string AppContainerName(string taskId, bool synthetic=false) {
        Guid id;
        if (!Guid.TryParseExact(taskId,"D",out id)) throw new InvalidOperationException("Task ID invalid");
        return synthetic ? "TongDesktopControlNativeSynthetic" : "TongDesktopControlWorker";
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
    internal static bool TokenIsAppContainer(IntPtr token) {
        uint required;
        GetTokenInformation(token,29,IntPtr.Zero,0,out required);
        if (required!=4) throw new InvalidOperationException("Token app-container flag length invalid");
        IntPtr buffer=Marshal.AllocHGlobal(4);
        try {
            Require(GetTokenInformation(token,29,buffer,required,out required),"GetTokenInformation(app-container flag)");
            return Marshal.ReadInt32(buffer)!=0;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    internal static bool TokenHasAppContainerSid(IntPtr token,string expectedSid) {
        if (!TokenIsAppContainer(token)) return false;
        uint required;
        GetTokenInformation(token,31,IntPtr.Zero,0,out required);
        if (required<IntPtr.Size || required>65536)
            throw new InvalidOperationException("Token app-container SID length invalid: " + required);
        IntPtr buffer=Marshal.AllocHGlobal((int)required);
        try {
            Require(GetTokenInformation(token,31,buffer,required,out required),"GetTokenInformation(app-container SID)");
            IntPtr sid=Marshal.ReadIntPtr(buffer);
            return sid!=IntPtr.Zero && new SecurityIdentifier(sid).Value.Equals(expectedSid,StringComparison.OrdinalIgnoreCase);
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    internal static LUID_AND_ATTRIBUTES[] TokenPrivileges(IntPtr token) {
        uint required;
        GetTokenInformation(token,3,IntPtr.Zero,0,out required);
        if (required<4 || required>65536) throw new InvalidOperationException("Token privilege length invalid");
        IntPtr buffer=Marshal.AllocHGlobal((int)required);
        try {
            Require(GetTokenInformation(token,3,buffer,required,out required),"GetTokenInformation(privileges)");
            int count=Marshal.ReadInt32(buffer), stride=Marshal.SizeOf(typeof(LUID_AND_ATTRIBUTES));
            if (count<0 || count>1024 || 4L+(long)count*stride>required)
                throw new InvalidOperationException("Token privilege count invalid");
            var result=new LUID_AND_ATTRIBUTES[count];
            for (int i=0;i<count;i++) result[i]=(LUID_AND_ATTRIBUTES)Marshal.PtrToStructure(
                IntPtr.Add(buffer,4+i*stride),typeof(LUID_AND_ATTRIBUTES));
            return result;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    internal static bool HasOnlyChangeNotifyPrivilege(IntPtr token) {
        LUID expected;
        Require(LookupPrivilegeValue(null,"SeChangeNotifyPrivilege",out expected),"LookupPrivilegeValue(change notify)");
        var privileges=TokenPrivileges(token);
        bool changeNotify=false;
        foreach (var privilege in privileges) {
            bool isChangeNotify=privilege.Luid.LowPart==expected.LowPart && privilege.Luid.HighPart==expected.HighPart;
            if (isChangeNotify) {
                if ((privilege.Attributes&0x2)==0 || (privilege.Attributes&0x4)!=0) return false;
                changeNotify=true;
            } else if ((privilege.Attributes&0x4)==0) return false;
        }
        return changeNotify;
    }
    internal static string DescribePrivileges(IntPtr token) {
        LUID expected; LookupPrivilegeValue(null,"SeChangeNotifyPrivilege",out expected);
        var values=new StringBuilder();
        foreach (var privilege in TokenPrivileges(token)) values.Append("["
            + privilege.Luid.LowPart.ToString("x8") + "," + privilege.Luid.HighPart.ToString("x8")
            + "," + privilege.Attributes.ToString("x8") + "]");
        return "change=" + expected.LowPart.ToString("x8") + "," + expected.HighPart.ToString("x8") + ",values=" + values;
    }
    internal static bool VerifyToken(IntPtr token, string expectedUser, string taskSid, bool requireJob,
        string serviceSid=null, IntPtr processForJob=default(IntPtr), string appContainerSid=null) {
        if (!HasOnlyChangeNotifyPrivilege(token)) return false;
        var identity = new WindowsIdentity(token);
        if (!identity.User.Value.Equals(expectedUser, StringComparison.OrdinalIgnoreCase)) return false;
        // File access is constrained by the AppContainer package/capability
        // access check. Do not add broad user groups to CreateRestrictedToken's
        // restricting SID list: that second check can make inherited Windows
        // runtime ACLs grant external paths to every task using the same group.
        if (TokenHasSid(token,11,expectedUser,0,0) || TokenHasSid(token,11,taskSid,0,0)) return false;
        if (!String.IsNullOrEmpty(serviceSid) && !TokenHasSid(token, 2, serviceSid, 0x10, 0x10)) return false;
        if (!String.IsNullOrEmpty(appContainerSid)
            && (!TokenHasAppContainerSid(token,appContainerSid)
                || !TokenHasSid(token,30,WINSOCK_CATALOG_READ_SID,0x4,0x4))) return false;
        if (requireJob) {
            bool inJob; Require(IsProcessInJob(processForJob==IntPtr.Zero ? GetCurrentProcess() : processForJob,
                IntPtr.Zero, out inJob), "IsProcessInJob");
            if (!inJob) return false;
        }
        return true;
    }
}
}
