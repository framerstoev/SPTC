# Phase 4D-K3s validation record

## Final image publication, 2026-09-11

- Backend private build run 34614916678: SUCCESS; byte-identical input checks,
  read-only container health/five representative sections and absent-model/GPU
  readiness rejection passed. Published linux/amd64 digest and PRIVATE visibility
  verified by workflow GITHUB_TOKEN.
- Frontend public build run 34615579172: SUCCESS; read-only container, nginx,
  /trans-resilience assets, actual digest pulls and version-tag identity passed.
  Platform linux/amd64; package visibility PUBLIC, unchanged by this task.
- Actual references are in published-images.json; no image placeholders remain
  in the final bundle's application deployments.
- CI configuration tests: 5 passed. Existing manifest invariants: 8 passed.
- Re-run local HTTPS browser simulation: 23 checks, 6 viewports passed;
  automatic Assistant requests 0, localhost/11434/internal DNS browser requests 0,
  console errors 0. This is simulation, not a cluster acceptance claim.
- Existing backend source remains exactly 8298059555625fcb5ee3cf81d41fa631a0d70391.
  No analytical source/data/frontend behavior was modified.
- No new PAT, model download, K3s deployment or Pages change. Actual A30 inference,
  node identity, TLS/proxy settings and NetworkPolicy enforcement remain Jinyu's
  rollout gates. A CPU runner is not evidence of GPU inference performance.

## Historical draft record (superseded status below)

Status: DRAFT / NOT HANDOFF-READY. No application image digest, image size or Linux
architecture result is claimed without an actual build. Workstation lacks
Docker/Podman/installed WSL. GitHub credential account verified as framerstoev;
available scopes are gist, repo, workflow, not write:packages. No Docker registry
login config exists. No cluster/SSH access, registry push or ready tag attempted.

## Completed local checks (2026-09-10 workstation session)

- Exact full-AI source/tag/branch verification in both repositories.
- Original frontend JS regressions: 122 tests (44 client, 21 actions, 23 chat,
  8 search, 7 tier/workspace, 19 analytical UI).
- New server/local profile tests: 34 assertions, zero initialization requests.
- Final backend full regression including the probe tests: 1,450 passed.
- Readiness probe tests: 7 passed; bad health, disabled Assistant, model digest
  mismatch, warm-up failure and incomplete GPU residency fail closed.
- Backend focused configuration/provider tests: 145 passed (part of full suite).
- Ruff lint/format and pip check passed. Existing Starlette httpx deprecation
  warning remains; dependencies were not migrated during deployment packaging.
- Existing real-release validator passed: accepted sources/snapshots, five
  representative statuses, comparison/filter/ranking/metric/report and restricted
  field/OpenAPI checks. No source or derived results were regenerated.
- K3s offline invariant suite: 8 tests; invalid placeholders rejected in actual
  rendering mode. Configurable namespace/storage, GPU, selectors, port references,
  backend readiness, policy selectors and routing are covered. This is NOT
  validation against the administrator's installed Kubernetes/Traefik schemas.
- Local GPU: RTX4060 Laptop, Code0, driver616.56, nvidia-smi healthy. Ollama0.32.1
  pre-existing loopback daemon retained. These are NOT A30 capacity measurements.
  After smoke, model size_vram=size=5,578,204,118 bytes (full GPU), nvidia-smi
  reported6,060MiB total GPU usage. Model disk blob size remains5,225,388,164 bytes.
- Accepted real V3 Qwen evaluator: 15/15; routing, contract, warnings, numerical
  grounding and safety gates passed. Warm-up10.062s; median3.876s/p95 4.929s.
- Additional requested real-model smoke: 6/6 HTTP200, exact reviewed tools:
  framework1.322s, road comparison2.926s, Dallas comparison3.352s, section ranking
  4.025s, county ranking2.909s, investment decline1.291s. No transcripts logged.
- Real Chrome **local HTTPS simulation**, not a container: 23 checks at six
  viewports. Server-mode defaults, dual maps, selected section, stored Q(t), planning
  switches, map synchronization, no overflow and real same-origin project-concept
  response passed. Automatic API calls0; intentional Assistant call1; browser
  localhost/Ollama/internal-DNS requests0; console errors0; HTTP errors0.
  Disposable self-signed certificate accepted only inside the owned QA browser;
  no claim about production TLS, nginx or Traefik validation. The first harness
  attempt encountered missing system OpenSSL config, then the harness was fixed to
  use a disposable empty config; owned resources were cleaned and rerun passed.

## Outstanding hard gates

1. Authorized Linux-capable container builder: actual application build, nginx
   config/container/read-only-root smoke, architecture, image size and security scan.
2. GHCR write:packages credentials (secure login, never paste token into chat),
   package visibility/access review, push and inspect actual immutable digests.
3. Containerized HTTPS routing/browser/full-AI smoke. Local simulation is evidence
   for profile behavior, not a substitute for this gate.
4. Regenerate final manifests/release/checksums after those results, then optionally
   create handoff-ready tags. Jinyu must separately validate real CRDs, GPU node,
   storage binding, CNI policy enforcement, ingress/proxy trust and cluster rollout.

Current checksums cover a clearly labeled draft build-source bundle. Do not pass it
off as completed deployment acceptance or publish an unverified application image.
