"""Append the reviewed code-only V4 directory without changing the existing site."""
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
    assert files == set(manifest["files"]) and len(files) == 26, "Unexpected V4 publication file"
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
            raw = raw.replace(b"\r\n", b"\n")
            assert not SECRET.search(raw) and not PRIVATE.search(raw), name
        assert hashlib.sha256(raw).hexdigest() == manifest["files"][name], f"Unreviewed V4 content: {name}"
        if relative.parts[0] == "data":
            assert name == "data/public-manifest.json", "No analytical data files"
        payloads[name] = raw
    policy = json.loads(payloads["data/public-manifest.json"])
    assert policy["public_only"] is True and policy["mode"] == "PUBLIC_SHOWCASE"
    assert policy["events"] == [] and policy["status"] == "NO_PUBLIC_ANALYTICAL_PACKAGE"
    assert policy["redistribution_approved"] is True
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
            "preserved_files": len(before), "v4_files": len(files), "v4_analytical_data_files": 0,
            "existing_files_unchanged": True, "artifact_bytes": total}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    print(json.dumps(append(parser.parse_args().artifact)))
