"""Local HTTPS routing simulation, NOT a container/Traefik acceptance claim."""

import argparse
import functools
import http.server
import json
import os
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "coldwave-demo-v3/tests"))
from run_phase4a_browser_qa import IsolatedChrome, Phase4ABrowserQA, QAReport  # noqa: E402

ORIGIN = "https://sptc.geos.tamu.edu:19443"
PREFIX = "/trans-resilience"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == PREFIX:
            self.send_response(308)
            self.send_header("Location", PREFIX + "/")
            self.end_headers()
            return
        if not self.path.startswith(PREFIX + "/"):
            self.send_error(404)
            return
        if self.path.split("?", 1)[0] == PREFIX + "/js/deployment-config.js":
            content = (REPO / "docker/frontend/deployment-config.js").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        self.path = self.path[len(PREFIX) :]
        super().do_GET()

    def do_POST(self):
        if self.path != PREFIX + "/api/v1/assistant/query":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 65536:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        request = urllib.request.Request(
            "http://127.0.0.1:18080/api/v1/assistant/query",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            response = urllib.request.urlopen(request, timeout=80)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            self.send_response(response.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isolated-profile", required=True, type=Path)
    args = parser.parse_args()
    report = QAReport()
    with tempfile.TemporaryDirectory(prefix="sptc-k3s-tls-") as directory:
        tmp = Path(directory)
        # Disposable QA key only, outside the repositories/handoff; deleted on exit.
        subprocess.run(
            [
                "openssl",
                "req",
                "-config",
                os.devnull,
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(tmp / "key.pem"),
                "-out",
                str(tmp / "cert.pem"),
                "-days",
                "1",
                "-subj",
                "/CN=sptc.geos.tamu.edu",
            ],
            check=True,
            capture_output=True,
        )
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(tmp / "cert.pem", tmp / "key.pem")
        handler = functools.partial(Handler, directory=str(REPO / "coldwave-demo-v3"))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 19443), handler)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with IsolatedChrome(isolated_profile=args.isolated_profile) as chrome:
                qa = Phase4ABrowserQA(chrome, report, tmp)
                qa.page.command("Security.setIgnoreCertificateErrors", {"ignore": True})
                qa.page.command("Page.navigate", {"url": ORIGIN + PREFIX + "/"})
                qa.wait_js(
                    "typeof planningControlLayer !== 'undefined' && Boolean(planningControlLayer && workspaceController)",
                    "dual maps",
                    60,
                )
                report.check(
                    qa.evaluate(
                        "SPTCAssistant.runtime.effective_mode === 'backend-agent'"
                    ),
                    "server profile defaults AI on",
                )
                report.check(
                    not [
                        r for r in qa.all_requests() if "/api/" in r["request"]["url"]
                    ],
                    "no automatic API requests",
                )
                qa.select_section("1081")
                qa.wait_js("Boolean(curveChart)", "stored Q(t)", 30)
                for tier in ("tier1", "tier2", "potential"):
                    qa.set_tier(tier)
                    report.check(
                        qa.evaluate(
                            "Boolean(curveChart) && controlLayer.getLayers().length === 10029 && planningControlLayer.getLayers().length === 10029"
                        ),
                        tier + " and observed retained",
                    )
                qa.evaluate("map.panBy([20,10],{animate:false}); true")
                qa.wait_js(
                    "map.getCenter().equals(planningMap.getCenter(),1e-8)",
                    "map synchronization",
                )
                report.check(True, "map synchronization")
                for width, height in (
                    (1920, 1080),
                    (1440, 900),
                    (1366, 768),
                    (1024, 768),
                    (768, 900),
                    (390, 844),
                ):
                    qa.set_viewport(width, height)
                    report.check(
                        qa.evaluate(
                            "document.documentElement.scrollWidth <= innerWidth + 1"
                        ),
                        f"viewport {width}x{height} no overflow",
                    )
                qa.set_viewport(1440, 900)
                qa.ensure_assistant_open()
                before = qa.chat_assistant_count()
                qa.set_chat_input("What is Potential Resilience?")
                qa.click("#assistantSend")
                qa.wait_js(
                    f"!assistantChatController.getState().pending && document.querySelectorAll('[data-result-kind=ai-assisted]').length > {before}",
                    "same-origin real Assistant",
                    100,
                )
                requests = qa.all_requests()
                api = [r for r in requests if "/api/" in r["request"]["url"]]
                report.check(
                    len(api) == 1
                    and api[0]["request"]["url"]
                    == ORIGIN + PREFIX + "/api/v1/assistant/query",
                    "one same-origin API request",
                )
                payload = qa.response_payload(api[0]["requestId"])
                report.check(
                    payload["status"] == "completed"
                    and payload["tools_used"][0]["tool_name"]
                    == "explain_project_concept",
                    "real concept response completed",
                )
                forbidden = [
                    r
                    for r in requests
                    if any(
                        s in r["request"]["url"]
                        for s in (
                            "127.0.0.1",
                            "localhost",
                            ":11434",
                            "://ollama",
                            ".svc.",
                        )
                    )
                ]
                report.check(
                    not forbidden, "no browser localhost/model/internal-DNS traffic"
                )
                exceptions = qa.page.events_since(0, "Runtime.exceptionThrown")
                errors = [
                    e
                    for e in qa.page.events_since(0, "Log.entryAdded")
                    if e["params"]["entry"].get("level") == "error"
                ]
                report.check(not exceptions and not errors, "no browser console errors")
                bad_http = [
                    e
                    for e in qa.page.events_since(0, "Network.responseReceived")
                    if e["params"]["response"]["status"] >= 400
                ]
                report.check(not bad_http, "no HTTP failures")
                print(
                    json.dumps(
                        {
                            "simulation_only": True,
                            "checks": len(report.checks),
                            "viewports": 6,
                            "assistant_requests": len(api),
                            "automatic_assistant_requests": 0,
                            "localhost_browser_requests": 0,
                            "ollama_browser_requests": 0,
                            "internal_dns_browser_requests": 0,
                            "console_errors": 0,
                        }
                    )
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # If certificate setup fails before entering the browser context, still
        # close only the explicitly supplied owned profile through its CDP endpoint.
        profile_index = sys.argv.index("--isolated-profile") + 1
        profile = Path(sys.argv[profile_index])
        if profile.exists():
            with IsolatedChrome(isolated_profile=profile):
                pass
        raise
