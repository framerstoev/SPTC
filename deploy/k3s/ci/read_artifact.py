"""Read image metadata without forwarding GitHub credentials to storage."""

import argparse
import io
import json
import urllib.error
import urllib.request
import zipfile

from github_api import api, credential


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repository")
    parser.add_argument("run_id")
    parser.add_argument("artifact_name")
    args = parser.parse_args()
    records = api(f"repos/{args.repository}/actions/runs/{args.run_id}/artifacts")
    artifact = next(a for a in records["artifacts"] if a["name"] == args.artifact_name)
    url = f"https://api.github.com/repos/{args.repository}/actions/artifacts/{artifact['id']}/zip"
    request = urllib.request.Request(
        url, headers={"Authorization": "Bearer " + credential()}
    )
    try:
        urllib.request.build_opener(NoRedirect()).open(request, timeout=60)
        raise RuntimeError("Expected signed storage redirect")
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise RuntimeError(f"Artifact download HTTP {error.code}") from None
        signed = error.headers["Location"]
    if not signed.startswith("https://"):
        raise RuntimeError("Non-HTTPS artifact location")
    with urllib.request.urlopen(signed, timeout=60) as response:
        content = response.read()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for name in archive.namelist():
            if name.endswith(".json"):
                print(json.dumps(json.loads(archive.read(name)), indent=2))


if __name__ == "__main__":
    main()
