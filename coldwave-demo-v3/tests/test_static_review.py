"""Focused publication transformation and fail-closed scan regressions."""

import unittest

from build_static_review import BACKEND, PRIVATE_PATH, REPO, SECRET, SOURCE, V3, git, static_app, static_html


class StaticReviewTests(unittest.TestCase):
    def test_source_checkpoint(self):
        self.assertEqual(git("rev-parse", "phase4c1-v3-plain-language-ai-accepted^{commit}").decode().strip(), SOURCE)

    def test_html_no_ai(self):
        html = static_html(git("show", f"{SOURCE}:{V3}/index.html"))
        for term in (b"assistantLauncher", b"assistantPanel", b"assistant-", b"rankingDialog", b"ranking-browser"):
            self.assertNotIn(term, html)

    def test_html_retains_workspace(self):
        html = static_html(git("show", f"{SOURCE}:{V3}/index.html"))
        for term in (b"planningMap", b"curveChart", b"csSearch", b"workspaceSplitter", b"togglePlanning", b"tierMetrics", b"./js/app.js", b"./css/style.css"):
            self.assertIn(term, html)

    def test_only_initialization_transformed(self):
        raw = git("show", f"{SOURCE}:{V3}/js/app.js")
        transformed = static_app(raw)
        old = b"setupFloatingAssistant();\nsetupAssistant();"
        before, after = raw.split(old)
        self.assertTrue(transformed.startswith(before))
        self.assertTrue(transformed.endswith(after))
        self.assertIn(b'window.SPTCV3Deployment.mode !== "static-review"', transformed)
        self.assertIsNone(BACKEND.search(transformed))

    def test_changed_markup_rejected(self):
        with self.assertRaises(AssertionError):
            static_html(b"<html>unreviewed</html>")

    def test_changed_initialization_rejected(self):
        with self.assertRaises(AssertionError):
            static_app(b"unreviewed")

    def test_private_paths(self):
        for path in (b"C:\\Users\\operator", b"E:/project", b"file://data"):
            self.assertIsNotNone(PRIVATE_PATH.search(path))
        self.assertIsNone(PRIVATE_PATH.search(b"https://example.org/relative/path"))

    def test_backend_scan(self):
        for value in (b"http://localhost:8080", b"http://127.0.0.1:8080", b"/api/v1/assistant/query", b"http://host:11434", b"ws://host"):
            self.assertIsNotNone(BACKEND.search(value))

    def test_secret_scan(self):
        self.assertIsNotNone(SECRET.search(b"-----BEGIN PRIVATE KEY"))
        self.assertIsNotNone(SECRET.search(b"ghp_" + b"a" * 36))

    def test_local_profile_unchanged(self):
        self.assertEqual((REPO / V3 / "js/deployment-config.js").read_bytes().replace(b"\r\n", b"\n"), git("show", f"{SOURCE}:{V3}/js/deployment-config.js"))

    def test_static_profile_closed(self):
        text = (REPO / V3 / "static-review/deployment-config.js").read_text()
        for part in ('mode: "static-review"', "assistantEnabled: false", "backendEnabled: false", "Object.freeze", "writable: false"):
            self.assertIn(part, text)
        self.assertNotIn("location", text)

    def test_v1_v2_unchanged(self):
        self.assertEqual(git("diff", "--name-only", SOURCE, "--", "coldwave-demo", "coldwave-demo-v2"), b"")


if __name__ == "__main__":
    unittest.main()
