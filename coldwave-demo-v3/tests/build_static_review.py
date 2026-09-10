"""Allowlisted Pages artifact; no analytical calculations or source data writes."""

import argparse
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[2]
SOURCE = "345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b"
TAG = "phase4c1-v3-plain-language-ai-accepted"
LEGACY = "f79d31a8a279dd5a7fac805fc1fda32a482910f2"
V3 = "coldwave-demo-v3"
RUNTIME = ("index.html", "css/style.css", "js/app.js", "js/workspace.js")
SECRET = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|"
    rb"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    rb"AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}"
)
PRIVATE_PATH = re.compile(rb"(?<![A-Za-z])[A-Za-z]:[\\/]|file://|/Users/|/home/[^/]+/")
BACKEND = re.compile(rb"(?:127\.0\.0\.1|localhost):8080|:11434|/api/v1/|wss?://", re.I)


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args])


def write_new(root, relative, content):
    path = PurePosixPath(relative)
    assert not path.is_absolute() and ".." not in path.parts
    target = root.joinpath(*path.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(content)


def static_html(raw):
    text = raw.decode("utf-8")
    start = '  <button class="assistant-launcher"'
    end = '  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"'
    assert text.count(start) == text.count(end) == 1
    before, remainder = text.split(start)
    _, after = remainder.split(end)
    text = before + end + after
    for name in ("assistant-config", "assistant-api", "assistant-actions", "assistant-chat",
                 "assistant-window", "ranking-browser"):
        script = f'  <script src="./js/{name}.js"></script>\n'
        assert text.count(script) == 1
        text = text.replace(script, "")
    assert "assistantLauncher" not in text and "rankingDialog" not in text
    return text.encode("utf-8")


def static_app(raw):
    text = raw.decode("utf-8")
    original = "setupFloatingAssistant();\nsetupAssistant();"
    assert text.count(original) == 1
    return text.replace(original, "if (window.SPTCV3Deployment.mode !== \"static-review\") {\n"
                        "  setupFloatingAssistant();\n  setupAssistant();\n}").encode("utf-8")


def build(output):
    output = output.resolve()
    assert not output.exists(), "Artifact output must be a new directory; never overwrites"
    assert REPO != output and REPO not in output.parents, "Artifact stays outside repository"
    # The accepted tag is local; publishing unrelated tags is not authorized.
    # CI pins the immutable commit directly; verify the tag when available locally.
    git("cat-file", "-e", f"{SOURCE}^{{commit}}")
    if git("tag", "--list", TAG).strip():
        assert git("rev-parse", f"{TAG}^{{commit}}").decode().strip() == SOURCE
    git("merge-base", "--is-ancestor", SOURCE, "HEAD")
    output.mkdir(parents=True)
    # Preserve the already-public legacy runtime, not changed local V2 code or docs.
    archive = git("archive", "--format=tar", LEGACY)
    legacy_count = 0
    with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
        for member in stream:
            if member.isdir():
                continue
            assert member.isfile(), "No links or special files"
            path = PurePosixPath(member.name)
            if path.suffix.lower() not in {".html", ".js", ".css", ".json", ".geojson", ".csv", ".png", ".svg", ".jpg", ".ico"} and member.name != ".nojekyll":
                continue
            write_new(output, member.name, stream.extractfile(member).read())
            legacy_count += 1
    source_files = list(RUNTIME) + [p.relative_to(REPO / V3).as_posix()
                                  for p in sorted((REPO / V3 / "data").rglob("*")) if p.is_file()]
    accepted_blobs = {}
    for entry in git("ls-tree", "-r", SOURCE, "--", V3).decode().splitlines():
        metadata, name = entry.split("\t", 1)
        accepted_blobs[name] = metadata.split()[2]
    digest = hashlib.sha256()
    data_bytes = data_count = 0
    for relative in source_files:
        path = REPO / V3 / relative
        assert not path.is_symlink()
        raw = path.read_bytes().replace(b"\r\n", b"\n") if relative in RUNTIME else path.read_bytes()
        blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        assert blob == accepted_blobs.get(f"{V3}/{relative}"), f"Unreviewed runtime change: {relative}"
        if relative.startswith("data/"):
            data_bytes += len(raw)
            data_count += 1
            digest.update(relative.encode() + b"\0" + raw)
        if relative == "index.html":
            raw = static_html(raw)
        elif relative == "js/app.js":
            raw = static_app(raw)
        write_new(output, f"{V3}/{relative}", raw)
    config = (REPO / V3 / "static-review/deployment-config.js").read_bytes()
    write_new(output, f"{V3}/js/deployment-config.js", config)
    release = {"release": "V3 static web review", "source_commit": SOURCE,
               "source_tag": TAG, "deployment_commit": git("rev-parse", "HEAD").decode().strip(),
               "ai_enabled": False}
    write_new(output, f"{V3}/release.json", json.dumps(release, indent=2).encode() + b"\n")
    files = [p for p in output.rglob("*") if p.is_file()]
    for path in files:
        raw = path.read_bytes()
        assert not SECRET.search(raw), f"Secret pattern: {path.name}"
        assert not PRIVATE_PATH.search(raw), f"Private path: {path.name}"
        if (output / V3) in path.parents:
            assert not BACKEND.search(raw), f"Backend endpoint: {path.name}"
        assert len(raw) < 100 * 1024**2, "GitHub individual file limit"
    total = sum(p.stat().st_size for p in files)
    assert total < 1000 * 1000**2, "Pages site size limit"
    return {"artifact_files": len(files), "artifact_bytes": total,
            "legacy_runtime_files": legacy_count, "v3_files": len(source_files) + 2,
            "data_files": data_count, "data_bytes": data_bytes,
            "data_sha256": digest.hexdigest(),
            "largest_bytes": max(p.stat().st_size for p in files),
            "secret_scan": "pass", "private_path_scan": "pass", "backend_url_scan": "pass"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output), sort_keys=True))
