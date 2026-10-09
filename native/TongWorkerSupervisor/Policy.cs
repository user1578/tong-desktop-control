using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Web.Script.Serialization;

namespace TongWorkerSupervisor {
internal sealed class Policy {
    public string pipeName { get; set; }
    public string gatewaySid { get; set; }
    public string gatewayAccountSid { get; set; }
    public string workerSid { get; set; }
    public string supervisorServiceSid { get; set; }
    public string supervisorImagePath { get; set; }
    public string supervisorImageSha256 { get; set; }
    public string bridgeImagePath { get; set; }
    public string bridgeImageSha256 { get; set; }
    public string workerExecutablePath { get; set; }
    public string workerExecutableSha256 { get; set; }
    public string workerScriptPath { get; set; }
    public string workerScriptSha256 { get; set; }
    public string codexExecutablePath { get; set; }
    public string codexExecutableSha256 { get; set; }
    public string codexVersion { get; set; }
    public string profileRoot { get; set; }
    public string tempRoot { get; set; }
    public string stateRoot { get; set; }
    public Dictionary<string,string> projectRoots { get; set; }
    public Dictionary<string,string> workerModuleSha256 { get; set; }
    public List<string> toolDirectories { get; set; }
    public bool syntheticOnly { get; set; }
    public string syntheticRoot { get; set; }

    internal static Policy Load(string path, bool synthetic) {
        if (!Path.IsPathRooted(path) || HasReparseAncestor(path))
            throw new InvalidOperationException("Policy must be an existing fixed file");
        var policy = new JavaScriptSerializer().Deserialize<Policy>(File.ReadAllText(path));
        if (policy == null || policy.syntheticOnly != synthetic) throw new InvalidOperationException("Policy mode mismatch");
        if (String.IsNullOrEmpty(policy.pipeName) || policy.pipeName.Length > 120
            || policy.pipeName.IndexOfAny(new[] {'/', '\\', ':', '\0'}) >= 0)
            throw new InvalidOperationException("Pipe name invalid");
        new SecurityIdentifier(policy.gatewaySid); new SecurityIdentifier(policy.workerSid);
        if (!synthetic) {
            new SecurityIdentifier(policy.gatewayAccountSid);
            if (policy.gatewayAccountSid.Equals(policy.workerSid,StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Gateway and Worker primary accounts must differ");
        }
        if (policy.gatewaySid.Equals(policy.workerSid, StringComparison.OrdinalIgnoreCase) && !synthetic)
            throw new InvalidOperationException("Worker and Gateway may not share an identity");
        if (!synthetic && !policy.gatewaySid.StartsWith("S-1-5-80-", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Gateway must use a dedicated service SID");
        if (!synthetic && (String.IsNullOrEmpty(policy.supervisorServiceSid)
            || !policy.supervisorServiceSid.StartsWith("S-1-5-80-",StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Supervisor service SID is required");
        if (!synthetic) new SecurityIdentifier(policy.supervisorServiceSid);
        if (!synthetic && (String.IsNullOrEmpty(policy.codexVersion) || policy.codexVersion.Length>80))
            throw new InvalidOperationException("Fixed Codex version is missing");
        if (policy.projectRoots == null || policy.projectRoots.Count == 0)
            throw new InvalidOperationException("Protected project allowlist is empty");
        foreach (var entry in policy.projectRoots) {
            if (String.IsNullOrEmpty(entry.Key) || !Path.IsPathRooted(entry.Value))
                throw new InvalidOperationException("Project allowlist invalid");
            string full=Path.GetFullPath(entry.Value);
            if (String.Equals(full.TrimEnd('\\'),Path.GetPathRoot(full).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Project allowlist cannot contain a volume root");
        }
        foreach (string fixedPath in new[] { policy.supervisorImagePath, policy.bridgeImagePath,
            policy.workerExecutablePath, policy.workerScriptPath, policy.codexExecutablePath }) {
            if (String.IsNullOrEmpty(fixedPath) || !Path.IsPathRooted(fixedPath)
                || HasReparseAncestor(fixedPath))
                throw new InvalidOperationException("Fixed executable path unavailable");
        }
        if (!synthetic) {
            string install=Path.GetDirectoryName(Path.GetFullPath(policy.supervisorImagePath));
            foreach (string item in new[] { policy.bridgeImagePath, policy.workerExecutablePath,
                policy.workerScriptPath, policy.codexExecutablePath })
                if (!String.Equals(Path.GetDirectoryName(Path.GetFullPath(item)),install,StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Fixed Worker binary escapes protected installation directory");
            CheckProtected(install);
            CheckProtected(path);
            foreach (string item in new[] { policy.supervisorImagePath,policy.bridgeImagePath,
                policy.workerExecutablePath,policy.workerScriptPath,policy.codexExecutablePath })
                CheckProtected(item);
        }
        if (!Path.IsPathRooted(policy.profileRoot) || !Path.IsPathRooted(policy.tempRoot)
            || !Path.IsPathRooted(policy.stateRoot)) throw new InvalidOperationException("Worker directory policy invalid");
        if (policy.toolDirectories==null || (!synthetic && policy.toolDirectories.Count<2))
            throw new InvalidOperationException("Fixed Worker tool directory allowlist is incomplete");
        foreach (string tool in policy.toolDirectories) {
            if (String.IsNullOrEmpty(tool) || !Path.IsPathRooted(tool) || !Directory.Exists(tool)
                || HasReparseAncestor(tool)) throw new InvalidOperationException("Fixed Worker tool directory unavailable");
            if (!synthetic) CheckProtected(tool);
        }
        if (synthetic) {
            if (String.IsNullOrEmpty(policy.syntheticRoot) || !Path.IsPathRooted(policy.syntheticRoot)
                || !Within(Path.GetTempPath(), policy.syntheticRoot))
                throw new InvalidOperationException("Synthetic mode requires a temporary root");
            foreach (string item in new[] { policy.supervisorImagePath, policy.bridgeImagePath,
                policy.workerExecutablePath, policy.workerScriptPath, policy.codexExecutablePath,
                policy.profileRoot, policy.tempRoot, policy.stateRoot })
                if (!Within(policy.syntheticRoot, item)) throw new InvalidOperationException("Synthetic path escapes temporary root");
            foreach (string item in policy.projectRoots.Values)
                if (!Within(policy.syntheticRoot, item)) throw new InvalidOperationException("Synthetic project escapes temporary root");
        }
        Pin(policy.supervisorImagePath, policy.supervisorImageSha256);
        Pin(policy.bridgeImagePath, policy.bridgeImageSha256);
        Pin(policy.workerExecutablePath, policy.workerExecutableSha256);
        Pin(policy.workerScriptPath, policy.workerScriptSha256);
        Pin(policy.codexExecutablePath, policy.codexExecutableSha256);
        string moduleRoot=Path.GetDirectoryName(policy.workerScriptPath);
        if (!synthetic && (policy.workerModuleSha256==null || policy.workerModuleSha256.Count!=4))
            throw new InvalidOperationException("Protected Worker module manifest incomplete");
        if (!synthetic) foreach (string name in new[] { "TongCodexWorker.mjs", "TongWorkerStdio.mjs",
            "TongWorkerProtocol.mjs", "TongCodexAppServer.mjs" })
            if (!policy.workerModuleSha256.ContainsKey(Path.Combine(moduleRoot,name)))
                throw new InvalidOperationException("Required Worker module hash missing");
        if (policy.workerModuleSha256!=null) foreach (var module in policy.workerModuleSha256) {
            if (!String.Equals(Path.GetDirectoryName(Path.GetFullPath(module.Key)),moduleRoot,StringComparison.OrdinalIgnoreCase)
                || HasReparseAncestor(module.Key))
                throw new InvalidOperationException("Worker module escapes fixed directory");
            Pin(module.Key,module.Value);
            if (!synthetic) CheckProtected(module.Key);
        }
        if (!String.Equals(Path.GetFullPath(policy.supervisorImagePath),
            Path.GetFullPath(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Supervisor image path mismatch");
        if (!synthetic && policy.codexExecutablePath.StartsWith(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Codex binary may not come from the current user profile");
        return policy;
    }
    static bool HasReparseAncestor(string path) {
        for (string part=Path.GetFullPath(path); part!=null; part=Path.GetDirectoryName(part)) {
            if ((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0) return true;
            string parent=Path.GetDirectoryName(part);
            if (parent==part) break;
        }
        return false;
    }
    internal static void CheckProtected(string path,string serviceWriter=null) {
        FileSystemSecurity security=Directory.Exists(path)
            ? (FileSystemSecurity)Directory.GetAccessControl(path,AccessControlSections.Owner|AccessControlSections.Access)
            : (FileSystemSecurity)File.GetAccessControl(path,AccessControlSections.Owner|AccessControlSections.Access);
        var owner=security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        if (owner==null || !(owner.Value=="S-1-5-18" || owner.Value=="S-1-5-32-544"))
            throw new InvalidOperationException("Protected file owner must be SYSTEM or Administrators");
        var trustedWriters=new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "S-1-5-18","S-1-5-32-544" };
        if (!String.IsNullOrEmpty(serviceWriter)) trustedWriters.Add(serviceWriter);
        var write=FileSystemRights.WriteData|FileSystemRights.AppendData|FileSystemRights.WriteAttributes
            |FileSystemRights.WriteExtendedAttributes|FileSystemRights.Delete|FileSystemRights.ChangePermissions
            |FileSystemRights.TakeOwnership|FileSystemRights.DeleteSubdirectoriesAndFiles;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
            if (rule.AccessControlType==AccessControlType.Allow
                && !trustedWriters.Contains(((SecurityIdentifier)rule.IdentityReference).Value)
                && (rule.FileSystemRights & write)!=0)
                throw new InvalidOperationException("Protected file ACL grants an untrusted principal write access");
        }
    }
    internal void CheckStateRoot() {
        CheckProtected(stateRoot,supervisorServiceSid);
        var security=Directory.GetAccessControl(stateRoot,AccessControlSections.Access);
        bool serviceWrite=false;
        bool ownerCannotRewrite=false;
        var allowed=new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "S-1-5-18","S-1-5-32-544",supervisorServiceSid
        };
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
            string sid=((SecurityIdentifier)rule.IdentityReference).Value;
            if (sid=="S-1-3-4" && rule.AccessControlType==AccessControlType.Deny
                && (rule.FileSystemRights&FileSystemRights.ChangePermissions)==FileSystemRights.ChangePermissions
                && (rule.InheritanceFlags&(InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit))
                    ==(InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit)) ownerCannotRewrite=true;
            if (rule.AccessControlType!=AccessControlType.Allow) continue;
            if (!allowed.Contains(sid)) throw new InvalidOperationException("Untrusted principal can access Supervisor state directory");
            if (sid.Equals(supervisorServiceSid,StringComparison.OrdinalIgnoreCase)
                && (rule.FileSystemRights&FileSystemRights.Modify)==FileSystemRights.Modify) serviceWrite=true;
        }
        if (!serviceWrite) throw new InvalidOperationException("Supervisor service SID cannot write protected state");
        if (!ownerCannotRewrite) throw new InvalidOperationException("Protected state lacks inherited OWNER RIGHTS DACL protection");
    }
    internal void CheckCodexVersion() {
        var info=new ProcessStartInfo(codexExecutablePath,"--version") {
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,
            WorkingDirectory=Path.GetDirectoryName(codexExecutablePath)
        };
        info.EnvironmentVariables.Clear();
        info.EnvironmentVariables["SystemRoot"]=Environment.GetEnvironmentVariable("SystemRoot");
        using (var process=Process.Start(info)) {
            if (process==null || !process.WaitForExit(5000)) {
                if (process!=null) process.Kill();
                throw new InvalidOperationException("Fixed Codex version probe timed out");
            }
            string actual=process.StandardOutput.ReadToEnd().Trim();
            if (process.ExitCode!=0 || !actual.Equals(codexVersion,StringComparison.Ordinal))
                throw new InvalidOperationException("Fixed Codex version mismatch");
        }
    }
    internal void PinWorkerFiles() {
        Pin(workerExecutablePath,workerExecutableSha256);
        Pin(workerScriptPath,workerScriptSha256);
        Pin(codexExecutablePath,codexExecutableSha256);
        if (workerModuleSha256!=null) foreach (var module in workerModuleSha256) Pin(module.Key,module.Value);
    }
    internal static bool Within(string root, string path) {
        string prefix = Path.GetFullPath(root).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        return Path.GetFullPath(path).StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }
    internal static void Pin(string path, string expected) {
        if (String.IsNullOrEmpty(expected) || expected.Length != 64)
            throw new InvalidOperationException("Executable SHA-256 pin is missing");
        byte[] digest;
        using (var hash = SHA256.Create()) using (var file = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.Read)) digest = hash.ComputeHash(file);
        string actual = BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Fixed executable SHA-256 pin mismatch");
    }
    internal string RootFor(string id, string supplied) {
        string registered;
        if (!projectRoots.TryGetValue(id, out registered)
            || !String.Equals(Path.GetFullPath(registered).TrimEnd('\\'),
                Path.GetFullPath(supplied).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Project does not match protected allowlist");
        return registered;
    }
}
}
