"""Read-only independent ZIP checksum, exclusion and runtime inventory audit."""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path, PurePosixPath


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--image-only", action="store_true")
    args = parser.parse_args()
    denied = {
        ".git",
        ".venv",
        "debug.log",
        "__pycache__",
        "node_modules",
        ".env",
        "local-demo",
    }
    secrets = re.compile(
        rb"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}"
    )
    private_paths = re.compile(rb"[CDE]:[/\\](?:Users|Projects|programming)[/\\]", re.I)
    with zipfile.ZipFile(args.archive) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), "duplicate archive paths"
        hashes = {}
        for line in archive.read("SHA256SUMS.txt").decode().splitlines():
            digest, name = line.split("  ", 1)
            hashes[name] = digest
        assert set(hashes) == set(names) - {"SHA256SUMS.txt"}
        for name in names:
            path = PurePosixPath(name)
            assert not path.is_absolute() and ".." not in path.parts
            assert not (denied & set(path.parts)) and path.suffix.lower() not in {
                ".pem",
                ".key",
                ".gguf",
                ".log",
                ".png",
            }
            content = archive.read(name)
            assert not secrets.search(content), "credential marker"
            assert not private_paths.search(content), "machine-specific path"
            if name in hashes:
                assert hashlib.sha256(content).hexdigest() == hashes[name], (
                    "checksum mismatch"
                )
        data = [
            i
            for i in archive.infolist()
            if i.filename.startswith("docker/frontend/site/data/")
        ]
        if args.image_only:
            assert not data
            assert not any(
                n.endswith(".parquet") or "/src/" in n or "/snapshot/" in n
                for n in names
            )
            images = json.loads(archive.read("IMAGE_MANIFEST.txt"))
            assert images["backend"]["visibility"] == "private"
            for order, kind in ((50, "backend"), (60, "frontend")):
                ref = images[kind]["reference"]
                assert re.fullmatch(
                    rf"ghcr.io/framerstoev/sptc-resilience-{kind}@sha256:[0-9a-f]{{64}}",
                    ref,
                )
                deployment = json.loads(
                    archive.read(f"k3s/{order}-{kind}-deployment.json")
                )
                pod = deployment["spec"]["template"]["spec"]
                assert pod["containers"][0]["image"] == ref
                assert pod["imagePullSecrets"] == [{"name": "ghcr-pull"}]
        else:
            assert len(data) == 3844
            assert sum(i.file_size for i in data) == 137602131
        print(
            json.dumps(
                {
                    "files": len(names),
                    "uncompressed_bytes": sum(i.file_size for i in archive.infolist()),
                    "data_files": len(data),
                    "data_bytes": sum(i.file_size for i in data),
                    "checksum_validation": "passed",
                    "credential_marker_scan": "passed",
                    "machine_path_scan": "passed",
                    "exclusion_scan": "passed",
                }
            )
        )


if __name__ == "__main__":
    main()
