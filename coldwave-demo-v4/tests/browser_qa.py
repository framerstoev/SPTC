"""Real Chrome/CDP acceptance for static V4. Evidence stays in Git-ignored .qa.

Requires an existing static server, Chrome and websocket-client. Starts no model,
backend or server. Closes only its own isolated browser through its CDP endpoint.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import subprocess
import time
import urllib.request
from uuid import uuid4
import websocket


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, suppress_origin=True, timeout=35)
        self.serial = 0
        self.events = []

    def call(self, method: str, params: dict | None = None) -> dict:
        self.serial += 1
        serial = self.serial
        self.ws.send(json.dumps({"id": serial, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == serial:
                if "error" in message:
                    raise AssertionError(f"CDP command failed: {method}: {message['error']}")
                return message.get("result", {})
            self.events.append(message)

    def evaluate(self, expression: str):
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise AssertionError(str(result["exceptionDetails"]))
        return result.get("result", {}).get("value")

    def wait(self, expression: str, timeout: float = 40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.evaluate("Boolean(" + expression + ")"):
                return
            time.sleep(.15)
        raise AssertionError("Timed out: " + expression)


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def main(args):
    output = args.output_dir / uuid4().hex
    output.mkdir(parents=True)
    profile = output / "chrome-profile"
    profile.mkdir()
    chrome_path = args.chrome or Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    process = subprocess.Popen([str(chrome_path), "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                                "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
                                "--user-data-dir=" + str(profile.resolve()), "about:blank"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    deadline = time.monotonic() + 25
    while not (profile / "DevToolsActivePort").exists() and time.monotonic() < deadline:
        time.sleep(.2)
    port = int((profile / "DevToolsActivePort").read_text().splitlines()[0])
    browser = CDP(fetch_json(f"http://127.0.0.1:{port}/json/version")["webSocketDebuggerUrl"])
    target = next(p for p in fetch_json(f"http://127.0.0.1:{port}/json/list") if p["type"] == "page")
    page = CDP(target["webSocketDebuggerUrl"])
    checks, screenshots = [], []
    def check(condition, name):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
    def ev(expression):
        return page.evaluate(expression)
    def change(selector, value):
        ev(f"(()=>{{const e=document.querySelector({json.dumps(selector)});e.value={json.dumps(value)};e.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")
    def click(selector):
        ev(f"document.querySelector({json.dumps(selector)}).click()")
    def shot(name):
        time.sleep(.5)
        path = output / (name + ".png")
        path.write_bytes(base64.b64decode(page.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"]))
        screenshots.append(path.name)
    def find(id):
        if ev("matchMedia('(max-width:700px)').matches && !document.querySelector('#filterPanel').classList.contains('expanded')"):
            click("#filterToggle")
        ev(f"(()=>{{const e=document.querySelector('#sectionSearch');e.value='CS_{id}';e.dispatchEvent(new Event('input',{{bubbles:true}}));e.focus();}})()")
        page.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
        page.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
        page.wait(f"v4App.store.get().selectedId==='{id}'")
    try:
        for domain in ["Page", "Runtime", "Network", "Log"]:
            page.call(domain + ".enable")
        page.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        page.call("Page.navigate", {"url": args.url})
        page.wait("window.v4App?.ready && v4App.data.mode==='LOCAL_RESEARCH_PREVIEW'", 60)
        check(ev("v4App.data.rows.length===10029 && v4App.data.geometry.features.length===10029"), "10,029 exact geometry/metric joins")
        check(ev("v4App.data.counties.length===254"), "254 accepted primary-county filters")
        check(ev("!document.querySelector('#impactDrawer').open && document.querySelector('#impactBar').querySelectorAll('.impact-number').length===2"), "compact two-value impact summary; drawer initially closed")
        check(ev("document.querySelector('#areaCost').title===String(v4App.data.eventSummary.expected_demand_mobility_delay_cost_2024usd)"), "area cost matches local source without recomputation")
        check(ev("document.querySelectorAll('#hazardSelect option:disabled').length===5"), "five non-runnable hazard placeholders")
        check(ev("!document.querySelector('[id*=assistant i]')"), "no chat component")
        shot("desktop-explore")
        click("#impactDetails")
        check(ev("document.querySelector('#impactDrawerBody').querySelectorAll('.metric-card').length===6"), "area details contain available physical/cost breakdowns")
        shot("desktop-area-impact")
        click("#closeImpact")
        find("1081")
        page.wait("Chart.getChart(document.querySelector('#inspectorBody canvas'))")
        check(ev("document.querySelector('#sectionTitle').textContent==='CS_1081'"), "keyboard search updates shared inspector")
        check(ev("(()=>{const c=Chart.getChart(document.querySelector('#inspectorBody canvas'));const p=v4App.data.curveCache.get('1081');return p.then(p=>JSON.stringify(c.data.datasets[1].data.filter(x=>x.y!==null).map(x=>x.y))===JSON.stringify(p.series.q_smoothed))})()"), "chart retains every accepted smoothed Q value")
        shot("desktop-section-observed")
        for tab in ["weather", "planning", "impact", "observed"]:
            click(f"[data-inspector-tab={tab}]")
            check(ev(f"v4App.store.get().inspectorTab==='{tab}'"), "section inspector " + tab)
        click("[data-workspace=compare]")
        page.wait("v4App.maps.entries.size===3")
        check(ev("document.querySelector('#planningMap').getBoundingClientRect().left<document.querySelector('#observedMap').getBoundingClientRect().left"), "Planning left, Observed right")
        check(ev("v4App.store.get().selectedId==='1081'"), "selection preserved across workspaces")
        ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))")
        ev("v4App.maps.entries.get('planning').map.panBy([55,30],{animate:false});true")
        check(ev("(()=>{const a=v4App.maps.entries.get('planning').map,b=v4App.maps.entries.get('observed').map;return a.getZoom()===b.getZoom() && a.project(a.getCenter()).distanceTo(a.project(b.getCenter()))<1.1})()"), "comparison view synchronization within one rendering pixel")
        ev("v4App.maps.entries.get('planning').byId.get('257').fire('click');true")
        check(ev("v4App.store.get().selectedId==='257'"), "planning map click shares selection")
        ev("v4App.maps.entries.get('observed').byId.get('1081').fire('click');true")
        check(ev("v4App.store.get().selectedId==='1081'"), "observed map click shares selection")
        click("#clearSelection")
        shot("desktop-compare")
        change("#planningLayer", "weather")
        change("#observedLayer", "loss")
        check(ev("v4App.store.get().planningLayer==='weather' && v4App.store.get().observedLayer==='loss'"), "independent comparison layers")
        for i in range(10):
            change("#areaSelect", "48001")
            change("#areaSelect", "texas")
            page.wait("v4App.maps.entries.get('planning').map.getBounds().contains(v4App.maps.areaBounds()) && v4App.maps.entries.get('observed').map.getBounds().contains(v4App.maps.areaBounds())")
            time.sleep(.12)
            check(ev("document.querySelector('#visibleCount').textContent==='10,029' && v4App.store.get().area==='texas'"), f"county-to-Texas reset race {i+1}")
        change("#areaSelect", "48001")
        check(ev("document.querySelector('#impactArea').textContent==='Anderson County' && document.querySelector('#areaCost').title===String(v4App.data.countySummaries['48001'].expected_demand_mobility_delay_cost_2024usd)"), "county filtering and accepted county summary")
        change("#areaSelect", "texas")
        click("[data-workspace=explore]")
        for metric in ["weather", "network", "observed", "minimum", "loss", "recovery", "vehicle_delay", "mobility_cost", "temp_min", "temp_tmin_days", "temp_tmax_days", "potential"]:
            change("#layerSelect", metric)
            check(ev(f"v4App.store.get().layer==='{metric}'"), "actual layer change " + metric)
        change("#layerSelect", "temp_tmin_days")
        change("#temperatureWindow", "temporal_overlap_labels")
        check(ev("v4App.store.get().temperatureWindow==='temporal_overlap_labels' && document.querySelector('#mapSubtitle').textContent.includes('Jan 22–28')"), "experimental temperature window is explicit")
        find("257")
        click("[data-inspector-tab=observed]")
        check(ev("document.querySelector('#inspectorBody').textContent.includes('No sustained drop')"), "no-sustained-drop remains separate")
        click("[data-inspector-tab=impact]")
        check(ev("document.querySelector('#inspectorBody strong').textContent==='0.034'"), "small section delay not rounded to zero")
        find("1")
        click("[data-inspector-tab=observed]")
        check(ev("!document.querySelector('#inspectorBody canvas') && document.querySelector('#inspectorBody').textContent.includes('No observed Q(t) support')"), "missing observed support is unavailable")
        click("[data-inspector-tab=impact]")
        check(ev("[...document.querySelectorAll('#inspectorBody strong')].every(e=>e.textContent==='Unavailable')"), "missing section impact is unavailable")
        find("3597")
        click("[data-inspector-tab=observed]")
        page.wait("document.querySelector('#inspectorBody .curve-status')?.textContent.includes('censored')")
        check(ev("document.querySelector('#sectionStatus').textContent.includes('censored')"), "censored recovery warning retained")
        click("#clearSelection")
        check(ev("v4App.store.get().selectedId===null && document.querySelector('#sectionInspector').hidden"), "clear shared selection")
        # Dispatch a real Canvas click at a road coordinate, not only synthetic layer events.
        find("1081")
        click("#clearSelection")
        point = ev("(()=>{const e=v4App.maps.entries.get('explore'),f=v4App.data.geometry.features.find(f=>f.properties.id==='1081'),coords=f.geometry.coordinates,c=coords[Math.floor(coords.length/2)],p=e.map.latLngToContainerPoint([c[1],c[0]]),r=document.querySelector('#exploreMap').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}})()")
        page.call("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **point})
        page.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **point})
        page.wait("v4App.store.get().selectedId!==null")
        check(True, "real roadway Canvas click opens shared inspector")
        click("#clearSelection")
        click("#resetExplore")
        click("[data-workspace=methods]")
        check(ev("document.querySelector('#methodsWorkspace').textContent.includes('12:00 UTC') && document.querySelector('#methodsWorkspace').textContent.includes('Expected-Demand')"), "methods expose units, windows and interpretation")
        shot("desktop-methods")
        for width, height, name in [(1024, 820, "tablet"), (390, 844, "mobile")]:
            page.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 600})
            click("[data-workspace=explore]")
            click("#resetExplore")
            time.sleep(.5)
            check(ev("document.documentElement.scrollWidth<=innerWidth+1"), name + " no horizontal overflow")
            shot(name + "-explore")
            find("1081")
            page.wait("document.querySelector('#inspectorBody canvas')")
            check(ev("document.querySelector('#sectionInspector').getBoundingClientRect().bottom<=innerHeight"), name + " inspector inside viewport")
            shot(name + "-inspector")
            click("#clearSelection")
            click("[data-workspace=compare]")
            shot(name + "-compare")
            click("[data-workspace=methods]")
            shot(name + "-methods")
        requests = [e["params"]["request"]["url"] for e in page.events if e.get("method") == "Network.requestWillBeSent"]
        check(sum(".local-preview/geometry.json" in u for u in requests) == 1, "geometry fetched once across all interactions")
        check(not any(any(term in u.lower() for term in [":11434", ":8080", "/api/", "assistant", "ollama", "gemma"]) for u in requests), "zero backend/model/AI requests")
        # Public build must refuse local mode even when tested on a loopback server.
        mark = len(page.events)
        page.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        page.call("Page.navigate", {"url": args.public_url + "?mode=LOCAL_RESEARCH_PREVIEW"})
        page.wait("window.v4App?.ready && v4App.data.mode==='PUBLIC_SHOWCASE'")
        check(ev("v4App.data.rows.length===0 && !document.querySelector('#publicEmpty').hidden && document.querySelector('#areaCost').textContent==='Unavailable'"), "public build contains no analytical values and shows unavailable state")
        time.sleep(.3)
        ev("true")
        public_requests = [e["params"]["request"]["url"] for e in page.events[mark:] if e.get("method") == "Network.requestWillBeSent"]
        check(not any(".local-preview" in u for u in public_requests), "public_only prevents all local research fetches")
        shot("public-showcase")
        exceptions = [e for e in page.events if e.get("method") == "Runtime.exceptionThrown"]
        console_errors = [e for e in page.events if e.get("method") == "Log.entryAdded" and e["params"]["entry"]["level"] == "error"]
        failed = [e for e in page.events if e.get("method") == "Network.loadingFailed" and not e["params"].get("canceled")]
        bad_responses = [e for e in page.events if e.get("method") == "Network.responseReceived" and e["params"]["response"]["status"] >= 400]
        report = {"status": "PASS" if not exceptions and not console_errors and not failed and not bad_responses else "REQUIRES_REVISION",
                  "checks": checks, "check_count": len(checks), "screenshots": screenshots, "exceptions": exceptions,
                  "console_errors": console_errors, "failed_requests": failed, "http_errors": bad_responses,
                  "request_count": len(requests), "public_request_count": len(public_requests)}
        (output / "browser_qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"status": report["status"], "checks": len(checks), "exceptions": len(exceptions), "console_errors": len(console_errors),
                          "failed_requests": len(failed), "http_errors": len(bad_responses), "output": str(output)}, indent=2))
        if report["status"] != "PASS":
            raise AssertionError("Browser errors require review")
    except Exception as exc:
        (output / "failure.json").write_text(json.dumps({"error": str(exc), "passed_checks": checks, "events": page.events[-40:]}, indent=2), encoding="utf-8")
        print(json.dumps({"status": "FAIL", "error": str(exc), "passed_checks": len(checks), "output": str(output)}), flush=True)
        raise
    finally:
        try:
            browser.call("Browser.close")
        except Exception:
            pass
        page.ws.close()
        browser.ws.close()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--public-url", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--chrome", type=Path)
    main(parser.parse_args())
