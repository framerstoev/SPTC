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
        if ev("matchMedia('(max-width:700px)').matches && v4App.store.get().panel!==null"):
            click("#collapsePanel")
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
        check(ev("v4App.store.get().panel===null && document.querySelector('#contextPanel').hidden"), "map-first landing has collapsed context panel")
        check(ev("document.querySelectorAll('#moduleRail button').length===7"), "seven visible navigation modules")
        if ev("!document.querySelector('#guideInvitation').hidden"):
            click("#dismissGuide")
        shot("desktop-explore-collapsed")
        ev("v4App.maps.entries.get('explore').map.setView([31.2,-99.1],7,{animate:false});true")
        before_view=ev("(()=>{const m=v4App.maps.entries.get('explore').map;return {center:m.getCenter(),zoom:m.getZoom()}})()")
        for module in ["overview", "analysis", "layers", "timeseries", "forecast", "data", "about"]:
            click(f"[data-module={module}]")
            page.wait(f"!document.querySelector('#module-{module}').hidden")
            check(ev("[...document.querySelectorAll('[data-module-content]')].filter(e=>!e.hidden).length===1 && document.querySelectorAll('#moduleRail .active').length===1"), "exclusive primary panel " + module)
            check(ev(f"document.querySelector('[data-module={module}]').getAttribute('aria-expanded')==='true'"), "active indicator " + module)
            if module in ["overview","layers","forecast"]:
                shot("desktop-"+module)
            click(f"[data-module={module}]")
            check(ev("v4App.store.get().panel===null && document.querySelector('#contextPanel').hidden"), "same icon collapses " + module)
        time.sleep(.3)
        check(ev(f"(()=>{{const m=v4App.maps.entries.get('explore').map;return m.getZoom()==={before_view['zoom']} && m.project(m.getCenter()).distanceTo(m.project({[before_view['center']['lat'],before_view['center']['lng']]}))<1.1}})()"), "all module toggles preserve geographic center and zoom")
        click("[data-module=forecast]")
        check(ev("document.querySelector('#module-forecast').textContent.includes('Temporal Forecasting') && document.querySelector('#module-forecast').textContent.includes('Spatial Prediction') && document.querySelector('#module-forecast button').disabled"), "Forecast is two planned capabilities with disabled computation")
        check(ev("!document.querySelector('[data-layer*=forecast]') && !document.querySelector('#module-forecast canvas')"), "no forecast layer or numerical chart")
        click("#collapsePanel")
        click("#resetExplore")
        click("[data-module=overview]")
        click("[data-action=impact]")
        check(ev("document.querySelector('#impactDrawer').open"), "Overview opens area impact details")
        click("#closeImpact")
        click("#collapsePanel")
        click("#impactDetails")
        check(ev("document.querySelector('#impactDrawerBody').querySelectorAll('.metric-card').length===6"), "area details contain available physical/cost breakdowns")
        shot("desktop-area-impact")
        click("#closeImpact")
        find("1081")
        page.wait("Chart.getChart(document.querySelector('#inspectorBody canvas'))")
        check(ev("document.querySelector('#sectionTitle').textContent==='CS_1081'"), "keyboard search updates shared inspector")
        check(ev("(()=>{const c=Chart.getChart(document.querySelector('#inspectorBody canvas'));const p=v4App.data.curveCache.get('1081');return p.then(p=>JSON.stringify(c.data.datasets[1].data.filter(x=>x.y!==null).map(x=>x.y))===JSON.stringify(p.series.q_smoothed))})()"), "chart retains every accepted smoothed Q value")
        shot("desktop-section-observed")
        click("#hideInspector")
        check(ev("v4App.store.get().selectedId==='1081' && document.querySelector('#sectionInspector').hidden && !document.querySelector('#reopenInspector').hidden"), "hide inspector preserves shared selected road")
        click("[data-module=about]")
        click("#collapsePanel")
        check(ev("v4App.store.get().selectedId==='1081' && v4App.store.get().area==='texas' && v4App.store.get().layer==='potential'"), "panel changes preserve selection filters and layer")
        click("#reopenInspector")
        page.wait("Chart.getChart(document.querySelector('#inspectorBody canvas'))")
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
        click("[data-module=overview]")
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
            click("[data-module=layers]") if ev("v4App.store.get().panel!=='layers'") else None
            click(f"[data-layer={metric}]")
            check(ev(f"v4App.store.get().layer==='{metric}' && document.querySelector('#exploreLegend .legend-unit').textContent===V4Core.metrics['{metric}'].unit"), "actual layer change and correct legend units " + metric)
        click("[data-layer=temp_tmin_days]")
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
        click("[data-module=data]")
        check(ev("document.querySelector('#module-data').textContent.includes(v4App.data.manifest.run_id) && document.querySelector('#module-data').textContent.includes('NOT_APPROVED')"), "Data exposes actual run provenance and approval state")
        shot("desktop-data")
        click("#collapsePanel")
        find("1081")
        click("[data-inspector-tab=observed]")
        click("[data-action=timeseries]")
        page.wait("Chart.getChart(document.querySelector('#timeSeriesBody canvas'))")
        check(ev("v4App.store.get().selectedId==='1081' && document.querySelector('#sectionInspector').hidden"), "Time Series uses shared selection without duplicate inspector")
        check(ev("(()=>{const c=Chart.getChart(document.querySelector('#timeSeriesBody canvas'));return v4App.data.curveCache.get('1081').then(p=>JSON.stringify(c.data.datasets[1].data.filter(x=>x.y!==null).map(x=>x.y))===JSON.stringify(p.series.q_smoothed))})()"), "Time Series retains all accepted curve values")
        shot("desktop-timeseries")
        check(sum('curves/CS_1081.json' in e['params']['request']['url'] for e in page.events if e.get('method')=='Network.requestWillBeSent')==1, "inspector and Time Series reuse one cached curve fetch")
        click("#expandSeries")
        page.wait("Chart.getChart(document.querySelector('#expandedSeriesBody canvas'))")
        check(ev("document.querySelector('#seriesDialog').open"), "time series expands")
        shot("desktop-timeseries-expanded")
        click("#closeSeries")
        find("1")
        check(ev("document.querySelector('#timeSeriesBody').textContent.includes('No observed Q(t) support') && !document.querySelector('#timeSeriesBody canvas')"), "unsupported Time Series remains unavailable")
        find("3597")
        page.wait("document.querySelector('#timeSeriesBody .curve-status')?.textContent.includes('censored')")
        check(True, "Time Series retains censored recovery terminology")
        find("1081")
        find("1")
        check(ev("!document.querySelector('#timeSeriesBody canvas')"), "latest selection suppresses stale curve display")
        click("#collapsePanel")
        click("#clearSelection")
        click("#startGuide")
        check(ev("document.querySelector('#guideDialog').open && document.querySelector('#guideDialog').dataset.step==='1'"), "Guide starts")
        shot("desktop-guide")
        click("#guideNext")
        check(ev("document.querySelector('#guideDialog').dataset.step==='2'"), "Guide advances")
        click("#guidePrevious")
        check(ev("document.querySelector('#guideDialog').dataset.step==='1'"), "Guide goes backward")
        for step in range(2,9):
            click("#guideNext")
            ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))")
            check(ev("(()=>{const r=document.querySelector('#guideHighlight').getBoundingClientRect();return r.width>0&&r.height>0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"), "Guide highlights real component step " + str(step))
        check(ev("document.querySelector('#guideNext').textContent==='Finish'"), "Guide has Finish action")
        click("#guideNext")
        page.wait("!document.querySelector('#guideDialog').open && v4App.store.get().workspace==='explore' && v4App.store.get().panel===null")
        check(True, "Guide finishes and restores shell state")
        click("#startGuide")
        click("#guideSkip")
        page.wait("!document.querySelector('#guideDialog').open && v4App.store.get().panel===null")
        check(True, "Guide skips and closes")
        click("#startGuide")
        page.call("Input.dispatchKeyEvent", {"type":"keyDown","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
        page.call("Input.dispatchKeyEvent", {"type":"keyUp","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
        page.wait("!document.querySelector('#guideDialog').open")
        check(True,"Guide keyboard Escape closes")
        # Docs is a separate static page and does not fetch any research package.
        docs_url=ev("document.querySelector('#docsLink').href")
        docs_mark=len(page.events)
        page.call("Page.navigate", {"url":docs_url})
        page.wait("document.querySelectorAll('.docs-section').length===14")
        check(ev("document.querySelector('#curves').textContent.includes('Candidate B') && document.querySelector('#windows').textContent.includes('12:00 UTC') && document.querySelector('#forecast').textContent.includes('model not yet available')"), "Docs contains fourteen real method and roadmap chapters")
        shot("desktop-docs-introduction")
        click("#docsNav a[href='#curves']")
        page.wait("location.hash==='#curves' && document.querySelector('#docsNav a[aria-current]')?.hash==='#curves'")
        check(ev("location.hash==='#curves' && document.querySelector('#docsNav a[aria-current]')?.hash==='#curves'"), "Docs anchors and active chapter work")
        ev("(()=>{const e=document.querySelector('#docsSearch');e.value='censored';e.dispatchEvent(new Event('input',{bubbles:true}));})()")
        check(ev("[...document.querySelectorAll('.docs-section')].filter(e=>!e.hidden).length>0 && [...document.querySelectorAll('.docs-section')].filter(e=>!e.hidden).length<14"), "Docs text search filters chapters")
        docs_requests=[e['params']['request']['url'] for e in page.events[docs_mark:] if e.get('method')=='Network.requestWillBeSent']
        check(not any('.local-preview' in u for u in docs_requests), "Docs reads no research package")
        click("#backToMap")
        page.wait("window.v4App?.ready && v4App.data.mode==='LOCAL_RESEARCH_PREVIEW'")
        check(ev("v4App.store.get().panel===null && document.querySelector('#guideInvitation').hidden"), "Docs returns to local map and tour invitation is remembered")
        # Geometry fetch count below is per application load, not the Docs return.
        app_mark=len(page.events)
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
            click("[data-module=overview]")
            check(ev("(()=>{const p=document.querySelector('#contextPanel').getBoundingClientRect(),r=document.querySelector('#moduleRail').getBoundingClientRect();return p.right<=innerWidth && p.bottom<=innerHeight && r.bottom<=innerHeight})()"), name + " navigation panel reachable")
            check(ev("[...document.querySelectorAll('#moduleRail button')].every(b=>{const r=b.getBoundingClientRect();return r.height>=44 && r.top>=0 && r.bottom<=innerHeight})"), name + " all seven module touch targets inside viewport")
            shot(name + "-overview")
            click("#collapsePanel")
            click("[data-workspace=explore]")
            click("#startGuide")
            for _ in range(3): click("#guideNext")
            check(ev("(()=>{const r=document.querySelector('.guide-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"), name + " Guide inside viewport")
            shot(name + "-guide")
            for _ in range(4): click("#guideNext")
            check(ev("document.querySelector('#guideDialog').dataset.step==='8' && document.querySelector('#module-forecast').textContent.includes('model not yet available')"), name + " full Guide reaches honest Forecast ending")
            click("#guideSkip")
            page.wait("!document.querySelector('#guideDialog').open")
            click("#clearSelection")
            page.call("Page.navigate", {"url":docs_url})
            page.wait("document.querySelectorAll('.docs-section').length===14")
            check(ev("document.documentElement.scrollWidth<=innerWidth+1"), name + " Docs no horizontal overflow")
            shot(name + "-docs")
            click("#backToMap")
            page.wait("window.v4App?.ready && v4App.data.mode==='LOCAL_RESEARCH_PREVIEW'")
        requests = [e["params"]["request"]["url"] for e in page.events if e.get("method") == "Network.requestWillBeSent"]
        check(sum(".local-preview/geometry.json" in u for u in requests) == 4, "one geometry fetch per page load; none for panels/workspace changes")
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
        public_docs=ev("document.querySelector('#docsLink').href")
        page.call("Page.navigate", {"url":public_docs})
        page.wait("document.querySelectorAll('.docs-section').length===14")
        check(ev("document.querySelector('#backToMap').getAttribute('href')==='./'"), "public Docs returns to public map without research query")
        click("#backToMap")
        page.wait("window.v4App?.ready && v4App.data.mode==='PUBLIC_SHOWCASE'")
        public_requests = [e["params"]["request"]["url"] for e in page.events[mark:] if e.get("method") == "Network.requestWillBeSent"]
        check(not any(".local-preview" in u for u in public_requests), "public Docs and return never fetch research data")
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
        (output / "failure.json").write_text(json.dumps({"error": str(exc), "passed_checks": checks, "events": page.events[-40:], "all_errors": [e for e in page.events if e.get("method") in ["Runtime.exceptionThrown","Log.entryAdded","Network.loadingFailed"]]}, indent=2), encoding="utf-8")
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
