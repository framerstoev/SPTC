"""Verify published digest pulls/platforms and emit a credential-free release record."""

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from github_api import REPOSITORY, api


def main():
    report = {
        "workflow_run_id": os.environ["GITHUB_RUN_ID"],
        "workflow_run_url": f"https://github.com/{REPOSITORY}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        "workflow_source_commit": os.environ["GITHUB_SHA"],
        "build_date_utc": datetime.now(timezone.utc).isoformat(),
        "images": {},
    }
    for kind, commit, accepted, tag in (
        (
            "frontend",
            "a8be52a88ec997ce7bf019555669963a477b580a",
            "345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b",
            "phase4c1-v3-plain-language-ai-accepted",
        ),
    ):
        digest = os.environ[kind.upper() + "_DIGEST"]
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", digest)
        name = f"ghcr.io/framerstoev/sptc-resilience-{kind}"
        ref = name + "@" + digest
        subprocess.run(["docker", "pull", "--platform", "linux/amd64", ref], check=True)
        info = json.loads(subprocess.check_output(["docker", "image", "inspect", ref]))[
            0
        ]
        assert info["Os"] == "linux" and info["Architecture"] == "amd64"
        assert ref in info["RepoDigests"]
        for version in ("v3-phase4c1", "git-" + commit[:12]):
            subprocess.run(
                ["docker", "pull", "--platform", "linux/amd64", name + ":" + version],
                check=True,
            )
            tagged = json.loads(
                subprocess.check_output(
                    ["docker", "image", "inspect", name + ":" + version]
                )
            )[0]
            assert tagged["Id"] == info["Id"] and ref in tagged["RepoDigests"]
        try:
            package = api(
                f"users/framerstoev/packages/container/sptc-resilience-{kind}"
            )
            visibility = package["visibility"]
        except RuntimeError:
            visibility = "unverified_treat_as_private"
        report["images"][kind] = {
            "name": name,
            "digest": digest,
            "reference": ref,
            "version_tags": ["v3-phase4c1", "git-" + commit[:12]],
            "platform": "linux/amd64",
            "image_size_bytes": info["Size"],
            "visibility": visibility,
            "deployment_source_commit": commit,
            "accepted_application_commit": accepted,
            "accepted_application_tag": tag,
        }
    Path("ci-results").mkdir(exist_ok=True)
    Path("ci-results/published-images.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
