# V3 Deployment Readiness

Phase 4A is a local integration checkpoint, not deployment approval. No hosting, DNS, TLS, CORS,
authentication, logging, rate-limit, service-management, model-service, or data-license decision
is made by this frontend change.

## Separation of services

The static frontend and the resilience-agent API are separate deployable units. Browser code must
call only the reviewed FastAPI surface. A model provider, if enabled, remains server-side and must
never be reachable through a browser-configured URL or frontend credential.

Future hosting must preserve distinct application paths: stable V1 at `/coldwave-demo/`, accepted
V2 at `/coldwave-demo-v2/`, and V3 at `/coldwave-demo-v3/`. V3 must not replace or rewrite either
accepted path without separate approval.

The deployment-owned file `../js/deployment-config.js` accepts one closed value:

- `local-loopback`: backend modes are valid only when the page itself is plain HTTP on exactly
  `127.0.0.1` or `localhost`; the API destination is fixed to `http://127.0.0.1:8080`.
- `same-origin`: backend modes are valid only on credential-free HTTPS; the API destination is the
  page origin.

Unknown keys, unknown target values, malformed mode parameters, URL-supplied backend/model/key/
host/port/provider/timeout overrides, userinfo, and invalid origin combinations fail closed to the
deterministic `local-template` mode. The normal UI contains no deployment or mode selector.

## Required production decisions

Before a remote pilot or production release, infrastructure and security owners must approve:

1. **Frontend hosting and HTTPS.** Select the static host, canonical HTTPS origin, cache policy,
   security headers, integrity/version policy for CDN dependencies, and rollback procedure.
2. **API routing.** Prefer a reverse proxy under the same HTTPS origin (for example `/api/v1/`)
   rather than exposing an arbitrary cross-origin backend. Preserve the existing bounded paths and
   response-size limits.
3. **CORS.** Same-origin hosting should not require broad CORS. If separation is unavoidable,
   allow only exact reviewed HTTPS origins and methods; never use wildcard origins with credentials.
4. **Authentication and authorization.** The current local prototype has no remote-user identity
   boundary. Define users, roles, session lifetime, CSRF posture, and tool-level authorization
   before internet or multi-user access.
5. **Rate limits and resource bounds.** Set per-user/IP request and concurrency limits, assistant
   timeouts, payload limits, queue limits, and model-capacity backpressure. Deterministic read-only
   endpoints and model-backed requests may require different limits.
6. **Logging and privacy.** Define retention, access, redaction, incident use, and opt-out policy.
   Do not log system prompts, model reasoning, raw/restricted files, credentials, full chat history,
   or unreviewed NPMRDS-derived records. Treat user questions and section selections as potentially
   sensitive operational data.
7. **Service lifecycle.** Use supervised processes, health/readiness probes, graceful shutdown,
   bounded restart behavior, dependency health checks, model warm-up policy, and rollback. Do not
   reuse the workstation-only V2 launcher as production orchestration.
8. **Secrets and model access.** Keep credentials server-side in an approved secret store. If the
   accepted local Qwen path remains, Ollama stays server-side and loopback-only. Restrict model
   connectivity to the backend network boundary and prevent direct browser or public access.
9. **Data serving and licensing.** Complete public-serving review for every snapshot and geometry
   field. Raw NPMRDS files and non-allowlisted processed fields must remain unavailable.
10. **Monitoring and audit.** Define availability, latency, rejection, warning-consistency, schema-
    failure, and rate-limit metrics without recording restricted content. Alert on contract drift
    and repeated rejected model output.
11. **GPU capacity.** If local Qwen remains the production model path, document and validate the
    supported NVIDIA driver, minimum free VRAM, model residency, concurrent-request capacity,
    CPU fallback policy, and behavior when GPU acceleration is unavailable.
12. **Firewall and ports.** Publish only the approved HTTPS entrypoint. Development ports `8001`
    and `8080` must not become public listeners, and Ollama port `11434` must never be exposed to
    browsers or the public network. Enforce this with bind addresses, host firewall rules, and an
    external reachability test.
13. **Product identity.** The final public application/project name, owner, support contact,
    accessibility statement, privacy notice, and institutional branding approval remain pending.

## Deployment gates

A deployment candidate should not proceed until all of the following are evidenced:

- the four-tier UI and deterministic calculations match the accepted local release;
- V1 and V2 URLs and assets remain available and byte-unchanged unless separately approved;
- HTTPS and the selected `same-origin` configuration pass an independent security review;
- OpenAPI and frontend contract tests agree on V3 request fields and structured result schemas;
- top-level `warnings[]` is the only public warning contract;
- restricted-field scans cover OpenAPI, JSON responses, frontend assets, logs, and error bodies;
- authentication, CORS, rate limits, logging, retention, service lifecycle, and rollback are tested;
- browsers never contact the model service and no key is present in static assets;
- desktop/mobile accessibility and failure-state browser acceptance pass; and
- data owners approve the public-serving and licensing boundary.

Until then, retain `local-loopback`, use the local URLs documented in the V3 README, and do not
push, deploy, or repoint the accepted V2 launcher as part of this phase.
