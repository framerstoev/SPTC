# Administrator rollout and rollback

This is an image-based handoff, NOT a claim that the cluster or public endpoint
has been deployed or validated. Jinyu performs all cluster commands. Do not apply
the supplied manifests before completing the administrator settings below.

## Before rollout

1. Verify archive SHA-256 and `sha256sum -c SHA256SUMS.txt` after extraction.
2. Read IMAGE_MANIFEST.txt. Both application images are pinned by actual GHCR
   digest. The backend package is PRIVATE. Use the same pull secret for both
   images if the frontend package is also private.
3. Configure a namespace-local Kubernetes `kubernetes.io/dockerconfigjson`
   imagePullSecret named `ghcr-pull`, or change `ghcr_pull_secret_name` to your
   existing secret's name. Use your institution's secure credential provisioning
   process with package read access. No token is supplied. Do not paste tokens
   into this archive, Git, shell history, tickets, or manifests. CI publishing
   used GITHUB_TOKEN; it did not create a PAT. Cluster pull credentials are a
   separate administrator responsibility.
4. In `config/admin-config.json`, replace `gpu_node_name` with the actual Worker 3
   Kubernetes node name. Do not guess it from the human-readable Worker 3 label.
   The supplied manifests deliberately retain the required-node marker so they
   cannot accidentally schedule on another GPU. Regenerate them before applying:

```bash
python deploy/k3s/render.py --config config/admin-config.json --output rendered
python deploy/k3s/test_render.py
```

5. Confirm NVIDIA A30 availability, Linux/amd64, `nvidia.com/gpu: 1`, device-plugin
   health, and optional GPU RuntimeClass. Set `gpu_runtime_class_name` only to a
   verified installed RuntimeClass. No CPU inference fallback is accepted.
6. Confirm `local-path` StorageClass, node-local storage behavior, adequate disk,
   and volume binding on Worker 3. The 20Gi Ollama PVC persists `/root/.ollama`.
   The model requires about 4.87GiB disk; VRAM is a separate measurement. Node
   migration requires a planned model-volume migration or approved re-pull.
7. Confirm Traefik CRDs (`traefik.io/v1alpha1`), entrypoint and external TLS
   termination. The supplied `web` entrypoint assumes the existing external HTTPS
   proxy. If Traefik terminates TLS, adapt the entrypoint/TLS configuration using
   the administrator's existing certificate setup. Preserve existing routes.
8. Review rate limits: API 60/minute burst10; Assistant 6/minute burst2 and one
   in-flight request. These are starting settings, not a performance promise.
   Verify the trusted proxy chain before changing IP strategy/depth. Do not trust
   arbitrary client X-Forwarded-For headers. Proxy timeouts must accommodate the
   bounded Assistant workflow (backend75s/browser80s).
9. Run the institution's container vulnerability review. Digest pinning provides
   reproducibility, not a security-scan certification. Inspect cluster APIs with
   server-side dry-run before applying resources.

## Rollout order

Save current administrator-owned routing/configuration for rollback first.
Create namespace `sptc-trans-resilience` and the pull secret using the approved
secure process. Apply PVC, Ollama Deployment/ClusterIP Service, and NetworkPolicy.
Ollama must remain internal-only: no NodePort, public ingress, hostPort, hostNetwork
or published port11434. Verify CNI enforcement; a non-backend pod must not reach
Ollama while the backend can. ClusterIP alone is not access control.

Bootstrap `qwen3:8b` inside the Ollama pod only if absent. The archive contains no
model blobs. Do not change model or blindly accept tag drift. Accepted model digest:

`500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`

Apply backend ConfigMap/Deployment/Service. The exact backend-only provider URL is
`http://ollama:11434`, with `RESILIENCE_DEPLOYMENT_MODE=k3s`. Assistant remains
enabled; browser code receives no provider address. Data `/health` is not model
readiness. The accepted readiness probe checks model identity, warm-up and full
GPU residency, reporting only READY/NOT_READY. Do not disable it to bypass failure.
Verify `ollama ps` and `nvidia-smi` in the GPU workload before public exposure.

Apply frontend Deployment/Service and check `/healthz`. Review middleware and
Ingress last. The public route is `https://sptc.geos.tamu.edu/trans-resilience`:
static frontend keeps the prefix, API routing strips `/trans-resilience` and
forwards existing `/api/v1/*` to FastAPI. Backend `/docs`, `/openapi.json`, `/health`
and Ollama are not public routes. Backend access is same-origin, not localhost.

## Cluster acceptance (administrator must execute)

- Confirm all images match IMAGE_MANIFEST.txt and pods are Ready.
- Verify persistence across an Ollama pod restart without deleting the PVC.
- Verify model digest and 100% GPU allocation; no CPU fallback.
- Verify framework explanation, selected-road comparison, Dallas benchmarking,
  section ranking, county ranking, and unsupported-investment decline.
- Verify maps, section selection, Q(t), synchronized panels and six screen sizes.
- Verify zero automatic Assistant requests on page load and zero browser traffic
  to localhost, port11434 or internal service DNS.
- Verify rate limiting and NetworkPolicy enforcement before public AI exposure.
- Keep prompt/history/evidence/answer logging disabled across proxies and provider.

GitHub-hosted CPU container smoke does not substitute for these A30/K3s gates.

## Rollback

Restore saved administrator-owned routes/service targets and previous application
image digests/config as a unit. Do not delete unrelated ingress, namespace resources,
pull secrets or the persistent model PVC. Readiness failure is not permission to
disable GPU/model checks. Suspend only this application's workloads if necessary.
Keep the last known-good release archive and config; rollout undo alone does not
restore changed ConfigMaps or proxy rules.

## Reproduction

Frontend builds from public `framerstoev/SPTC`, deployment branch recorded in
RELEASE.txt. Backend builds only from PRIVATE `framerstoev/SPTC-backend-private`.
Authorized maintainers can access its exact recorded commit and SOURCE_MANIFEST.
Dockerfiles are provided here as reproducibility references, not a second source
distribution. This lean handoff omits runtime datasets/source already inside the
published images. Never copy private backend assets into the public repository.
