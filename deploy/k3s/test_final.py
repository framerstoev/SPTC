"""Offline final release checks, not live cluster acceptance."""

import json
import unittest
from pathlib import Path

from render import resources


class FinalReleaseTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parent
        self.images = json.loads((self.root / "published-images.json").read_text())
        self.config = json.loads((self.root / "config.example.json").read_text())
        self.config.update(
            frontend_image=self.images["frontend"]["reference"],
            backend_image=self.images["backend"]["reference"],
            ghcr_pull_secret_name="ghcr-pull",
        )

    def test_real_digest_records(self):
        for kind in ("frontend", "backend"):
            item = self.images[kind]
            self.assertRegex(
                item["reference"],
                rf"^ghcr.io/framerstoev/sptc-resilience-{kind}@sha256:[0-9a-f]{{64}}$",
            )
            self.assertEqual(item["platform"], "linux/amd64")
            self.assertEqual(item["workflow_result"], "success")
            self.assertEqual(len(item["tags"]), 2)

    def test_private_backend(self):
        self.assertEqual(self.images["backend"]["visibility"], "private")
        self.assertIn("SPTC-backend-private", self.images["backend"]["workflow_url"])

    def test_real_node_still_required(self):
        with self.assertRaises(ValueError):
            resources(self.config)

    def test_production_images_and_pull_secret(self):
        self.config["gpu_node_name"] = "fixture-worker3"
        items = resources(self.config)
        for number, kind in ((50, "backend"), (60, "frontend")):
            pod = items[f"{number}-{kind}-deployment.json"]["spec"]["template"]["spec"]
            self.assertEqual(
                pod["containers"][0]["image"], self.images[kind]["reference"]
            )
            self.assertEqual(pod["imagePullSecrets"], [{"name": "ghcr-pull"}])

    def test_no_public_ollama(self):
        items = resources(self.config, example=True)
        self.assertEqual(items["31-ollama-service.json"]["spec"]["type"], "ClusterIP")
        ingress = json.dumps(items["80-ingress.example.json"])
        self.assertNotIn("11434", ingress)
        self.assertNotIn("ollama", ingress)

    def test_no_fake_image_digest(self):
        self.config["gpu_node_name"] = "fixture-worker3"
        self.config["backend_image"] = "<BACKEND_IMAGE_DIGEST>"
        with self.assertRaises(ValueError):
            resources(self.config)


if __name__ == "__main__":
    unittest.main()
