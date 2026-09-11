"""Runner-only allowlisted contexts; decrypt privately and verify every backend file."""

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from package import Assets  # noqa: E402


def main():
    repo = Path.cwd()
    ci = repo / "deploy/k3s/ci"
    output = repo / "ci-context"
    output.mkdir(exist_ok=False)
    metadata = json.loads((ci / "backend-context.json").read_text())
    raw = (ci / "backend-context.aesgcm").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == metadata["ciphertext_sha256"]
    key = base64.b64decode(os.environ.pop("BACKEND_CONTEXT_KEY"), validate=True)
    plaintext = AESGCM(key).decrypt(raw[:12], raw[12:], b"SPTC-v3-backend-context-v1")
    assert hashlib.sha256(plaintext).hexdigest() == metadata["context_zip_sha256"]
    with zipfile.ZipFile(io.BytesIO(plaintext)) as archive:
        assert set(archive.namelist()) == set(metadata["files"])
        for name in archive.namelist():
            path = PurePosixPath(name)
            assert (
                not path.is_absolute() and ".." not in path.parts and "\\" not in name
            )
            data = archive.read(name)
            assert hashlib.sha256(data).hexdigest() == metadata["files"][name]
            target = output / "backend" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    site = repo / "coldwave-demo-v3"
    assets = Assets()
    assets.feed((site / "index.html").read_text())
    names = [
        Path("index.html"),
        *assets.paths,
        Path("data/summary.json"),
        Path("data/data_driven_resilience_map_v0.geojson"),
    ]
    names += [
        p.relative_to(site) for p in sorted((site / "data/curves").glob("CS_*.json"))
    ]
    for name in names:
        source = site / name
        if name.as_posix() == "js/deployment-config.js":
            source = repo / "docker/frontend/deployment-config.js"
        target = output / "frontend/site" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    for name in ("Dockerfile", "nginx.conf"):
        shutil.copyfile(repo / "docker/frontend" / name, output / "frontend" / name)
    digest = "a8be52a88ec997ce7bf019555669963a477b580a"
    subprocess.run(
        [
            "git",
            "diff",
            "--exit-code",
            digest,
            "HEAD",
            "--",
            "docker/frontend",
            "coldwave-demo-v3",
        ],
        check=True,
    )
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        handle.write(
            f"frontend_short={digest[:12]}\nbackend_short={metadata['backend_deployment_commit'][:12]}\n"
        )
    print(
        "Verified allowlisted frontend and encrypted backend build contexts; no source payload logged"
    )


if __name__ == "__main__":
    main()
