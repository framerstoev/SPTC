"""Prepare only the public frontend context; backend builds in its private repository."""

import os
import shutil
import subprocess
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from package import Assets  # noqa: E402


def main():
    repo = Path.cwd()
    output = repo / "ci-context"
    output.mkdir(exist_ok=False)
    site = repo / "coldwave-demo-v3"
    assets = Assets()
    assets.feed((site / "index.html").read_text(encoding="utf-8"))
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
        handle.write(f"frontend_short={digest[:12]}\n")
    print("Verified public frontend context; no backend assets accessed")


if __name__ == "__main__":
    main()
