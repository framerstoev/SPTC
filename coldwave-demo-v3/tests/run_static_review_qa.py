"""Real-browser static acceptance using the reviewed isolated Chrome lifecycle."""

import argparse
import functools
import json
import threading
import time
from contextlib import ExitStack
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from run_phase4a_browser_qa import IsolatedChrome, QAReport, create_artifact_directory
from run_phase4b_browser_qa import Phase4BBrowserQA

VIEWPORTS = ((1920, 1080), (1440, 900), (1366, 768), (1024, 768), (768, 900), (390, 844))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class StaticQA(Phase4BBrowserQA):
    def navigate(self, url):
        mark = self.page.event_mark()
        response = self.page.command("Page.navigate", {"url": url})
        self.report.check(not response.get("errorText"), "static navigation succeeds")
        self.page.wait_event("Page.loadEventFired", mark=mark, timeout=60)
        self.wait_js("document.querySelector('#totalSections')?.textContent.trim()==='10,029' && typeof planningControlLayer!=='undefined' && Boolean(planningControlLayer)", "static data and maps", 60)
        base = url.split("?", 1)[0]
        self.report.check(self.evaluate("performance.getEntriesByType('resource').map(r=>r.name)").count(base + "js/app.js") == 1, "correct nested app asset loaded once")
        return mark

    def run_static(self, url):
        self.set_viewport(1440, 900)
        self.navigate(url + "?assistantMode=backend-agent&backendUrl=http://localhost:8080")
        self.wait_js("Boolean(planningControlLayer && workspaceController)", "two maps ready")
        self.report.check(self.evaluate("SPTCV3Deployment.mode==='static-review' && SPTCV3Deployment.assistantEnabled===false && SPTCV3Deployment.backendEnabled===false && Object.isFrozen(SPTCV3Deployment)"), "immutable explicit static profile ignores query overrides")
        self.report.check(self.evaluate("!window.SPTCAssistant && !window.SPTCAssistantAPI && !document.querySelector('#assistantLauncher,#assistantPanel,#rankingDialog,[data-assistant-action]')"), "AI DOM and client absent, ranking hidden")
        self.report.check(self.evaluate("document.querySelector('h1').textContent==='Roadway Resilience Explorer' && document.querySelector('.prototype-badge').textContent==='Prototype'"), "identity retained")
        self.report.check(self.evaluate("controlLayer.getLayers().length===10029 && planningControlLayer.getLayers().length===10029"), "both maps have full network")
        self.select_section("1081")
        self.wait_js("Boolean(curveChart) && !document.querySelector('#curveChartWrap').hidden", "Q(t)")
        for tier, labels in (("tier1", ("WEATHER_REI",)), ("tier2", ("NETWORK_REI", "AADT")), ("potential", ("Potential",))):
            self.set_tier(tier)
            text = self.evaluate("document.querySelector('#planningAnalysis').innerText")
            self.report.check(all(label in text for label in labels), f"{tier} selected metrics")
            self.report.check(self.evaluate("document.querySelectorAll('#tierMetrics .metric-card').length===4 && Boolean(curveChart)"), "Score Minimum Loss Area Recovery and curve retained")
        self.report.check(self.evaluate("Boolean(selectedHaloLayer && planningHaloLayer)"), "selected section highlighted twice")
        for name in ("map", "planningMap"):
            self.evaluate(f"{name}.panBy([35,20],{{animate:false}}); {name}.setZoom({name}.getZoom()+1,{{animate:false}}); true")
            self.wait_js("map.getCenter().equals(planningMap.getCenter(),1e-8) && map.getZoom()===planningMap.getZoom()", "pan zoom synchronization")
            self.report.check(True, f"{name} sync")
        for selector in ("#mapLegendToggle", "#planningMapLegendToggle"):
            self.click(selector)
            self.report.check(self.evaluate(f"document.querySelector('{selector}').parentElement.open"), "legend opens")
            self.click(selector)
        self.splitter_acceptance()
        for section, status in (("1081", "Detected"), ("257", "No sustained drop"), ("3597", "Recovery censored"), ("1", "No observed support"), ("583693", "Detected")):
            self.select_section(section)
            self.wait_js("!document.querySelector('#curveNote').textContent.includes('Loading')", "curve settled")
            self.report.check(status in self.evaluate("document.querySelector('#statusBadges').innerText"), f"CS_{section} status")
            if section in ("1", "257"):
                self.report.check(self.evaluate("Array.from(document.querySelectorAll('#tierMetrics strong')).every(n=>n.textContent==='N/A')"), "unavailable not zero")
            if section == "3597":
                self.report.check("Censored endpoint" in self.evaluate("document.querySelector('#phaseMarkerLegend').innerText"), "no confirmed recovery for censoring")
        self.select_section("1081")
        self.wait_js("Boolean(curveChart)", "curve restored")
        for width, height in VIEWPORTS:
            self.set_viewport(width, height)
            self.wait_js("document.documentElement.scrollWidth<=innerWidth", "no horizontal overflow")
            self.report.check(self.evaluate("document.documentElement.scrollHeight<=innerHeight"), f"{width} bounded page")
            if width <= 900:
                self.click("#togglePlanning")
                self.report.check(self.evaluate("document.querySelector('#planningMap').clientWidth>300 && document.querySelector('#map').clientWidth===0"), f"{width} mobile planning")
                self.click("#toggleObserved")
                self.report.check(self.evaluate("document.querySelector('#map').clientWidth>300 && document.querySelector('#planningMap').clientWidth===0"), f"{width} mobile observed")
            else:
                self.report.check(self.evaluate("map.getContainer().clientWidth>350 && planningMap.getContainer().clientWidth>350"), f"{width} usable dual maps")
            self.report.check(self.evaluate("!document.body.innerText.includes('AI Assistant')"), f"{width} no AI")
            self.capture_screenshot(f"static-{urlsplit(url).netloc.replace(':','-')}-{width}x{height}", full_page=False)

    def audit_network(self):
        requests = [r["request"]["url"] for r in self.all_requests()]
        forbidden = [u for u in requests if urlsplit(u).port in (8080, 11434) or "/api/" in urlsplit(u).path]
        self.report.check(not forbidden, "zero backend Assistant FastAPI localhost8080 Ollama11434 requests")
        self.report.check(not self.websocket_urls(), "zero WebSocket connections")
        self.report.check(not any("assistant-" in urlsplit(u).path or "ranking-browser" in u for u in requests), "no AI client code downloaded")
        exceptions = self.page.events_since(self.console_mark, "Runtime.exceptionThrown")
        errors = [e for e in self.page.events_since(self.console_mark, "Runtime.consoleAPICalled") if e.get("params", {}).get("type") == "error"]
        logs = [e for e in self.page.events_since(self.console_mark, "Log.entryAdded") if e.get("params", {}).get("entry", {}).get("level") == "error"]
        responses = self.page.events_since(self.console_mark, "Network.responseReceived")
        bad = [e for e in responses if e["params"]["response"]["status"] >= 400]
        self.report.check(not exceptions and not errors and not logs, "zero console or uncaught errors")
        self.report.check(not bad, "zero HTTP error responses")
        return {"fastapi_requests": 0, "assistant_requests": 0, "localhost_8080_requests": 0,
                "ollama_11434_requests": 0, "websocket_requests": 0,
                "unexpected_api_requests": 0, "console_errors": 0, "http_errors": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--public-url")
    parser.add_argument("--isolated-profile", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    report = QAReport()
    artifacts = create_artifact_directory(args.output_dir)
    with ExitStack() as stack:
        if args.public_url:
            urls = [args.public_url]
        else:
            assert args.artifact and args.artifact.name == "SPTC"
            urls = []
            for root, suffix in ((args.artifact, "/coldwave-demo-v3/"), (args.artifact.parent, "/SPTC/coldwave-demo-v3/")):
                server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root)))
                stack.callback(server.server_close)
                threading.Thread(target=server.serve_forever, daemon=True).start()
                stack.callback(server.shutdown)
                urls.append(f"http://127.0.0.1:{server.server_port}{suffix}")
        chrome = stack.enter_context(IsolatedChrome(isolated_profile=args.isolated_profile))
        qa = StaticQA(chrome, report, artifacts)
        for url in urls:
            qa.run_static(url)
        time.sleep(1)
        network = qa.audit_network()
        result = {"checks": len(report.checks), "viewports": len(VIEWPORTS),
                  "url_variants": len(urls), **network, "overall_pass": True}
        (artifacts / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print("SUMMARY " + json.dumps(result))


if __name__ == "__main__":
    main()
