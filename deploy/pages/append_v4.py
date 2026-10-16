"""Append the complete reviewed V4 research release, preserving earlier versions."""
from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[2]
TEXT = {".html", ".css", ".js", ".json", ".md", ".txt"}
SECRET = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}")
PRIVATE = re.compile(rb"(?<![A-Za-z])[A-Za-z]:[\\/]|file://|/Users/|/home/[^/]+/|https?://(?:localhost|127\.0\.0\.1)(?::|/)", re.I)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Resources(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.paths: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        fields = dict(attrs)
        for key in (["src"] if tag == "script" else ["href"] if tag in {"link", "a"} else []):
            if fields.get(key):
                self.paths.append(fields[key])


def append(artifact: Path) -> dict:
    artifact = artifact.resolve()
    assert artifact.is_dir() and (artifact / "index.html").is_file()
    assert artifact != REPO and REPO not in artifact.parents
    manifest = json.loads((REPO / "deploy/pages/v4-public-files.json").read_text(encoding="utf-8"))
    source = REPO / "coldwave-demo-v4"
    files = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
    assert files == set(manifest["files"]) and len(files) == 3871, "Unexpected V4 publication file"
    assert not any(p.is_symlink() for p in source.rglob("*")), "No symlinks in V4"
    for name, expected in manifest["preserved_html"].items():
        assert digest(artifact / name) == expected, f"Existing published HTML differs: {name}"
    before = {p.relative_to(artifact).as_posix(): digest(p) for p in artifact.rglob("*") if p.is_file()}
    destination = artifact / "coldwave-demo-v4"
    assert not destination.exists(), "Never overwrite an existing version"
    payloads = {}
    for name in sorted(files):
        relative = PurePosixPath(name)
        assert not relative.is_absolute() and ".." not in relative.parts
        raw = (source / name).read_bytes()
        if relative.suffix.lower() in TEXT:
            assert not SECRET.search(raw) and not PRIVATE.search(raw), name
        assert hashlib.sha256(raw).hexdigest() == manifest["files"][name], f"Unreviewed V4 content: {name}"
        if relative.parts[0] == "data":
            assert re.fullmatch(r"data/(?:public-manifest\.json|geometry\.json|sections\.json|summaries\.json|curves/CS_\d+\.json)", name), "Unexpected analytical product"
        payloads[name] = raw
    policy = json.loads(payloads["data/public-manifest.json"])
    assert policy["public_only"] is True and policy["mode"] == "PUBLIC_ANALYTICAL"
    assert policy["approval_status"] == "APPROVED" and policy["publish_allowed"] is True
    assert policy["redistribution_approved"] is True and policy["curves_included"] is True
    assert policy["source_status"] == "REVIEW_READY" and policy["source_approval_status"] == "NOT_APPROVED"
    record_path = REPO / "deploy/pages/v4-release-record.json"
    assert digest(record_path) == policy["release_record_sha256"] == manifest["release_record_sha256"]
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["status"] == "AUTHORIZED_FOR_PUBLICATION" and record["release_id"] == policy["release_id"]
    assert record["project_authorization"]["explicit_user_approval"] is True
    assert record["rights_basis"] == policy["rights_basis"]
    assert record["rights_basis"]["kind"] == "USER_AUTHORIZATION_REPRESENTATION"
    assert record["rights_basis"]["derived_results_cleared_as_represented_by_user"] is True
    assert record["rights_basis"]["independently_verified_third_party_license"] is False
    assert record["explicit_applicable_prohibition_identified"] is False
    indexed = policy["files"]
    assert set(indexed) == {n for n in files if n.startswith("data/") and n != "data/public-manifest.json"}
    assert len(indexed) == 3845 and policy["curve_count"] == 3842
    payload_hash = hashlib.sha256(json.dumps(indexed, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert payload_hash == policy["payload_sha256"] == record["payload_sha256"] == policy["approval"]["approved_payload_sha256"]
    for name, metadata in indexed.items():
        assert hashlib.sha256(payloads[name]).hexdigest() == metadata["sha256"] and len(payloads[name]) == metadata["bytes"], name
    rows = json.loads(payloads["data/sections.json"])
    geometry = json.loads(payloads["data/geometry.json"])
    summaries = json.loads(payloads["data/summaries.json"])
    ids = {r["id"] for r in rows}
    assert len(rows) == len(ids) == len(geometry["features"]) == policy["section_count"] == 10029
    assert ids == {f["properties"]["id"] for f in geometry["features"]}
    assert {f"data/curves/CS_{r['id']}.json" for r in rows if r["has_curve"]} == {n for n in indexed if n.startswith("data/curves/")}
    assert len(summaries["counties"]) == policy["county_count"] == 223
    for name in ["index.html", "docs.html"]:
        parser = Resources()
        parser.feed(payloads[name].decode("utf-8"))
        for link in parser.paths:
            url = urlsplit(link)
            if url.scheme or not url.path:
                continue
            assert not url.path.startswith("/") and ".." not in PurePosixPath(url.path).parts, link
            path = PurePosixPath(url.path).as_posix()
            assert path in {".", "./"} or path in files, link
    for name, raw in payloads.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(raw)
    assert all(digest(artifact / name) == expected for name, expected in before.items()), "Existing site changed"
    total = sum(p.stat().st_size for p in artifact.rglob("*") if p.is_file())
    assert total < 1000 * 1000**2
    return {"status": "V4_APPEND_VERIFIED", "source_commit": manifest["source_commit"],
            "preserved_files": len(before), "v4_files": len(files), "v4_analytical_data_files": len(indexed),
            "existing_files_unchanged": True, "artifact_bytes": total}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    print(json.dumps(append(parser.parse_args().artifact)))
