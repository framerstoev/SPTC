"""Create a digest-pinned, credential-free administrator handoff; no deployment."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from render import resources


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8", newline="\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--private-context", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repo = here.parents[1]
    out = args.output.resolve()
    archive_path = out / "transportation-resilience-v3-phase4c1-k3s-handoff-final.zip"
    if out.exists():
        raise ValueError("Output must be new; preserve earlier handoffs")
    images = json.loads((here / "published-images.json").read_text(encoding="utf-8"))
    for kind in ("frontend", "backend"):
        item = images[kind]
        assert re.fullmatch(
            rf"ghcr.io/framerstoev/sptc-resilience-{kind}@sha256:[0-9a-f]{{64}}",
            item["reference"],
        )
        assert (
            item["platform"] == "linux/amd64" and item["workflow_result"] == "success"
        )
    assert images["backend"]["visibility"] == "private"
    private = args.private_context.resolve()
    manifest = json.loads(
        (private / "SOURCE_MANIFEST.json").read_text(encoding="utf-8")
    )
    for name, digest in manifest["files"].items():
        assert sha(private / name) == digest
    private_head = subprocess.check_output(
        ["git", "-C", str(private), "rev-parse", "HEAD"], text=True
    ).strip()
    assert private_head == images["backend"]["workflow_commit"]
    out.mkdir(parents=True)
    config = json.loads((here / "config.example.json").read_text(encoding="utf-8"))
    config.update(
        frontend_image=images["frontend"]["reference"],
        backend_image=images["backend"]["reference"],
        ghcr_pull_secret_name="ghcr-pull",
    )
    write(out / "config/admin-config.json", json.dumps(config, indent=2) + "\n")
    # Administrator must supply the real node name; never substitute a guessed node.
    rendered = resources(config, example=True)
    for name, value in rendered.items():
        write(out / "k3s" / name, json.dumps(value, indent=2) + "\n")
    for name in ("render.py", "test_render.py", "config.example.json"):
        target = out / "deploy/k3s" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(here / name, target)
    for name in ("Dockerfile", "nginx.conf", "deployment-config.js"):
        target = out / "Dockerfiles/frontend" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / "docker/frontend" / name, target)
    for name in ("Dockerfile", "requirements.lock"):
        target = out / "Dockerfiles/backend" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(private / name, target)
    shutil.copyfile(here / "FINAL_RUNBOOK.md", out / "DEPLOYMENT_RUNBOOK.md")
    write(
        out / "provenance/BACKEND_SOURCE_MANIFEST.json",
        json.dumps(manifest, indent=2) + "\n",
    )
    write(out / "IMAGE_MANIFEST.txt", json.dumps(images, indent=2) + "\n")
    frontend_ref = images["frontend"]["reference"]
    backend_ref = images["backend"]["reference"]
    write(
        out / "README-FIRST.md",
        "# SPTC V3 administrator handoff\n\n"
        "Public URL (deployment target, not yet deployed by this handoff):\n"
        "https://sptc.geos.tamu.edu/trans-resilience\n\n"
        "Namespace: sptc-trans-resilience\n\nStorageClass: local-path\n\n"
        f"Frontend image:\n{frontend_ref}\n\nBackend image:\n{backend_ref}\n\n"
        "Backend image visibility: PRIVATE\n\nFrontend image visibility: PUBLIC\n\n"
        "Model: qwen3:8b\n\nGPU: NVIDIA A30 / Worker 3\n\n"
        "Jinyu must provision imagePullSecret ghcr-pull for the private backend. "
        "No credentials are included.\n\n"
        "Before applying, set the actual Worker 3 node name in config/admin-config.json "
        "and regenerate manifests using DEPLOYMENT_RUNBOOK.md. The unresolved node "
        "marker is intentional and fail-closed; application image digests are real. "
        "Confirm Traefik/TLS, proxy trust, storage and NetworkPolicy enforcement.\n\n"
        "Both image workflows and read-only container checks passed. Local HTTPS "
        "browser simulation passed 23 checks/6 viewports with zero automatic "
        "Assistant, localhost, 11434 or internal-DNS requests and no console errors. "
        "This is not an A30/K3s production acceptance claim.\n\n"
        "The archive is image-based: no application datasets, model binaries, "
        "backend source, Git history or credentials. Reproduction uses the exact "
        "authorized repositories/commits in RELEASE.txt and IMAGE_MANIFEST.txt.\n",
    )
    release = {
        "status": "ADMINISTRATOR_HANDOFF_READY_CLUSTER_ROLLOUT_NOT_PERFORMED",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "frontend_accepted_commit": "345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b",
        "frontend_accepted_tag": "phase4c1-v3-plain-language-ai-accepted",
        "backend_accepted_commit": "e6b0ad5600e1d0056cd927ba9034bda6243b6030",
        "backend_accepted_tag": "phase4c1-plain-language-ai-accepted",
        "private_repository": "https://github.com/framerstoev/SPTC-backend-private",
        "private_repository_visibility": "private",
        "private_repository_commit": private_head,
        "handoff_tools_commit": subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
        ).strip(),
        "images": images,
        "snapshot_checksums": {
            n: h for n, h in manifest["files"].items() if n.startswith("snapshot/")
        },
        "cluster_rollout": "not attempted",
        "administrator_inputs_required": [
            "actual Worker 3 node name",
            "imagePullSecret",
            "Traefik/TLS and proxy trust confirmation",
            "CNI NetworkPolicy enforcement",
            "A30/model acceptance",
        ],
    }
    write(out / "RELEASE.txt", json.dumps(release, indent=2) + "\n")
    files = sorted(p for p in out.rglob("*") if p.is_file())
    write(
        out / "FILE_MANIFEST.txt",
        "\n".join(f"{p.stat().st_size}\t{p.relative_to(out).as_posix()}" for p in files)
        + "\n",
    )
    files = sorted(p for p in out.rglob("*") if p.is_file())
    write(
        out / "SHA256SUMS.txt",
        "\n".join(f"{sha(p)}  {p.relative_to(out).as_posix()}" for p in files) + "\n",
    )
    with zipfile.ZipFile(
        archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for path in sorted(
            p for p in out.rglob("*") if p.is_file() and p != archive_path
        ):
            archive.write(path, path.relative_to(out).as_posix())
    print(
        json.dumps(
            {
                "archive": str(archive_path),
                "bytes": archive_path.stat().st_size,
                "sha256": sha(archive_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
