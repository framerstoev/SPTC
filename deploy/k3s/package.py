"""Create scoped build contexts and a DRAFT handoff without invoking Docker or Kubernetes."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from render import resources

FRONTEND_SOURCE = "345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b"
BACKEND_SOURCE = "e6b0ad5600e1d0056cd927ba9034bda6243b6030"
FRONTEND_TAG = "phase4c1-v3-plain-language-ai-accepted"
BACKEND_TAG = "phase4c1-plain-language-ai-accepted"
SNAPSHOT_FILES = (
    "sections.parquet",
    "curves.parquet",
    "release.json",
    "schema.json",
    "curve_release.json",
    "curve_schema.json",
)


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def check_repository(repo, source):
    if git(repo, "branch", "--show-current") != "feature/v3-k3s-deployment":
        raise ValueError("packaging requires the dedicated deployment branch")
    subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", source, "HEAD"],
        check=True,
    )
    lines = git(repo, "status", "--porcelain").splitlines()
    if any(line != "?? debug.log" for line in lines):
        raise ValueError("commit reviewed deployment work before building the handoff")
    changed = git(repo, "diff", "--name-only", source, "HEAD").splitlines()
    exact = (
        {
            "coldwave-demo-v3/js/assistant-config.js",
            "coldwave-demo-v3/tests/run_server_config_qa.js",
        }
        if source == FRONTEND_SOURCE
        else {
            "src/resilience_agent/config.py",
            "tests/test_k3s_config.py",
            "tests/test_container_readiness.py",
        }
    )
    exact.add(".gitattributes")
    prefixes = ("docker/", "deploy/k3s/") if source == FRONTEND_SOURCE else ("docker/",)
    if any(name not in exact and not name.startswith(prefixes) for name in changed):
        raise ValueError("unreviewed change outside deployment allowlist")
    return git(repo, "rev-parse", "HEAD")


def copy(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError("only regular allowlisted files may be packaged")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        for key, val in attrs:
            if key in {"src", "href"} and val and val.startswith("./"):
                if ".." in Path(val).parts:
                    raise ValueError("asset traversal")
                self.paths.append(Path(val))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path, required=True, help="new, nonexisting package directory"
    )
    args = parser.parse_args()
    frontend = Path(__file__).resolve().parents[2]
    backend = args.backend.resolve()
    front_head = check_repository(frontend, FRONTEND_SOURCE)
    back_head = check_repository(backend, BACKEND_SOURCE)
    output = args.output.resolve()
    if output.exists() or output.with_suffix(".zip").exists():
        raise ValueError("output must be new; never overwrite an earlier handoff")
    output.mkdir(parents=True)
    site = frontend / "coldwave-demo-v3"
    assets = Assets()
    assets.feed((site / "index.html").read_text(encoding="utf-8"))
    runtime = [
        Path("index.html"),
        *assets.paths,
        Path("data/summary.json"),
        Path("data/data_driven_resilience_map_v0.geojson"),
    ]
    runtime += [
        p.relative_to(site) for p in sorted((site / "data/curves").glob("CS_*.json"))
    ]
    for relative in runtime:
        source = site / relative
        if relative.as_posix() == "js/deployment-config.js":
            source = frontend / "docker/frontend/deployment-config.js"
        copy(source, output / "docker/frontend/site" / relative)
    for name in ("Dockerfile", "nginx.conf"):
        copy(frontend / "docker/frontend" / name, output / "docker/frontend" / name)
    for file in sorted((backend / "src").rglob("*.py")):
        copy(file, output / "docker/backend/src" / file.relative_to(backend / "src"))
    for name in ("Dockerfile", "requirements.lock", "readiness.py", "smoke.py"):
        copy(backend / "docker" / name, output / "docker/backend" / name)
    for name in SNAPSHOT_FILES:
        copy(
            backend / ".local/snapshot" / name,
            output / "docker/backend/snapshot" / name,
        )
    for manifest_name in ("release.json", "curve_release.json"):
        manifest = json.loads((backend / ".local/snapshot" / manifest_name).read_text())
        for key in ("snapshot", "schema"):
            artifact = manifest[key]
            if (
                sha(output / "docker/backend/snapshot" / artifact["filename"])
                != artifact["sha256"]
            ):
                raise ValueError("snapshot/schema integrity mismatch")
    for name in (
        "render.py",
        "config.example.json",
        "test_render.py",
        "build-images.sh",
        "audit_archive.py",
    ):
        copy(Path(__file__).with_name(name), output / "deploy/k3s" / name)
    config = json.loads(Path(__file__).with_name("config.example.json").read_text())
    for name, value in resources(config, example=True).items():
        write(output / "deploy/k3s/examples" / name, json.dumps(value, indent=2) + "\n")
    copy(Path(__file__).with_name("README.md"), output / "README-FIRST.md")
    copy(Path(__file__).with_name("README.md"), output / "docs/ADMIN_RUNBOOK.md")
    copy(Path(__file__).with_name("VALIDATION.md"), output / "docs/VALIDATION.md")
    data_files = [
        p for p in (output / "docker/frontend/site/data").rglob("*") if p.is_file()
    ]
    snapshot_bytes = sum(
        (output / "docker/backend/snapshot" / n).stat().st_size for n in SNAPSHOT_FILES
    )
    release = {
        "status": "DRAFT_NOT_BUILT_NOT_HANDOFF_READY",
        "build_date_utc": datetime.now(timezone.utc).isoformat(),
        "frontend_source": {
            "branch": "feature/v3-plain-language-ai",
            "tag": FRONTEND_TAG,
            "commit": FRONTEND_SOURCE,
        },
        "backend_source": {
            "branch": "feature/v3-plain-language-ai",
            "tag": BACKEND_TAG,
            "commit": BACKEND_SOURCE,
        },
        "frontend_deployment_commit": front_head,
        "backend_deployment_commit": back_head,
        "target_platform": "linux/amd64",
        "platform_verified_by_build": False,
        "frontend_image": f"ghcr.io/framerstoev/sptc-resilience-frontend:v3-phase4c1-{front_head[:12]}",
        "backend_image": f"ghcr.io/framerstoev/sptc-resilience-backend:v3-phase4c1-{back_head[:12]}",
        "frontend_digest": None,
        "backend_digest": None,
        "ghcr_push_status": "not_attempted_no_linux_builder",
        "ollama_image": json.loads(
            Path(__file__).with_name("config.example.json").read_text()
        )["ollama_image"],
        "model": "qwen3:8b",
        "model_blob_bytes": 5225388164,
        "ollama_pvc": "20Gi",
        "public_url": "https://sptc.geos.tamu.edu/trans-resilience",
        "public_url_live_validated": False,
        "namespace": "sptc-trans-resilience",
        "storage_class": "local-path",
        "frontend_data_files": len(data_files),
        "frontend_data_bytes": sum(p.stat().st_size for p in data_files),
        "backend_snapshot_bytes": snapshot_bytes,
    }
    write(output / "RELEASE.txt", json.dumps(release, indent=2) + "\n")
    write(
        output / "IMAGE_MANIFEST.txt",
        json.dumps(
            {
                k: v
                for k, v in release.items()
                if any(
                    x in k
                    for x in ("image", "digest", "commit", "platform", "model", "push")
                )
            },
            indent=2,
        )
        + "\n",
    )
    # Deny known credential markers; identifiers/prompt schema words are not secrets.
    secret = re.compile(
        rb"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}"
    )
    files = sorted(p for p in output.rglob("*") if p.is_file())
    for file in files:
        if secret.search(file.read_bytes()):
            raise ValueError("credential marker found; package is blocked")
    manifest = (
        "\n".join(
            f"{p.relative_to(output).as_posix()}\t{p.stat().st_size}\t{sha(p)}"
            for p in files
        )
        + "\n"
    )
    write(output / "FILE_MANIFEST.txt", manifest)
    files.append(output / "FILE_MANIFEST.txt")
    write(
        output / "SHA256SUMS.txt",
        "\n".join(
            f"{sha(p)}  {p.relative_to(output).as_posix()}" for p in sorted(files)
        )
        + "\n",
    )
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(
        archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6
    ) as zipped:
        for file in sorted(p for p in output.rglob("*") if p.is_file()):
            zipped.write(file, file.relative_to(output).as_posix())
    print(
        json.dumps(
            {
                "archive": str(archive),
                "bytes": archive.stat().st_size,
                "sha256": sha(archive),
                "release": release,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
