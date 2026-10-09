using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

namespace TongWorkerSupervisor {
internal sealed class AclRecord {
    public string taskId { get; set; }
    public string path { get; set; }
    public string identity { get; set; }
    public string appContainerSid { get; set; }
    public string original { get; set; }
    public string applied { get; set; }
}

// Journal is stored in the protected service state directory. Every write is done
// before changing the DACL, so recovery can distinguish unchanged, applied and
// conflicting ACLs without overwriting somebody else's later change.
internal sealed class AclJournal : IDisposable {
    readonly string stateRoot;
    readonly FileStream processLock;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    internal AclJournal(string root) {
        stateRoot = Path.GetFullPath(root);
        if (!Directory.Exists(stateRoot) || (File.GetAttributes(stateRoot) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Protected ACL journal directory is unavailable");
        processLock = new FileStream(Path.Combine(stateRoot, "acl.lock"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None);
    }
    static void ValidatePath(string path) {
        if (!Path.IsPathRooted(path) || !Directory.Exists(path)) throw new InvalidOperationException("Project directory unavailable");
        for (string part = Path.GetFullPath(path); part != null; part = Path.GetDirectoryName(part)) {
            if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Project path traverses a reparse point");
            string parent = Path.GetDirectoryName(part);
            if (parent == part) break;
        }
    }
    internal static bool CheckGrant(string path, string workerSid, string taskSid, string appContainerSid) {
        ValidatePath(path);
        var security = Directory.GetAccessControl(path, AccessControlSections.Access);
        bool worker=false, task=false, appContainer=false;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier))) {
            if (rule.AccessControlType != AccessControlType.Allow
                || (rule.FileSystemRights & FileSystemRights.Modify) != FileSystemRights.Modify
                || (rule.InheritanceFlags & (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit))
                    != (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit)) continue;
            string sid=((SecurityIdentifier)rule.IdentityReference).Value;
            if (sid.Equals(workerSid,StringComparison.OrdinalIgnoreCase)) worker=true;
            if (sid.Equals(taskSid,StringComparison.OrdinalIgnoreCase)) task=true;
            if (sid.Equals(appContainerSid,StringComparison.OrdinalIgnoreCase)) appContainer=true;
        }
        return worker && task && appContainer;
    }
    string RecordPath(string taskId) {
        Guid id;
        if (!Guid.TryParseExact(taskId, "D", out id)) throw new InvalidOperationException("Task ID invalid");
        return Path.Combine(stateRoot, id.ToString("D") + ".acl.json");
    }
    static string CurrentDacl(string path) {
        return Directory.GetAccessControl(path, AccessControlSections.Access)
            .GetSecurityDescriptorSddlForm(AccessControlSections.Access);
    }
    static void SetDacl(string path, string sddl) {
        var security = new DirectorySecurity();
        security.SetSecurityDescriptorSddlForm(sddl, AccessControlSections.Access);
        Directory.SetAccessControl(path, security);
    }
    void Save(string file, AclRecord record) {
        string temp = file + ".pending";
        if (File.Exists(temp)) throw new InvalidOperationException("Incomplete ACL journal transaction");
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(record));
        using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush(true);
        }
        Native.Require(Native.MoveFileEx(temp, file, 0x8), "MoveFileEx(ACL journal write-through)");
    }
    AclRecord Read(string file) {
        var record = json.Deserialize<AclRecord>(File.ReadAllText(file, Encoding.UTF8));
        if (record == null || String.IsNullOrEmpty(record.path) || String.IsNullOrEmpty(record.identity)
            || String.IsNullOrEmpty(record.original) || String.IsNullOrEmpty(record.applied)
            || String.IsNullOrEmpty(record.appContainerSid)
            || !String.Equals(file, RecordPath(record.taskId), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("ACL journal record invalid");
        return record;
    }
    internal void Grant(string taskId, string path, string workerSid, string taskSid, string appContainerSid) {
        ValidatePath(path);
        path = Path.GetFullPath(path);
        string file = RecordPath(taskId);
        if (File.Exists(file)) throw new InvalidOperationException("Task ACL already active");
        string original = CurrentDacl(path);
        var security = Directory.GetAccessControl(path, AccessControlSections.Access);
        foreach (string sid in new[] { workerSid, taskSid, appContainerSid }) {
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),
                FileSystemRights.Modify | FileSystemRights.Synchronize,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
        }
        string applied = security.GetSecurityDescriptorSddlForm(AccessControlSections.Access);
        var record = new AclRecord { taskId=taskId, path=path, identity=Native.FileIdentity(path),
            appContainerSid=appContainerSid,
            original=original, applied=applied };
        Save(file, record);
        try {
            if (CurrentDacl(path) != original || Native.FileIdentity(path) != record.identity)
                throw new InvalidOperationException("Project ACL changed during grant");
            Directory.SetAccessControl(path, security);
            if (CurrentDacl(path) != applied) throw new InvalidOperationException("Applied project ACL differs from journal");
        } catch {
            // Restore only if the exact journaled DACL is still present. A conflict
            // deliberately leaves the journal in place for a human to reconcile.
            Restore(taskId);
            throw;
        }
    }
    internal void Restore(string taskId) {
        string file = RecordPath(taskId);
        if (!File.Exists(file)) return;
        var record = Read(file);
        ValidatePath(record.path);
        if (Native.FileIdentity(record.path) != record.identity)
            throw new InvalidOperationException("Project directory identity changed; ACL restore refused");
        string current = CurrentDacl(record.path);
        if (current == record.applied) SetDacl(record.path, record.original);
        else if (current != record.original) throw new InvalidOperationException("Project ACL conflict; restore refused");
        if (CurrentDacl(record.path) != record.original)
            throw new InvalidOperationException("Project ACL restoration did not match backup");
        File.Delete(file);
    }
    internal void Recover() {
        if (Directory.GetFiles(stateRoot, "*.pending").Length != 0)
            throw new InvalidOperationException("Incomplete ACL journal file; manual review required");
        foreach (string file in Directory.GetFiles(stateRoot, "*.acl.json")) {
            var record = Read(file);
            Restore(record.taskId);
        }
    }
    public void Dispose() { processLock.Dispose(); }
}
}
