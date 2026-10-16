"""Produce a code-only static distribution from an explicit file allowlist."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

HERE = Path(__file__).resolve().parents[1]


def build(destination: Path) -> None:
    if destination.exists():
        raise FileExistsError("Public output must be a new directory")
    if destination.resolve().is_relative_to(HERE.resolve()) and destination.name != ".public-build":
        raise ValueError("Use .public-build or a separate new distribution directory")
    files = [HERE / "index.html", HERE / "docs.html", *sorted((HERE / "css").glob("*.css")),
             *sorted((HERE / "js").glob("*.js")), *sorted(p for p in (HERE / "vendor").rglob("*") if p.is_file())]
    destination.mkdir(parents=True)
    for source in files:
        target = destination / source.relative_to(HERE)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (destination / "data").mkdir()
    policy = json.loads((HERE / "data/public-manifest.json").read_text())
    policy["public_only"] = True
    (destination / "data/public-manifest.json").write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
    (destination / ".nojekyll").touch()
    names = [str(p.relative_to(destination)).replace("\\", "/") for p in destination.rglob("*") if p.is_file()]
    if any(any(word in n for word in [".local-preview", "curves/", "sections.json", "summaries.json", ".csv", ".zip", ".env", "debug.log"]) for n in names):
        raise ValueError("Research artifact found in public bundle")
    for name in names:
        if name.endswith((".html", ".js", ".json", ".css")):
            text = (destination / name).read_text(encoding="utf-8")
            if re.search(r"\b[A-Za-z]:[\\/]|https?://(?:127\.0\.0\.1|localhost)(?::|/)", text):
                raise ValueError("Private path or loopback URL in public bundle")
    print(json.dumps({"status": "PUBLIC_CODE_ONLY_PASS", "files": len(names), "analytical_data_files": 0,
                      "public_only": True, "data_release": "PENDING_APPROVAL"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args().output)
