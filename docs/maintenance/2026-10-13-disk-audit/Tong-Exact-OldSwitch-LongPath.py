# -*- coding: utf-8 -*-
"""Exact Tong old-PoC switch cleanup helper. Windows Python 3.11+ only.

Modes:
  verify: walk every entry with long-path support; refuse reparse points/errors.
  delete: repeat that same full validation, then remove ONLY the hard-coded tree.

Invoked only after the PowerShell wrapper checks production configuration,
service ports, live process references, preserved mirror, and local Git stage.
No file outside ALLOWED_TREE is a deletion target.
"""
import os
import shutil
import stat
import sys

ALLOWED_TREE = r"D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9"
PRESERVED_MIRROR = r"D:\Tong\state\b23-switch-c104fcca2aa9"
REPARSE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def extended(path):
    absolute = os.path.abspath(path)
    if os.name != "nt" or not os.path.isabs(absolute):
        raise RuntimeError("Only Windows absolute paths are supported")
    return "\\\\?\\" + absolute


def validate_tree():
    if os.name != "nt":
        raise RuntimeError("This helper may only run on Windows")
    target = extended(ALLOWED_TREE)
    mirror = extended(PRESERVED_MIRROR)
    expected = "\\\\?\\" + ALLOWED_TREE
    if os.path.normcase(os.path.normpath(target)) != os.path.normcase(os.path.normpath(expected)):
        raise RuntimeError("Exact approved target mismatch")
    if not os.path.isdir(mirror):
        raise RuntimeError("Required preserved mirror is missing")
    # Never operate through a junction/reparse parent.
    ancestor = os.path.splitdrive(ALLOWED_TREE)[0] + "\\"
    parts = ALLOWED_TREE[len(ancestor):].split("\\")
    for part in parts:
        ancestor = os.path.join(ancestor, part)
        info = os.stat(extended(ancestor), follow_symlinks=False)
        if not stat.S_ISDIR(info.st_mode):
            raise RuntimeError("Ancestor is not a normal directory: " + ancestor)
        if getattr(info, "st_file_attributes", 0) & REPARSE:
            raise RuntimeError("Reparse ancestor is forbidden: " + ancestor)

    count_files = count_dirs = 0
    stack = [target]
    while stack:
        folder = stack.pop()
        with os.scandir(folder) as iterator:
            for entry in iterator:
                info = entry.stat(follow_symlinks=False)
                if getattr(info, "st_file_attributes", 0) & REPARSE:
                    raise RuntimeError("Refusing junction/symlink/reparse entry: " + entry.path)
                if stat.S_ISDIR(info.st_mode):
                    count_dirs += 1
                    stack.append(entry.path)
                elif stat.S_ISREG(info.st_mode):
                    count_files += 1
                else:
                    raise RuntimeError("Unexpected file type in cleanup tree: " + entry.path)
    print("VALIDATED: %s files, %s directories, zero reparse points" % (count_files, count_dirs), flush=True)
    return target


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("verify", "delete"):
        raise RuntimeError("Expected only verify or delete mode")
    target = validate_tree()
    if sys.argv[1] == "verify":
        return
    # No fallback to a different path; shutil.rmtree is symlink-safe on Windows
    # and uses the \\?\ prefix for deeply nested node_modules.
    shutil.rmtree(target)
    if os.path.lexists(target):
        raise RuntimeError("Target still exists after removal")
    print("DELETED: approved old synthetic switch directory only", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAILED: " + type(exc).__name__ + ": " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
