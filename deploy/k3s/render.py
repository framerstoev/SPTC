"""Render reviewable Kubernetes JSON (also valid YAML); never contacts a cluster."""

import argparse
import json
import re
from pathlib import Path


def validate(c, *, example=False):
    baseline = json.loads(Path(__file__).with_name("config.example.json").read_text())
    if set(c) != set(baseline):
        raise ValueError("configuration keys must match config.example.json")
    for key in ("namespace", "storage_class", "traefik_entrypoint"):
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]|[a-z0-9]", c[key]):
            raise ValueError(f"invalid {key}")
    if c["public_base_path"] != "/trans-resilience":
        raise ValueError("base path must match the reviewed image profile")
    if not re.fullmatch(r"[a-z0-9.-]+", c["public_host"]):
        raise ValueError("invalid host")
    if not re.fullmatch(r"[1-9][0-9]*Gi", c["ollama_pvc_size"]):
        raise ValueError("PVC size must be positive Gi")
    if c["ghcr_pull_secret_name"] and not re.fullmatch(
        r"[a-z0-9][a-z0-9.-]*", c["ghcr_pull_secret_name"]
    ):
        raise ValueError("invalid image pull secret name")
    for key in ("api_average", "api_burst", "assistant_average", "assistant_burst"):
        if type(c[key]) is not int or not 1 <= c[key] <= 10000:
            raise ValueError(f"invalid {key}")
    if (
        type(c["trusted_proxy_depth"]) is not int
        or not 0 <= c["trusted_proxy_depth"] <= 10
    ):
        raise ValueError("invalid proxy depth")
    if not re.fullmatch(r"[1-9][0-9]*[smh]", c["rate_period"]):
        raise ValueError("invalid rate period")
    if c["gpu_runtime_class_name"] and not re.fullmatch(
        r"[a-z0-9][a-z0-9.-]*", c["gpu_runtime_class_name"]
    ):
        raise ValueError("invalid GPU runtime class name")
    for kind in ("requests", "limits"):
        gpu = c["ollama_resources"][kind].get("nvidia.com/gpu")
        if type(gpu) is not int or gpu != 1:
            raise ValueError("exactly one GPU is required")
        for key in ("frontend_resources", "backend_resources"):
            if "nvidia.com/gpu" in c[key][kind]:
                raise ValueError("application containers must be CPU-only")
    if not example:
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", c["gpu_node_name"]):
            raise ValueError("set the actual Worker 3 node name")
        for key, package in (
            ("frontend_image", "frontend"),
            ("backend_image", "backend"),
        ):
            if not re.fullmatch(
                rf"ghcr.io/framerstoev/sptc-resilience-{package}@sha256:[0-9a-f]{{64}}",
                c[key],
            ):
                raise ValueError(f"set actual built/verified {key} digest")
    if not re.fullmatch(
        r"ollama/ollama:0\.32\.1@sha256:[0-9a-f]{64}", c["ollama_image"]
    ):
        raise ValueError("Ollama must remain pinned to the reviewed provider version")


def resources(c, *, example=False):
    validate(c, example=example)
    ns = c["namespace"]

    def obj(api, kind, name, **kwargs):
        return {
            "apiVersion": api,
            "kind": kind,
            "metadata": {"name": name, "namespace": ns},
            **kwargs,
        }

    def labels(name):
        return {
            "app.kubernetes.io/name": name,
            "app.kubernetes.io/part-of": "sptc-trans-resilience",
        }

    result = {
        "00-namespace.json": {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {"name": ns},
        }
    }
    result["10-configmap.json"] = obj(
        "v1",
        "ConfigMap",
        "backend-config",
        data={
            "RESILIENCE_DEPLOYMENT_MODE": "k3s",
            "RESILIENCE_OLLAMA_BASE_URL": "http://ollama:11434",
            "RESILIENCE_ASSISTANT_ENABLED": "true",
            "RESILIENCE_MODEL_PROVIDER": "ollama",
            "RESILIENCE_OLLAMA_MODEL": "qwen3:8b",
            "RESILIENCE_CORS_ALLOWED_ORIGINS": "",
            "RESILIENCE_SNAPSHOT_DIR": "/opt/resilience-agent/snapshot",
        },
    )
    result["20-ollama-pvc.json"] = obj(
        "v1",
        "PersistentVolumeClaim",
        "ollama-models",
        spec={
            "accessModes": ["ReadWriteOnce"],
            "storageClassName": c["storage_class"],
            "resources": {"requests": {"storage": c["ollama_pvc_size"]}},
        },
    )
    for name, order in (("ollama", 30), ("backend", 50), ("frontend", 60)):
        port = 11434 if name == "ollama" else 8080
        container = {
            "name": name,
            "image": c[name + "_image"],
            "imagePullPolicy": "IfNotPresent",
            "ports": [{"name": "http", "containerPort": port}],
            "resources": c[name + "_resources"],
        }
        pod = {
            "automountServiceAccountToken": False,
            "containers": [container],
            "nodeSelector": {
                "kubernetes.io/os": "linux",
                "kubernetes.io/arch": "amd64",
            },
        }
        if c["ghcr_pull_secret_name"] and name != "ollama":
            pod["imagePullSecrets"] = [{"name": c["ghcr_pull_secret_name"]}]
        if name == "ollama":
            if c["gpu_runtime_class_name"]:
                pod["runtimeClassName"] = c["gpu_runtime_class_name"]
            pod["nodeSelector"]["kubernetes.io/hostname"] = c["gpu_node_name"]
            container["env"] = [
                {"name": key, "value": val}
                for key, val in {
                    "OLLAMA_HOST": "0.0.0.0:11434",
                    "OLLAMA_MODELS": "/root/.ollama/models",
                    "OLLAMA_NUM_PARALLEL": "1",
                    "OLLAMA_MAX_LOADED_MODELS": "1",
                    "OLLAMA_MAX_QUEUE": "2",
                    "OLLAMA_KEEP_ALIVE": "30m",
                    "OLLAMA_DEBUG": "false",
                }.items()
            ]
            container["volumeMounts"] = [
                {"name": "models", "mountPath": "/root/.ollama"}
            ]
            pod["volumes"] = [
                {
                    "name": "models",
                    "persistentVolumeClaim": {"claimName": "ollama-models"},
                }
            ]
            container["readinessProbe"] = {
                "httpGet": {"path": "/api/version", "port": "http"},
                "periodSeconds": 10,
            }
            container["startupProbe"] = {
                "httpGet": {"path": "/api/version", "port": "http"},
                "periodSeconds": 10,
                "failureThreshold": 60,
            }
            # No model-aware liveness: pull/cold start must never cause restart loops.
        else:
            uid = 101 if name == "frontend" else 10001
            container["securityContext"] = {
                "runAsNonRoot": True,
                "runAsUser": uid,
                "runAsGroup": uid,
                "readOnlyRootFilesystem": True,
                "allowPrivilegeEscalation": False,
                "capabilities": {"drop": ["ALL"]},
                "seccompProfile": {"type": "RuntimeDefault"},
            }
            pod["volumes"] = [{"name": "tmp", "emptyDir": {"sizeLimit": "256Mi"}}]
            container["volumeMounts"] = [{"name": "tmp", "mountPath": "/tmp"}]
            path = "/healthz" if name == "frontend" else "/health"
            container["startupProbe"] = {
                "httpGet": {"path": path, "port": "http"},
                "periodSeconds": 10,
                "failureThreshold": 60,
            }
            if name == "frontend":
                container["readinessProbe"] = {
                    "httpGet": {"path": path, "port": "http"},
                    "periodSeconds": 10,
                }
                container["livenessProbe"] = {
                    "httpGet": {"path": path, "port": "http"},
                    "periodSeconds": 30,
                }
            else:
                container["envFrom"] = [{"configMapRef": {"name": "backend-config"}}]
                container["readinessProbe"] = {
                    "exec": {"command": ["python", "readiness.py"]},
                    "periodSeconds": 90,
                    "timeoutSeconds": 85,
                    "failureThreshold": 1,
                }
        result[f"{order}-{name}-deployment.json"] = obj(
            "apps/v1",
            "Deployment",
            name,
            spec={
                "replicas": 1,
                "strategy": {"type": "Recreate"},
                "selector": {"matchLabels": labels(name)},
                "template": {"metadata": {"labels": labels(name)}, "spec": pod},
            },
        )
        result[f"{order + 1}-{name}-service.json"] = obj(
            "v1",
            "Service",
            name,
            spec={
                "type": "ClusterIP",
                "selector": labels(name),
                "ports": [{"name": "http", "port": port, "targetPort": "http"}],
            },
        )
    result["40-ollama-networkpolicy.json"] = obj(
        "networking.k8s.io/v1",
        "NetworkPolicy",
        "ollama-backend-only",
        spec={
            "podSelector": {"matchLabels": labels("ollama")},
            "policyTypes": ["Ingress"],
            "ingress": [
                {
                    "from": [{"podSelector": {"matchLabels": labels("backend")}}],
                    "ports": [{"protocol": "TCP", "port": 11434}],
                }
            ],
        },
    )
    middlewares = {
        "strip-app-prefix": {"stripPrefix": {"prefixes": [c["public_base_path"]]}},
        "bounded-body": {
            "buffering": {"maxRequestBodyBytes": 65536, "memRequestBodyBytes": 65536}
        },
        "assistant-concurrency": {"inFlightReq": {"amount": 1}},
    }
    for kind in ("api", "assistant"):
        middlewares[kind + "-rate"] = {
            "rateLimit": {
                "average": c[kind + "_average"],
                "burst": c[kind + "_burst"],
                "period": c["rate_period"],
                "sourceCriterion": {"ipStrategy": {"depth": c["trusted_proxy_depth"]}},
            }
        }
    for name, spec in middlewares.items():
        result["70-" + name + ".json"] = obj(
            "traefik.io/v1alpha1", "Middleware", name, spec=spec
        )
    base = c["public_base_path"]
    host = f"Host(`{c['public_host']}`)"

    def route(match, service, priority, middleware=()):
        return {
            "kind": "Rule",
            "match": host + " && (" + match + ")",
            "priority": priority,
            "services": [{"name": service, "port": 8080}],
            "middlewares": [{"name": m} for m in middleware],
        }

    result["80-ingress.example.json"] = obj(
        "traefik.io/v1alpha1",
        "IngressRoute",
        "trans-resilience",
        spec={
            "entryPoints": [c["traefik_entrypoint"]],
            "routes": [
                route(
                    f"Path(`{base}/api/v1/assistant/query`)",
                    "backend",
                    300,
                    (
                        "assistant-rate",
                        "assistant-concurrency",
                        "bounded-body",
                        "strip-app-prefix",
                    ),
                ),
                route(
                    f"PathPrefix(`{base}/api/v1/`)",
                    "backend",
                    200,
                    ("api-rate", "bounded-body", "strip-app-prefix"),
                ),
                route(f"Path(`{base}`) || PathPrefix(`{base}/`)", "frontend", 100),
            ],
        },
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", type=Path, default=Path(__file__).with_name("config.example.json")
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--example",
        action="store_true",
        help="NON-DEPLOYABLE placeholders for review only",
    )
    args = parser.parse_args()
    rendered = resources(json.loads(args.config.read_text()), example=args.example)
    args.output.mkdir(parents=True, exist_ok=False)
    for name, value in rendered.items():
        (args.output / name).write_text(
            json.dumps(value, indent=2) + "\n", encoding="utf-8"
        )
    print(
        f"Rendered {len(rendered)} resources; example={args.example}; no cluster contacted"
    )


if __name__ == "__main__":
    main()
