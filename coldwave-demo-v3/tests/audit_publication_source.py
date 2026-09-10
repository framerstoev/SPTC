"""Scan new reachable Git blobs before publishing a branch; never print secrets."""

import json
import re
import subprocess

from build_static_review import REPO, git

pattern = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    rb"AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}"
)
objects = [line.split(b" ", 1)[0] for line in git("rev-list", "--objects", "HEAD", "--not", "--remotes=origin").splitlines()]
count = total = largest = 0
with subprocess.Popen(["git", "-C", str(REPO), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as batch:
    for oid in objects:
        batch.stdin.write(oid + b"\n")
        batch.stdin.flush()
        header = batch.stdout.readline().split()
        size = int(header[2])
        content = batch.stdout.read(size)
        assert batch.stdout.read(1) == b"\n"
        if header[1] != b"blob":
            continue
        assert not pattern.search(content), "Potential secret in unpublished Git history: stop"
        assert size < 100 * 1024**2, "Oversized Git blob: stop"
        count += 1
        total += size
        largest = max(largest, size)
    batch.stdin.close()
    assert batch.wait() == 0
print(json.dumps({"new_reachable_blobs": count, "uncompressed_new_blob_bytes": total,
                  "largest_new_blob_bytes": largest, "source_secret_scan": "pass"}))
