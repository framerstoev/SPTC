"""Read-only CI configuration gates; no cloud writes or sensitive context access."""

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / ".github/workflows/v3-containers.yml").read_text()
        self.flow = yaml.load(self.text, Loader=yaml.BaseLoader)

    def test_trigger_is_scoped(self):
        self.assertEqual(set(self.flow["on"]), {"workflow_dispatch", "push"})
        self.assertEqual(
            self.flow["on"]["push"]["branches"], ["feature/v3-k3s-deployment"]
        )
        self.assertEqual(
            self.flow["on"]["push"]["paths"], ["deploy/k3s/ci/publication-request.json"]
        )

    def test_least_privilege(self):
        self.assertEqual(
            self.flow["permissions"], {"contents": "read", "packages": "write"}
        )
        self.assertNotIn("deploy-pages", self.text)
        self.assertNotIn("kubectl", self.text)
        self.assertNotIn("PAT", self.text)

    def test_pinned_official_actions(self):
        for step in self.flow["jobs"]["publish"]["steps"]:
            if "uses" in step:
                self.assertRegex(
                    step["uses"], r"^(actions|docker)/[a-z-]+@[a-f0-9]{40}$"
                )

    def test_build_platform_and_smoke_order(self):
        steps = self.flow["jobs"]["publish"]["steps"]
        names = [step.get("name", "") for step in steps]
        for step in steps:
            if step.get("uses", "").startswith("docker/build-push-action"):
                self.assertEqual(step["with"]["platforms"], "linux/amd64")
        smoke = names.index("Read-only root container smoke and GPU absence safety")
        self.assertLess(smoke, names.index("Publish frontend"))
        self.assertLess(smoke, names.index("Publish backend"))

    def test_only_metadata_artifact(self):
        artifact = next(
            step
            for step in self.flow["jobs"]["publish"]["steps"]
            if step.get("uses", "").startswith("actions/upload-artifact")
        )
        self.assertEqual(artifact["with"]["path"], "ci-results/published-images.json")


if __name__ == "__main__":
    unittest.main()
