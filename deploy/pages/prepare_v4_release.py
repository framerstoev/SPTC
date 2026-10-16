"""Promote an intact, reviewed V4 staging copy using recorded user authorization.

Copies existing products without analytical recomputation. Never modifies the
candidate, source run or an existing output directory. The authorization records
the user's clearance representation, not an independently verified source license.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def change(text: str, old: str, new: str) -> str:
    assert old in text, old
    return text.replace(old, new)


def prepare(candidate: Path, inventory: Path, authorization: Path, output: Path) -> dict:
    assert not output.exists(), "Use a new release directory; retain the staging checkpoint"
    expected = json.loads(inventory.read_text(encoding="utf-8"))
    record = json.loads(authorization.read_text(encoding="utf-8"))
    files = {p.relative_to(candidate).as_posix(): p for p in candidate.rglob("*") if p.is_file()}
    assert set(files) == set(expected["files"]) and len(files) == 3871
    assert all(digest(path) == expected["files"][name] for name, path in files.items())
    policy = json.loads((candidate / "data/public-manifest.json").read_text(encoding="utf-8"))
    assert policy["mode"] == "STAGED_RESEARCH_PREVIEW" and not policy["publish_allowed"]
    assert record["status"] == "AUTHORIZED_FOR_PUBLICATION"
    assert record["project_authorization"]["explicit_user_approval"] is True
    assert record["rights_basis"]["kind"] == "USER_AUTHORIZATION_REPRESENTATION"
    assert record["rights_basis"]["derived_results_cleared_as_represented_by_user"] is True
    assert record["rights_basis"]["independently_verified_third_party_license"] is False
    assert record["explicit_applicable_prohibition_identified"] is False
    assert record["payload_sha256"] == policy["payload_sha256"]
    assert record["source_run_id"] == policy["run_id"] and record["event_id"] == policy["event_id"]
    output.mkdir(parents=True)
    for name, source in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        # Match the existing hosted runtime's LF bytes on Windows and Linux.
        # Analytical products are always copied verbatim for their fixed hashes.
        if not name.startswith("data/") and source.suffix in {".html", ".css", ".js", ".md", ".txt"}:
            target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n"))
    data = (output / "js/data.js").read_text(encoding="utf-8")
    data = change(data, '"Published research release · source run remains REVIEW_READY / NOT_APPROVED"', '"Published research release"')
    data = change(data, '!approval?.approved_at', '!(approval?.recorded_at || approval?.approved_at)')
    (output / "js/data.js").write_text(data, encoding="utf-8", newline="\n")
    core = (output / "js/core.js").read_text(encoding="utf-8")
    core = change(core, " Local review results are not approved for publication.", "")
    (output / "js/core.js").write_text(core, encoding="utf-8", newline="\n")
    nav = (output / "js/navigation.js").read_text(encoding="utf-8")
    old = '`${data.manifest.status} / ${data.manifest.approval_status}`'
    nav = change(nav, old, '`${data.manifest.status} / ${data.manifest.approval_status}`, `Source computation: ${data.manifest.source_status || data.manifest.status} / ${data.manifest.source_approval_status || data.manifest.approval_status}`')
    marker = '      if (local) {\n        const provenance = heading'
    addition = '''      if (data.manifest.attribution) {
        const sources = heading(host, "SOURCE ATTRIBUTION", "Research inputs", [
          "Roadway geometry and context: Texas Department of Transportation (TxDOT).",
          "Traffic evidence: NPMRDS, sourced from INRIX. Only derived control-section research products are served.",
          "PRISM Group, Oregon State University, https://prism.oregonstate.edu. Temperature: D2 release 8. Original data-access date is not recorded in the available provenance."
        ]);
        const link = T("a", "PRISM source and terms ↗", "text-action"); link.href = "https://prism.oregonstate.edu/terms/"; sources.append(link);
      }
'''
    nav = change(nav, marker, addition + marker)
    (output / "js/navigation.js").write_text(nav, encoding="utf-8", newline="\n")
    docs = (output / "js/docs.js").read_text(encoding="utf-8")
    docs = change(docs, "The original January run remains REVIEW_READY / NOT_APPROVED. Local staging does not grant redistribution rights. A separately authorized public release records its own approval and preserves source-run status; the loaded Data panel reports the actual package state.", "The public V4 research release is separately authorized by the project administrator. The original January computation remains REVIEW_READY / NOT_APPROVED; public release metadata preserves that provenance without changing the source run. The Data panel reports release and source-computation status separately.")
    docs = change(docs, "Temperature uses PRISM D2 release 8;", "PRISM Group, Oregon State University, https://prism.oregonstate.edu. The original data-access date is not recorded in the available provenance. Temperature uses PRISM D2 release 8;")
    (output / "js/docs.js").write_text(docs, encoding="utf-8", newline="\n")
    for name in policy["files"]:
        assert digest(output / name) == policy["files"][name]["sha256"], name
    policy.update({"mode": "PUBLIC_ANALYTICAL", "status": "AUTHORIZED_PUBLIC_RESEARCH_RELEASE", "approval_status": "APPROVED", "redistribution_approved": True,
                   "publish_allowed": True, "public_only": True, "release_id": record["release_id"], "release_record_sha256": digest(authorization),
                   "source_status": "REVIEW_READY", "source_approval_status": "NOT_APPROVED",
                   "approval": {"approved_by": "SPTC project administrator (user authorization)", "recorded_at": record["authorization_recorded_at"],
                                "decision_reference": "SPTC user authorization and final deployment instruction " + record["instruction_reference"],
                                "rights_reference": "User representation that project-derived results are cleared; existing SPTC publication evidence reused where applicable",
                                "approved_payload_sha256": policy["payload_sha256"], "basis": "USER_AUTHORIZATION_REPRESENTATION", "independently_verified_third_party_license": False},
                   "rights_basis": record["rights_basis"], "license_checks": {"basis": "User clearance representation; not an independently verified third-party license", "existing_v3_assets": "Previously published unchanged Q(t) products reused", "explicit_applicable_prohibition_identified": False, "prism_access_date": "Not verified; recorded as attribution metadata gap"}})
    policy.pop("blocked_reasons", None)
    (output / "data/public-manifest.json").write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8", newline="\n")
    hashes = {p.relative_to(output).as_posix(): digest(p) for p in output.rglob("*") if p.is_file()}
    assert len(hashes) == 3871
    return {"status": "FULL_PUBLIC_RELEASE_PREPARED", "files": hashes, "file_count": len(hashes), "data_files_unchanged": len(policy["files"]),
            "curve_count": policy["curve_count"], "payload_sha256": policy["payload_sha256"], "release_record_sha256": digest(authorization)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["candidate", "inventory", "authorization", "output"]:
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    result = prepare(args.candidate.resolve(), args.inventory.resolve(), args.authorization.resolve(), args.output.resolve())
    print(json.dumps({k: v for k, v in result.items() if k != "files"}))
