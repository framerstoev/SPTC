# GitHub-hosted V3 container publication preparation

Status: prepared locally; backend build-context transfer is awaiting explicit
approval of the specific mechanism below. No CI secret/context upload or image
publication has occurred in this resumed preparation step.

## Proposed data boundary

The existing frontend repository `framerstoev/SPTC` is public. The backend has no
remote repository. Its verified Docker context includes source code and six derived
snapshot/manifest/schema files (41,216,208 snapshot bytes), but no raw NPMRDS,
credentials, virtual environment or model blobs.

`seal_backend.py` proposes encrypting that exact verified build context using
AES-256-GCM before committing ciphertext to the dedicated deployment branch.
The random key would be held only in repository Actions Secret
`V3_BACKEND_CONTEXT_KEY_829805955562`, sealed using GitHub's repository public key.
Trusted repository workflows/administrators could access this key and decrypted
context. The GitHub-hosted Linux runner would decrypt it only for building the
backend image. No plaintext context would be uploaded as a workflow artifact.
The normal administrator handoff retains scoped plaintext sources as previously
authorized; this CI transfer is a separate boundary requiring the pending approval.

The execution safety review rejected the attempted combined preparation/secret
registration command before execution. Do not work around this gate by putting
plaintext backend snapshots in the public repository, exposing a local HTTP server,
embedding credentials in URLs, or silently switching transfer destinations.

## Workflow design

`.github/workflows/v3-containers.yml` uses pinned official GitHub/Docker Actions,
GitHub-hosted Ubuntu Linux and Buildx, and contents:read / packages:write. Package
authentication uses repository GITHUB_TOKEN, not a new PAT. It preserves the
accepted frontend container input commit `a8be52a88ec997ce7bf019555669963a477b580a`
and backend input commit `8298059555625fcb5ee3cf81d41fa631a0d70391`, recording the
separate workflow-source commit in the resulting release record.

Both images build and pass read-only-root container/data checks before either
publishes. A runner without the model must remain AI NOT_READY; there is no CPU
fallback, GPU emulation or model download. Existing real-model tests remain the
prior accepted evidence, not a claim that GitHub-hosted CPU runners tested Qwen.

Version tags are v3-phase4c1 and git-<container-source-shortsha>. Existing release
tags cause a stop rather than an overwrite. Published images are pulled by their
actual digest, their OS/architecture checked, both tags compared, and package
visibility queried without changing it. Only sanitized image metadata is uploaded
as an Actions artifact; not source, prompts, evidence, credentials or model output.

The workflow preserves workflow_dispatch. Because it is not on main, a restricted
bootstrap trigger watches only an explicit `publication-request.json` change on
`feature/v3-k3s-deployment`. That request file is deliberately not created yet.
No main merge, Pages change, K3s command or ordinary feature-push publication occurs.

After approval: register the scoped context secret, create the verified encrypted
context/metadata, finish pre-push tests and explicit publication request, push only
the deployment branch, inspect the actual run and digest metadata, then generate
the final administrator bundle. Do not describe the current draft as final.

References: [GitHub Secrets API](https://docs.github.com/en/rest/actions/secrets),
[workflow dispatch requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[publishing images with GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
