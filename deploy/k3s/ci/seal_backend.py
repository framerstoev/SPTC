"""Seal the reviewed backend build context and register its key as an Actions Secret."""

import argparse
import base64
import hashlib
import io
import json
import secrets
import subprocess
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from nacl.public import PublicKey, SealedBox

from github_api import REPOSITORY, api, credential

BACKEND_HEAD = "8298059555625fcb5ee3cf81d41fa631a0d70391"
SECRET_NAME = "V3_BACKEND_CONTEXT_KEY_829805955562"
AAD = b"SPTC-v3-backend-context-v1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", type=Path, required=True)
    parser.add_argument("--draft", type=Path, required=True)
    args = parser.parse_args()
    actual = subprocess.check_output(
        ["git", "-C", str(args.backend), "rev-parse", "HEAD"], text=True
    ).strip()
    if (
        actual != BACKEND_HEAD
        or subprocess.check_output(
            ["git", "-C", str(args.backend), "status", "--porcelain"], text=True
        ).strip()
    ):
        raise ValueError("backend deployment checkpoint must be exact and clean")
    draft = args.draft / "docker/backend"
    output = Path(__file__).with_name("backend-context.aesgcm")
    metadata_file = Path(__file__).with_name("backend-context.json")
    if output.exists() or metadata_file.exists():
        raise ValueError("refusing to overwrite a prepared context")
    token = credential()
    prefix = f"repos/{REPOSITORY}/actions/secrets/"
    if api(prefix + SECRET_NAME, token=token, missing_ok=True) is not None:
        raise ValueError("secret already exists; inspect rather than overwrite")
    files = sorted(p for p in draft.rglob("*") if p.is_file())
    checksums = {}
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            name = file.relative_to(draft).as_posix()
            if name.startswith("src/"):
                authoritative = args.backend / name
            elif name.startswith("snapshot/"):
                authoritative = args.backend / ".local" / name
            else:
                authoritative = args.backend / "docker" / name
            data = file.read_bytes()
            if data != authoritative.read_bytes():
                raise ValueError("draft context differs from accepted backend files")
            checksums[name] = hashlib.sha256(data).hexdigest()
            archive.writestr(name, data)
    key, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
    ciphertext = nonce + AESGCM(key).encrypt(nonce, content.getvalue(), AAD)
    public = api(prefix + "public-key", token=token)
    sealed = SealedBox(PublicKey(base64.b64decode(public["key"]))).encrypt(
        base64.b64encode(key)
    )
    api(
        prefix + SECRET_NAME,
        method="PUT",
        token=token,
        body={
            "key_id": public["key_id"],
            "encrypted_value": base64.b64encode(sealed).decode(),
        },
    )
    output.write_bytes(ciphertext)
    metadata = {
        "backend_deployment_commit": BACKEND_HEAD,
        "backend_accepted_commit": "e6b0ad5600e1d0056cd927ba9034bda6243b6030",
        "accepted_tag": "phase4c1-plain-language-ai-accepted",
        "secret_name": SECRET_NAME,
        "ciphertext_sha256": hashlib.sha256(ciphertext).hexdigest(),
        "context_zip_sha256": hashlib.sha256(content.getvalue()).hexdigest(),
        "files": checksums,
    }
    metadata_file.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "secret_registered": SECRET_NAME,
                "encrypted_bytes": len(ciphertext),
                "files": len(checksums),
                "plaintext_publication": False,
            }
        )
    )


if __name__ == "__main__":
    main()
