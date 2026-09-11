# Full-AI V3 K3s deployment handoff

## Final release (2026-09-11)

Both linux/amd64 images have now been built, smoke-tested and published by
GitHub Actions. `published-images.json` records real digests and successful runs.
Backend source/snapshots are in PRIVATE `framerstoev/SPTC-backend-private`, never
in this public repository. Backend GHCR is PRIVATE; frontend GHCR is PUBLIC.
Publishing used GITHUB_TOKEN, not a newly created PAT or encryption secret.

Use `FINAL_RUNBOOK.md` and the output of `finalize.py` for the current image-based
administrator handoff. Jinyu must supply the real Worker 3 node name, pull secret
and cluster-specific routing settings before rollout. No K3s rollout occurred.

The material below describes the retained historical draft/source-context path;
its unbuilt-image status, PAT publishing procedure and included-source statements
are superseded by this final release. Do not use `package.py` to replace the final
image-based bundle; it intentionally remains the legacy draft generator.

## Historical draft reference

This packages the accepted Phase 4C1 **full-AI** application, not the independent
GitHub Pages static review. No cluster access or deployment is performed by the
packaging scripts. Jinyu owns cluster deployment and the external reverse proxy.

**Current blocker:** this preparation workstation has no Docker/Podman engine or
installed WSL distribution. The application images have NOT been built, published,
architecture-inspected or container-smoke-tested. Do not apply the example resources
or label this draft an accepted deployment. No application digest is fabricated.
See `docs/VALIDATION.md` in the archive (or `VALIDATION.md` alongside this source).

## Provenance and boundaries

- Frontend source branch: `feature/v3-plain-language-ai`
- Frontend source tag: `phase4c1-v3-plain-language-ai-accepted`
- Frontend source commit: `345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b`
- Backend source branch: `feature/v3-plain-language-ai`
- Backend source tag: `phase4c1-plain-language-ai-accepted`
- Backend source commit: `e6b0ad5600e1d0056cd927ba9034bda6243b6030`
- Deployment-only branches in both repositories: `feature/v3-k3s-deployment`.
  Exact deployment commits and scoped source/data checksums are in `RELEASE.txt`
  and `FILE_MANIFEST.txt` generated at packaging time.

The archive contains the complete build contexts, including existing validated
summary/curve Parquet snapshots, not raw NPMRDS inputs. Data are copied, never
regenerated. Local full-AI configuration and V1/V2 files are unchanged. Assistant
tools, contracts, formulas, ranking, Q(t), Candidate B and warnings are unchanged.
Only explicit server addressing is added. Do not make the backend GHCR package
public without reviewing its embedded snapshot exposure; private pull is supported.
The prior frontend publication approval is not an invented third-party license grant.

## Public routing

Administrator-confirmed target: **https://sptc.geos.tamu.edu/trans-resilience**.
This is a target supplied by the administrator, NOT a claim of deployed success.

| Public route | Forwarding |
| --- | --- |
| `/trans-resilience` | frontend nginx returns relative 308 to trailing slash |
| `/trans-resilience/` and static assets | frontend port 8080, no prefix stripping |
| `/trans-resilience/api/v1/assistant/query` | strict rate/concurrency/body middleware, strip `/trans-resilience`, backend 8080 |
| `/trans-resilience/api/v1/…` | API middleware, strip `/trans-resilience`, accepted backend `/api/v1/…` |

Frontend image includes immutable `SPTCV3Deployment` with `mode=server`,
`backend_target=same-origin`, `base_path=/trans-resilience`. On HTTPS under this
prefix it defaults to the existing V3 backend-agent mode without a query string.
The browser knows only its own origin/public prefix. It never receives internal
Ollama settings. Query parameters cannot set a provider, host or API URL.
The local source deployment-config remains local-loopback. Static Pages is separate.
CDN Leaflet/Chart.js and OpenStreetMap tiles remain external runtime dependencies.

Do not publish backend `/docs`, `/openapi.json`, `/health` or Ollama through extra
routes. Backend `/health` is internal and only confirms validated data snapshots.
Container `0.0.0.0` bindings are internal pod interfaces, NOT host port exposure.
There are no hostPort, hostNetwork, NodePort or LoadBalancer declarations.

## Administrator variables

Copy `deploy/k3s/config.example.json` to an administrator-owned configuration file.
JSON Kubernetes resources are valid YAML and accepted by kubectl.

| Variable / JSON key | Default or required action |
| --- | --- |
| NAMESPACE / namespace | `sptc-trans-resilience` |
| PUBLIC_HOST / public_host | `sptc.geos.tamu.edu` |
| PUBLIC_BASE_PATH / public_base_path | `/trans-resilience`; locked to this image profile |
| STORAGE_CLASS / storage_class | `local-path` |
| GPU_NODE_NAME / gpu_node_name | REQUIRED actual Worker 3 Kubernetes hostname; never guessed |
| gpu_runtime_class_name | optional administrator-verified RuntimeClass (e.g. nvidia); empty uses cluster default |
| OLLAMA_MODEL | `qwen3:8b`, accepted name is locked |
| OLLAMA_PVC_SIZE / ollama_pvc_size | `20Gi` |
| FRONTEND_IMAGE / frontend_image | actual `ghcr.io/framerstoev/sptc-resilience-frontend@sha256:…` |
| BACKEND_IMAGE / backend_image | actual `ghcr.io/framerstoev/sptc-resilience-backend@sha256:…` |
| OLLAMA_IMAGE / ollama_image | official `0.32.1` Linux/amd64 manifest pinned in example config |
| GHCR_PULL_SECRET_NAME / ghcr_pull_secret_name | optional existing admin-owned secret; empty for public packages |
| traefik_entrypoint | `web` EXAMPLE, for existing external TLS termination; confirm with Jinyu |
| api_average / api_burst | 60 per minute / burst 10 EXAMPLE |
| assistant_average / assistant_burst | 6 per minute / burst 2 EXAMPLE |
| rate_period / trusted_proxy_depth | `1m` / `0`; MUST review proxy chain before public enablement |
| *_resources | editable CPU/memory starting requests/limits in config |

Short service DNS `http://ollama:11434` resolves in the configured namespace.
Backend uses existing `RESILIENCE_OLLAMA_BASE_URL` plus explicit
`RESILIENCE_DEPLOYMENT_MODE=k3s`; only this exact internal endpoint is accepted in
K3s mode. Local mode still accepts only its reviewed loopback endpoint. Redirects
and environment proxy inheritance remain disabled by the accepted provider.
No CORS expansion is needed: production API is same-origin.

## Build and registry procedure (Linux-capable Docker host required)

1. Verify `SHA256SUMS.txt` with `sha256sum -c SHA256SUMS.txt` from extracted root.
2. Review pinned Dockerfiles and requirements. Python `3.13.5-slim-bookworm`
   matches the accepted Python generation; nginx `1.28.0-alpine` and Ollama `0.32.1`
   are digest-pinned. Base digests were resolved from the official Docker registry.
   Pinning is reproducibility, NOT a vulnerability-free assertion. Run the
   institution's image scanner and review findings before production.
3. Use the versions in RELEASE.txt (suffixes are deployment source commits):

```bash
export FRONTEND_VERSION=v3-phase4c1-<frontend-deployment-shortsha>
export BACKEND_VERSION=v3-phase4c1-<backend-deployment-shortsha>
bash deploy/k3s/build-images.sh
```

Build contexts are `docker/frontend` and `docker/backend`; never build from the
whole research workspace. Dependencies are exact runtime pins; the local venv,
pandas/pyarrow build tools, raw inputs, credentials and model blobs are excluded.
Perform container tests below BEFORE publishing; do not reuse/overwrite an existing
release tag. If a package/tag exists, inspect its owner and digest first.

For GHCR, use a PAT **classic** with `write:packages` (and necessary organizational
SSO authorization) to publish; administrators pulling private images need
`read:packages` and package access. Never put tokens in commands, Git, image layers
or the archive. Interactive `docker login ghcr.io -u framerstoev` prompts for the
token without putting it into shell history. Use a credential helper; do not send
Docker config credentials with the handoff. Package visibility must be inspected,
not assumed.

```bash
docker login ghcr.io -u framerstoev
docker push ghcr.io/framerstoev/sptc-resilience-frontend:$FRONTEND_VERSION
docker push ghcr.io/framerstoev/sptc-resilience-backend:$BACKEND_VERSION
docker buildx imagetools inspect ghcr.io/framerstoev/sptc-resilience-frontend:$FRONTEND_VERSION
docker buildx imagetools inspect ghcr.io/framerstoev/sptc-resilience-backend:$BACKEND_VERSION
```

Record actual digests, Linux/amd64 manifests and byte sizes in RELEASE.txt and
IMAGE_MANIFEST.txt, update administrator config with digest references, then
regenerate file manifests/checksums/ZIP. The DRAFT package does not do this by guessing.
Backend has no Git remote; its scoped source is included for reproducibility.
No image tar files are necessary.

## Container smoke gates before handing off

Use an isolated Docker network, a new named Ollama volume, and a GPU-enabled Linux
host. Start the pinned official Ollama image with `--gpus all`, network alias
`ollama`, volume `/root/.ollama`; do NOT publish 11434. Bootstrap as below.
Start backend on the same network with `RESILIENCE_DEPLOYMENT_MODE=k3s`,
`RESILIENCE_OLLAMA_BASE_URL=http://ollama:11434`, Assistant enabled and model qwen3:8b.
Use read-only root, writable tmpfs `/tmp`, CPU-only resources. Run
`python readiness.py` inside the backend and verify READY. Run frontend with
read-only root and `/tmp` tmpfs; `nginx -t` must succeed. Verify `/healthz`, bare-path
308, index, GeoJSON and representative curve response.

For a real browser, place both behind a disposable **trusted HTTPS** same-origin
proxy reproducing the table above. HTTP is intentionally not accepted for server
Assistant mode. Test all maps/tier switches, selected CS_1081, Q(t), synchronization,
splitters and responsive layout; then framework, selected-road comparison, Dallas,
section ranking, county ranking, and unsupported-investment decline. Verify no
automatic Assistant query on page load and zero browser 11434/internal-DNS/localhost
requests. Do not count a mocked or local-only test as container acceptance.
Remove only the explicitly created smoke containers/network; preserve model volume
unless explicitly authorized to delete it. No production/cluster deletion commands.

## Storage and GPU

Existing qwen3:8b local manifest/blob sizes total **5,225,388,164 bytes** (about
4.87 GiB disk), separately measured from VRAM. Accepted model manifest digest:
`500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`.
20 GiB PVC allows roughly four times blob size for download/update headroom; actual
filesystem consumption and free node disk must be verified. Other models are not
authorized. Mutable `qwen3:8b` tag drift is detected by the readiness digest check:
if a new upstream pull differs, STOP for release review; don't weaken the check.

`local-path` is node-local, not replicated. Ollama is pinned to the actual Worker 3
hostname, with Linux/amd64 and exactly `nvidia.com/gpu: 1`. PVC binding must match
that node; inspect StorageClass binding mode (`WaitForFirstConsumer` preferred)
before use. If node changes, plan backup/restore or explicit re-pull; don't assume
the volume follows it. Do not delete PVCs as a routine rollback.

A30 24 GB readiness is administrator-provided infrastructure information, not a
capacity benchmark. CPU/memory requests are initial examples: frontend 100m/128Mi,
backend 500m/512Mi, Ollama 1 CPU/8Gi; limits are in config. One replica each,
Ollama NUM_PARALLEL=1, MAX_LOADED_MODELS=1, MAX_QUEUE=2. No autoscaling.
If the installed K3s NVIDIA integration requires a RuntimeClass, set the optional
`gpu_runtime_class_name` to its actual name. Do not create or assume one.

## Administrator deployment sequence (Jinyu runs; not executed here)

1. Record current placeholder Service/Ingress and their exact rollback manifests;
   preserve external proxy configuration. Verify actual Traefik version/CRDs,
   entrypoint, TLS termination and forwarded headers. The example uses
   `traefik.io/v1alpha1`; adapt to installed APIs rather than installing competing CRDs.
2. Inspect nodes and storage:

```bash
kubectl get nodes -o wide
kubectl get node "$GPU_NODE_NAME" -o jsonpath='{.status.allocatable.nvidia\.com/gpu}'
kubectl get storageclass "$STORAGE_CLASS" -o yaml
```

3. Fill all required config placeholders. Render locally; absence of actual image
   digests/node name fails closed. No script invokes kubectl:

```bash
python deploy/k3s/test_render.py
python deploy/k3s/render.py --config admin-config.json --output rendered
kubectl apply --dry-run=server -f rendered/00-namespace.json
kubectl apply -f rendered/00-namespace.json
```

4. If private GHCR, create the administrator-managed imagePullSecret using your
   secure process; only its name belongs in config. Validate other resources with
   `kubectl apply --dry-run=server -f rendered` AFTER verifying installed CRDs.
   Do not bulk-apply the example Ingress before model and policy checks.
5. Apply PVC, Ollama Deployment and Service (20/30/31 files); wait for daemon
   readiness. Do not wait for a model-ready backend before bootstrapping the model.
6. Bootstrap once, explicitly, inside the Ollama pod (not on every restart):

```bash
kubectl -n "$NAMESPACE" exec deployment/ollama -- ollama list
kubectl -n "$NAMESPACE" exec deployment/ollama -- ollama pull qwen3:8b
```

   Skip pull if the accepted model already exists. Readiness checks its digest.
   Bootstrap using exec avoids permitting a second network client through the
   backend-only policy. Subsequent model use/warm-up occurs via backend.
7. Verify NetworkPolicy enforcement BEFORE exposing public routing. Apply file40;
   a non-backend test pod in the same namespace and a pod in another namespace
   must fail to reach Ollama, while backend succeeds. Verify cluster CNI actually
   enforces this policy. **Enforcement is unverified in this package.** ClusterIP
   alone is not authorization against cluster peers; policy is additive, so audit
   other policies that could grant broader access. Do not silently skip this gate.
8. Apply ConfigMap, backend Deployment/Service. Initial `/health` checks snapshot
   integrity, not model readiness. Every 90 seconds the separate readiness probe
   sends the exact accepted non-project `SPTC_READY` warm-up and validates response,
   model digest and full GPU residency. Failure removes backend endpoints. There
   is no model-dependent liveness restart loop. During later outages an in-flight
   request can still fail safely; probes are not per-request guarantees.
9. Confirm backend Ready, then run `ollama ps` and `nvidia-smi` in the Ollama pod;
   require full GPU residency, no CPU fallback. Readiness probe prevents declaring
   the backend ready if GPU residency is not verified. A loaded-but-idle model is
   kept warm by periodic probes. Measure their overhead under real workload.
10. Apply frontend Deployment/Service, verify its lightweight `/healthz` probe.
11. Review and apply middleware files70. Adapt the existing placeholder Ingress
    to these services or apply reviewed file80; do NOT delete administrator routes.
    The example assumes external TLS termination to Traefik `web`. If Traefik
    terminates TLS instead, Jinyu must configure the approved TLS entrypoint/secret.
12. Verify trusted external proxy addresses at the Traefik entrypoint. Depth0
    buckets by immediate peer (all users may share a bucket behind the proxy).
    Choose depth/excludedIPs only after proving proxy hop semantics; blindly
    trusting client-supplied X-Forwarded-For enables rate-limit bypass.
    Example API60/min, Assistant6/min, bursts10/2 and Assistant in-flight1 are
    adjustable starting values, not a capacity promise or final access policy.
    Review external proxy/backend timeouts: Assistant budget75s, browser80s;
    infrastructure forwarding timeout must exceed the bounded workflow budget.
13. Execute internal and public smoke matrix described above. Do not expose AI
    until model/GPU, policy and rate limiting have all been verified.

## Privacy and logging

nginx access logs are disabled; backend Uvicorn access logs are disabled. The
application's validated response/tool safety code remains unchanged. Probes print
only READY/NOT_READY, never raw provider output. Do not enable body logging in
Traefik, external proxy or Ollama; redact/disable query-string logs. Do not capture
prompts, history, evidence, answers or model reasoning in operational logs.
Check institutional stdout/stderr retention; providers may log operational model
load/resource metadata. No API keys are introduced. No service-account token is
mounted in these pods. Ollama remains ClusterIP, with no public route.

## Rollback

Keep the previous routing manifests/digests before change. If application or model
readiness fails, restore the **saved administrator-owned placeholder Ingress or
previous service targets**, avoiding a second competing route. Restore previous
application image digests/config and `kubectl rollout status` them if applicable.
Do not alter the external reverse proxy or delete unrelated resources. Scale only
this application's workloads down if Jinyu decides to suspend the release; retain
the model PVC and existing secrets. `rollout undo` alone may not restore ConfigMap
changes, so keep versioned deployment/config bundles together. Do not treat a
readiness failure as a reason to disable model safety checks or serve CPU inference.

## Sources used for deployment mechanics

- [Ollama Docker](https://docs.ollama.com/docker) and [FAQ](https://docs.ollama.com/faq)
- [GHCR authentication and digests](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Traefik rate limit/IP strategy](https://doc.traefik.io/traefik/v3.4/middlewares/http/ratelimit/)
- [Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

No live SPTC cluster state or policy enforcement was inspected. The deployment URL
is not claimed working. Only after actual image builds, manifests, full container
smoke and final regenerated checksums pass may this draft become a handoff-ready release.
