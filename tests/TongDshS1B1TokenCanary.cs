using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ComponentModel;

namespace TongDshS1B1TokenCanary {
internal static class Canary {
    const uint TOKEN_QUERY=0x0008,TOKEN_DUPLICATE=0x0002,DISABLE_MAX_PRIVILEGE=1;
    const string RESTRICTING_GROUP="S-1-5-32-545"; // Builtin Users: synthetic ACL experiment ONLY.
    [StructLayout(LayoutKind.Sequential)]
    struct SID_AND_ATTRIBUTES {internal IntPtr sid; internal uint attributes;}
    [StructLayout(LayoutKind.Sequential)]
    struct GENERIC_MAPPING {internal uint read,write,execute,all;}
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool CreateRestrictedToken(IntPtr existing,uint flags,
        uint disabledCount,IntPtr disabled,uint deleteCount,IntPtr deleted,
        uint restrictingCount,IntPtr restricting,out IntPtr result);
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool DuplicateToken(IntPtr existing,int impersonationLevel,out IntPtr token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool ConvertStringSidToSid(string value,out IntPtr result);
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]
    static extern bool AccessCheck(byte[] security,IntPtr token,uint desired,
        ref GENERIC_MAPPING mapping,IntPtr privilegeSet,ref uint privilegeLength,
        out uint granted,[MarshalAs(UnmanagedType.Bool)]out bool access);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Need(bool ok,string operation) {
        if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),operation);
    }
    static FileSecurity Secure(string file,bool grantUsers){
        var acl=new FileSecurity();
        acl.SetAccessRuleProtection(true,false);
        var owner=WindowsIdentity.GetCurrent().User;
        // Keep the newly created file's existing owner; changing ownership
        // would require a privilege that this user session should not gain.
        foreach(var sid in new []{owner,new SecurityIdentifier("S-1-5-18"),
                new SecurityIdentifier("S-1-5-32-544")}){
            acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,
                AccessControlType.Allow));
        }
        if(grantUsers)acl.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(RESTRICTING_GROUP),FileSystemRights.ReadData,AccessControlType.Allow));
        File.SetAccessControl(file,acl);
        // Reading SACL (`All`) requires SeSecurityPrivilege on Windows.
        // For AccessCheck only the DACL/owner section is required.
        return File.GetAccessControl(file,AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group);
    }
    static bool CanRead(FileSecurity security,IntPtr token){
        byte[] descriptor=security.GetSecurityDescriptorBinaryForm();
        // AccessCheck uses a real Windows impersonation token and dual DACL
        // evaluation; this does not start an agent or open target data.
        var map=new GENERIC_MAPPING {read=0x00020089,write=0x00020116,
            execute=0x000200a0,all=0x001f01ff};
        uint privilegeLength=8192,granted;
        IntPtr buffer=Marshal.AllocHGlobal((int)privilegeLength);
        try {
            bool allowed;
            Need(AccessCheck(descriptor,token,0x0001,ref map,buffer,ref privilegeLength,
                out granted,out allowed),"AccessCheck");
            return allowed&&(granted&0x0001)!=0;
        } finally {Marshal.FreeHGlobal(buffer);}
    }
    static int Run() {
        string temporary=Path.GetFullPath(Path.GetTempPath()).TrimEnd('\\')+"\\";
        string root=Path.GetFullPath(Path.Combine(temporary,"TongDshS1B1-"+Guid.NewGuid().ToString("N")));
        if(!root.StartsWith(temporary,StringComparison.OrdinalIgnoreCase)||Directory.Exists(root))
            throw new InvalidOperationException("Unsafe test path");
        Directory.CreateDirectory(root);
        IntPtr processToken=IntPtr.Zero,restrictedToken=IntPtr.Zero,
            originalImpersonation=IntPtr.Zero,restrictedImpersonation=IntPtr.Zero,
            restrictedGroup=IntPtr.Zero,array=IntPtr.Zero;
        try {
            string open=Path.Combine(root,"allowed.txt");
            string closed=Path.Combine(root,"private.txt");
            File.WriteAllText(open,"synthetic");
            File.WriteAllText(closed,"synthetic");
            FileSecurity openAcl=Secure(open,true);
            FileSecurity closedAcl=Secure(closed,false);
            Need(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE,out processToken),
                "OpenProcessToken");
            Need(DuplicateToken(processToken,2,out originalImpersonation),"DuplicateToken(original)");
            Need(ConvertStringSidToSid(RESTRICTING_GROUP,out restrictedGroup),"ConvertStringSidToSid");
            array=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)));
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES{sid=restrictedGroup,attributes=0},array,false);
            Need(CreateRestrictedToken(processToken,DISABLE_MAX_PRIVILEGE,0,IntPtr.Zero,0,IntPtr.Zero,
                1,array,out restrictedToken),"CreateRestrictedToken");
            if(!IsTokenRestricted(restrictedToken))
                throw new InvalidOperationException("Token not restricted");
            Need(DuplicateToken(restrictedToken,2,out restrictedImpersonation),
                "DuplicateToken(restricted)");
            bool originalPrivate=CanRead(closedAcl,originalImpersonation);
            bool restrictedAllowed=CanRead(openAcl,restrictedImpersonation);
            bool restrictedDenied=!CanRead(closedAcl,restrictedImpersonation);
            if(!originalPrivate||!restrictedAllowed||!restrictedDenied)
                throw new InvalidOperationException("Dual DACL AccessCheck failed");
            // Prove a Users-only restricting SID is NOT isolation: as soon as
            // the private file grants Users read, the restricted token can read.
            FileSecurity openPrivateAcl=Secure(closed,true);
            bool publicAceRestoresAccess=CanRead(openPrivateAcl,restrictedImpersonation);
            if(!publicAceRestoresAccess)
                throw new InvalidOperationException("Expected public ACE access not observed");
            Console.WriteLine("{\"status\":\"passed\",\"realRestrictedToken\":true,"+
                "\"originalTokenCanReadPrivate\":true,\"restrictedCanReadAllowed\":true,"+
                "\"restrictedDeniedPrivate\":true,\"publicAceRestoresAccess\":true,"+
                "\"restrictedChildStarted\":false,"+
                "\"productionPermissionSandboxVerified\":false,"+
                "\"networkIsolationProved\":false,\"dshStarted\":false,\"modelCalled\":false}");
            return 0;
        } finally {
            if(restrictedImpersonation!=IntPtr.Zero)CloseHandle(restrictedImpersonation);
            if(originalImpersonation!=IntPtr.Zero)CloseHandle(originalImpersonation);
            if(restrictedToken!=IntPtr.Zero)CloseHandle(restrictedToken);
            if(processToken!=IntPtr.Zero)CloseHandle(processToken);
            if(restrictedGroup!=IntPtr.Zero)LocalFree(restrictedGroup);
            if(array!=IntPtr.Zero)Marshal.FreeHGlobal(array);
            // Only self-created random temporary files are removed.
            try{Directory.Delete(root,true);}catch{Console.Error.WriteLine("Synthetic temp requires cleanup");}
        }
    }
    static int Main(string[] args) {
        if(args.Length!=1||args[0]!="--test"){
            Console.Error.WriteLine("Only fixed no-DSH AccessCheck synthetic test is supported");
            return 2;
        }
        try{return Run();}
        catch(Exception ex){
            Console.Error.WriteLine("DSH-S1B1 AccessCheck canary stopped: "+ex.GetType().Name+
                (ex is Win32Exception?" Win32 "+((Win32Exception)ex).NativeErrorCode:""));
            return 1;
        }
    }
}
}
