"""Source-only rollback rehearsal for the exact staged Tong App and Manager.

The rehearsal is isolated: no production code, credentials or process is changed.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath

BASE = Path(r"D:\Tong\state\p27-autonomy-candidate-20261017")
PINS = Path(r"D:\Tong\runtime\run")
COMPONENTS = {
    "app": ("3442cbb938dea887a55bf13a72a5213ae4c5dbe5", "release-pin.json", "staged-app"),
    "manager": ("1eac7502a9cf89be7daf63d59843ad9f49b61877", "manager-pin.json", "staged-manager"),
}
CANDIDATE = "bb234ec794c1d8180586781c92601f2eae95e750"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def path_for(root: Path, rel: str) -> Path:
    parts = PurePosixPath(rel)
    if not rel or parts.is_absolute() or any(p in ("..", ".") or ":" in p for p in parts.parts):
        raise ValueError(f"Invalid release path: {rel}")
    if parts.parts[0] in ("node_modules", "runtime", "home", "oauth", "secrets"):
        raise ValueError(f"Release attempts to overwrite protected state: {rel}")
    return root.joinpath(*parts.parts)


def main() -> None:
    candidate = json_file(BASE / "release" / "release-manifest.json")
    assert candidate["commit"] == CANDIDATE, "Candidate changed"
    scratch = BASE / "rollback-dryrun"
    assert not scratch.exists(), "Do not overwrite previous dry-run evidence"
    assert (BASE / "staged-app" / "release-restore-evidence.json").exists()
    assert (BASE / "staged-manager" / "release-restore-evidence.json").exists()
    scratch.mkdir()
    output = []
    candidate_sources = {entry["path"]: entry for entry in candidate["sourceFiles"]}
    for kind, (commit, pin_name, staging) in COMPONENTS.items():
        pin = json_file(PINS / pin_name)
        assert pin["commit"] == commit, f"{kind} production pin changed"
        archive = BASE / f"baseline-{kind}-{commit[:7]}.zip"
        component_root = scratch / kind
        component_root.mkdir()
        retired_root = scratch / "retired" / kind
        previous = {entry["path"]: entry for entry in pin["sourceFiles"]}
        with zipfile.ZipFile(archive) as old_files:
            # Confirm exact old-commit source bytes before touching the sandbox.
            for rel, entry in previous.items():
                try:
                    content = old_files.read(rel)
                except KeyError as exc:
                    raise AssertionError(f"{kind} baseline missing {rel}") from exc
                assert sha(content) == entry["sha256"], f"{kind} baseline hash mismatch: {rel}"
                assert len(content) == entry["size"], f"{kind} baseline length mismatch: {rel}"
            # Simulate candidate being the currently installed source tree.
            for rel, entry in candidate_sources.items():
                content = path_for(BASE / staging, rel).read_bytes()
                assert sha(content) == entry["sha256"], f"Staged candidate changed: {rel}"
                dest = path_for(component_root, rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
            # Mimic retirement of new source paths when reverting to older App/Manager.
            obsolete = sorted(set(candidate_sources) - set(previous))
            for rel in obsolete:
                target = path_for(component_root, rel)
                target_retired = path_for(retired_root, rel)
                target_retired.parent.mkdir(parents=True, exist_ok=True)
                target.rename(target_retired)
            # Restore exactly the old pin's tracked source files.
            for rel, entry in previous.items():
                dest = path_for(component_root, rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(old_files.read(rel))
                assert sha(dest.read_bytes()) == entry["sha256"], f"Rollback hash mismatch: {rel}"
            for rel in obsolete:
                assert not path_for(component_root, rel).exists(), f"New-only path remained: {rel}"
            for rel, entry in candidate_sources.items():
                if rel not in previous:
                    assert sha(path_for(retired_root, rel).read_bytes()) == entry["sha256"]
        output.append({
            "component": kind,
            "baselineCommit": commit,
            "candidateCommit": candidate["commit"],
            "candidateSourceFiles": len(candidate_sources),
            "baselineSourceFiles": len(previous),
            "retiredCandidateOnlyPaths": len(obsolete),
            "allBaselineHashesVerified": True,
            "allCandidateOnlyPathsRetired": True,
        })
    proof = {
        "passed": True,
        "syntheticOnly": True,
        "kind": "source-rollback-only",
        "productionChanged": False,
        "actualRuntimeRestartTested": False,
        "actualOAuthRollbackTested": False,
        "components": output,
    }
    evidence_path = BASE / "staged-source-rollback-evidence.json"
    evidence_path.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(proof))


if __name__ == "__main__":
    main()
