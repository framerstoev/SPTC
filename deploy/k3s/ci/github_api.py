"""Small deployment operator helper. Credentials stay in memory, never in output."""

import json
import os
import subprocess
import urllib.error
import urllib.request

REPOSITORY = "framerstoev/SPTC"


def credential():
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    result = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        check=True,
    )
    values = dict(
        line.split("=", 1) for line in result.stdout.splitlines() if "=" in line
    )
    return values["password"]


def api(path, *, method="GET", body=None, token=None, missing_ok=False):
    request = urllib.request.Request(
        "https://api.github.com/" + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": "Bearer " + (token or credential()),
            "User-Agent": "SPTC-K3s-publication",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise RuntimeError(f"GitHub {method} failed with HTTP {error.code}") from None


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["runs", "dispatch", "run"])
    parser.add_argument("--run-id")
    args = parser.parse_args()
    base = f"repos/{REPOSITORY}/actions"
    if args.action == "runs":
        values = api(base + "/runs?branch=feature%2Fv3-k3s-deployment&per_page=10")
        print(
            json.dumps(
                [
                    {
                        k: run.get(k)
                        for k in (
                            "id",
                            "head_sha",
                            "name",
                            "event",
                            "status",
                            "conclusion",
                            "html_url",
                        )
                    }
                    for run in values["workflow_runs"]
                ],
                indent=2,
            )
        )
    elif args.action == "dispatch":
        api(
            base + "/workflows/v3-containers.yml/dispatches",
            method="POST",
            body={"ref": "feature/v3-k3s-deployment"},
        )
        print("Workflow dispatch submitted")
    else:
        run = api(base + "/runs/" + args.run_id)
        jobs = api(base + "/runs/" + args.run_id + "/jobs")
        print(
            json.dumps(
                {
                    "run": {
                        k: run.get(k)
                        for k in ("id", "head_sha", "status", "conclusion", "html_url")
                    },
                    "jobs": [
                        {
                            "name": j["name"],
                            "status": j["status"],
                            "conclusion": j["conclusion"],
                            "steps": [
                                {k: s.get(k) for k in ("name", "status", "conclusion")}
                                for s in j["steps"]
                            ],
                        }
                        for j in jobs["jobs"]
                    ],
                },
                indent=2,
            )
        )
