# Independent frontend and private backend image builds

The public framerstoev/SPTC workflow builds only approved frontend assets.
Backend source and snapshots belong exclusively to PRIVATE framerstoev/SPTC-backend-private.
No encrypted backend context or decryption secret is used in the public repository.

Both workflows use pinned official actions, hosted Ubuntu runners, linux/amd64,
GITHUB_TOKEN and contents:read/packages:write. Read-only container smoke precedes
publication. The private backend checks input checksums and fails GPU readiness
closed without Ollama. Hosted CPU runners do not validate A30 inference.

Frontend input: a8be52a88ec997ce7bf019555669963a477b580a.
Backend input: 8298059555625fcb5ee3cf81d41fa631a0d70391.
Tags: v3-phase4c1 and git-<input short SHA>; existing release tags must not be overwritten.

The frontend workflow uses manual dispatch or an explicit publication-request.json
on feature/v3-k3s-deployment only. The private backend uses manual dispatch on main.
Neither changes Pages or deploys Kubernetes. Only image metadata is uploaded as
an Actions handoff artifact. Backend GHCR must remain PRIVATE; Jinyu supplies a
read-capable imagePullSecret. Frontend visibility is recorded without changes.
No credentials belong in manifests or the administrator archive.
