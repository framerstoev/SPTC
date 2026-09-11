"""Offline deployment invariants. Does not pretend to validate installed CRDs."""

import copy
import json
import unittest
from pathlib import Path

from render import resources, validate


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads(
            Path(__file__).with_name("config.example.json").read_text()
        )
        self.items = resources(self.config, example=True)

    def test_examples_fail_closed(self):
        with self.assertRaises(ValueError):
            resources(self.config)

    def test_explicit_admin_inputs(self):
        c = copy.deepcopy(self.config)
        c.update(
            gpu_node_name="fixture-worker",
            namespace="fixture-ns",
            storage_class="fixture-local",
        )
        for key, suffix in (
            ("frontend_image", "frontend"),
            ("backend_image", "backend"),
        ):
            c[key] = f"ghcr.io/framerstoev/sptc-resilience-{suffix}@sha256:" + "a" * 64
        result = resources(c)
        for item in result.values():
            if item["kind"] != "Namespace":
                self.assertEqual(item["metadata"]["namespace"], "fixture-ns")
        self.assertEqual(
            result["20-ollama-pvc.json"]["spec"]["storageClassName"], "fixture-local"
        )

    def test_services_and_selectors(self):
        for name, order in (("ollama", 30), ("backend", 50), ("frontend", 60)):
            deployment = self.items[f"{order}-{name}-deployment.json"]["spec"]
            service = self.items[f"{order + 1}-{name}-service.json"]["spec"]
            self.assertEqual(service["type"], "ClusterIP")
            self.assertEqual(
                service["selector"], deployment["template"]["metadata"]["labels"]
            )
            self.assertEqual(deployment["replicas"], 1)
            self.assertFalse(
                deployment["template"]["spec"]["automountServiceAccountToken"]
            )
            self.assertEqual(service["ports"][0]["targetPort"], "http")

    def test_gpu_persistence(self):
        pod = self.items["30-ollama-deployment.json"]["spec"]["template"]["spec"]
        self.assertIn("kubernetes.io/hostname", pod["nodeSelector"])
        self.assertEqual(
            pod["volumes"][0]["persistentVolumeClaim"]["claimName"], "ollama-models"
        )
        self.assertEqual(
            pod["containers"][0]["resources"]["limits"]["nvidia.com/gpu"], 1
        )
        self.assertNotIn("livenessProbe", pod["containers"][0])

    def test_model_readiness(self):
        container = self.items["50-backend-deployment.json"]["spec"]["template"][
            "spec"
        ]["containers"][0]
        self.assertEqual(
            container["readinessProbe"]["exec"]["command"], ["python", "readiness.py"]
        )
        self.assertNotIn("livenessProbe", container)
        self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])

    def test_ingress_does_not_expose_model(self):
        routes = self.items["80-ingress.example.json"]["spec"]["routes"]
        self.assertTrue(all(r["services"][0]["name"] != "ollama" for r in routes))
        self.assertEqual(routes[0]["priority"], 300)
        self.assertEqual(routes[0]["middlewares"][-1]["name"], "strip-app-prefix")
        self.assertEqual(routes[2]["middlewares"], [])

    def test_networkpolicy_is_namespace_local(self):
        policy = self.items["40-ollama-networkpolicy.json"]["spec"]
        source = policy["ingress"][0]["from"][0]
        self.assertEqual(list(source), ["podSelector"])
        self.assertEqual(
            source["podSelector"]["matchLabels"]["app.kubernetes.io/name"], "backend"
        )

    def test_invalid_config(self):
        for key, value in (
            ("gpu_node_name", "guess me"),
            ("namespace", "../bad"),
            ("public_base_path", "/"),
            ("api_average", 0),
            ("ollama_pvc_size", "0Gi"),
            ("trusted_proxy_depth", -1),
            ("frontend_image", "image:latest"),
        ):
            c = copy.deepcopy(self.config)
            c[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(c)


if __name__ == "__main__":
    unittest.main()
