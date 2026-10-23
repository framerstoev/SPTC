"""Real pointer/keyboard/touch layout acceptance against local or public V4."""
from pathlib import Path
import argparse
import base64
import json
import subprocess
import time
from uuid import uuid4

import urllib.request
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
    output = args.output_dir.resolve() / uuid4().hex
    output.mkdir(parents=True)
    profile = output / "chrome-profile"
    process = subprocess.Popen([r"C:\Program Files\Google\Chrome\Application\chrome.exe", "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + str(profile), "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    deadline = time.monotonic() + 25
    while not (profile / "DevToolsActivePort").exists() and time.monotonic() < deadline:
        time.sleep(.2)
    if not (profile / "DevToolsActivePort").exists():
        if process.poll() is None:
            process.terminate()
        raise RuntimeError("Isolated Chrome did not expose its debugging endpoint")
    port = int((profile / "DevToolsActivePort").read_text().splitlines()[0])
    browser = CDP(fetch_json(f"http://127.0.0.1:{port}/json/version")["webSocketDebuggerUrl"])
    page = CDP(next(t for t in fetch_json(f"http://127.0.0.1:{port}/json/list") if t["type"] == "page")["webSocketDebuggerUrl"])
    checks, screenshots = [], []
    def ev(s): return page.evaluate(s)
    def check(s, label):
        assert ev(s), label
        checks.append(label)
    def settle():
        ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))")
        time.sleep(.12)
    def click(selector):
        ev(f"document.querySelector({json.dumps(selector)}).click()")
        settle()
    def pointer_click(selector):
        r=rect(selector);point={"x":r['x']+r['width']/2,"y":r['y']+r['height']/2}
        page.call("Input.dispatchMouseEvent", {"type":"mousePressed","button":"left","clickCount":1,**point})
        page.call("Input.dispatchMouseEvent", {"type":"mouseReleased","button":"left","clickCount":1,**point})
        settle()
    def rect(selector):
        return ev(f"(()=>{{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}}})()")
    def drag(selector, dx, dy, header=False):
        r = rect(selector); x = r["x"] + (70 if header else r["width"] / 2); y = r["y"] + (18 if header else r["height"] / 2)
        page.call("Input.dispatchMouseEvent", {"type":"mouseMoved","x":x,"y":y})
        page.call("Input.dispatchMouseEvent", {"type":"mousePressed","button":"left","clickCount":1,"x":x,"y":y})
        for i in range(1, 9):
            page.call("Input.dispatchMouseEvent", {"type":"mouseMoved","buttons":1,"button":"left","x":x+dx*i/8,"y":y+dy*i/8})
            ev("new Promise(r=>requestAnimationFrame(()=>r(true)))")
        page.call("Input.dispatchMouseEvent", {"type":"mouseReleased","button":"left","clickCount":1,"x":x+dx,"y":y+dy})
        settle()
    def key(selector, key):
        ev(f"document.querySelector({json.dumps(selector)}).focus()")
        page.call("Input.dispatchKeyEvent", {"type":"keyDown","key":key,"code":key})
        page.call("Input.dispatchKeyEvent", {"type":"keyUp","key":key,"code":key})
        settle()
    def viewport(w,h):
        page.call("Emulation.setDeviceMetricsOverride", {"width":w,"height":h,"deviceScaleFactor":1,"mobile":w<600})
        settle()
    def shot(name):
        settle(); path = output / (name + ".png")
        path.write_bytes(base64.b64decode(page.call("Page.captureScreenshot", {"format":"png","captureBeyondViewport":False})["data"]))
        screenshots.append(path.name)
    def contained():
        return "(()=>{const p=document.querySelector('#sectionInspector').getBoundingClientRect(),m=document.querySelector(v4App.store.get().workspace==='compare'?'#compareWorkspace':'#exploreWorkspace').getBoundingClientRect();return p.left>=m.left+7&&p.top>=m.top+7&&p.right<=m.right-7&&p.bottom<=m.bottom-7})()"
    def same_view(before, name="explore"):
        return f"(()=>{{const m=v4App.maps.entries.get('{name}').map;return m.getZoom()==={before['zoom']}&&m.project(m.getCenter()).distanceTo(m.project({[before['lat'],before['lng']]}))<=1.1}})()"
    def view(name="explore"):
        return ev(f"(()=>{{const m=v4App.maps.entries.get('{name}').map;return {{lat:m.getCenter().lat,lng:m.getCenter().lng,zoom:m.getZoom()}}}})()")
    try:
        for domain in ["Page","Runtime","Network","Log"]: page.call(domain+".enable")
        viewport(1440,900)
        page.call("Page.navigate", {"url":args.url})
        page.wait("window.v4App?.layout && v4App.data.rows.length===10029",60)
        if ev("!document.querySelector('#guideInvitation').hidden"): click("#dismissGuide")
        click("#resetLayout")
        shot("01-default-v4")
        click("[data-module=overview]")
        check("document.querySelector('#contextPanel').getBoundingClientRect().width===352", "default desktop sidebar width remains 352px")
        ev("v4App.maps.entries.get('explore').map.setView([31.2,-99.1],7,{animate:false});true")
        before=view()
        drag("#sidebarResize",170,0)
        check("Math.abs(document.querySelector('#contextPanel').getBoundingClientRect().width-522)<2", "real divider pointer drag widens sidebar")
        check(same_view(before), "sidebar widening preserves map center/zoom")
        shot("02-expanded-left-panel")
        drag("#sidebarResize",-500,0)
        check("document.querySelector('#contextPanel').getBoundingClientRect().width===280", "sidebar pointer drag respects 280px minimum")
        check(same_view(before), "sidebar narrowing preserves geographic view")
        shot("03-narrowed-left-panel")
        click("#collapsePanel");click("[data-module=overview]")
        check("document.querySelector('#contextPanel').getBoundingClientRect().width===280", "collapse/reopen restores chosen width")
        for module in ["overview","analysis","layers","timeseries","forecast","data","about"]:
            if ev("v4App.store.get().panel!=="+json.dumps(module)):click(f"[data-module={module}]")
            check("document.querySelector('#contextPanel').getBoundingClientRect().width===280 && document.querySelector('.context-scroll').scrollWidth<=document.querySelector('.context-scroll').clientWidth+1", "usable narrow module without horizontal overflow: "+module)
        click("#collapsePanel")
        ev("v4App.select('1081')")
        page.wait("Chart.getChart(document.querySelector('#inspectorBody canvas'))")
        settle()
        check(contained(), "default inspector is inside map, above impact summary")
        original=rect("#sectionInspector");cid=ev("Chart.getChart(document.querySelector('#inspectorBody canvas')).id")
        drag("#inspectorDrag",-370,24,True)
        moved=rect("#sectionInspector")
        check(f"Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().x-{original['x']-370})<2", "only header drag moves inspector toward center")
        shot("04-inspector-moved-center")
        check(same_view(before), "inspector drag does not pan or zoom map")
        selected=ev("v4App.store.get().selectedId")
        m=rect('#exploreMap');x=m['x']+120;y=m['y']+310
        page.call('Input.dispatchMouseEvent',{'type':'mousePressed','button':'left','clickCount':1,'x':x,'y':y})
        page.call('Input.dispatchMouseEvent',{'type':'mouseMoved','buttons':1,'button':'left','x':x+75,'y':y+35})
        page.call('Input.dispatchMouseEvent',{'type':'mouseReleased','button':'left','clickCount':1,'x':x+75,'y':y+35});settle()
        check('!'+same_view(before), 'real map panning still works outside the floating inspector')
        check(f"v4App.store.get().selectedId==={json.dumps(selected)}", 'map pan and panel drag do not accidentally select another road')
        drag("#inspectorResizeHeight",0,-220)
        check(f"document.querySelector('#sectionInspector').getBoundingClientRect().height<{original['height']}-150", "vertical edge reduces inspector height")
        drag("#inspectorResizeCorner",190,90)
        check("document.querySelector('#sectionInspector').getBoundingClientRect().width>500", "corner pointer drag expands both dimensions")
        check(contained(), "enlarged inspector stays inside map")
        check(f"Chart.getChart(document.querySelector('#inspectorBody canvas')).id==={cid}", "resize keeps existing chart instance instead of rebuilding")
        check("(()=>{const c=Chart.getChart(document.querySelector('#inspectorBody canvas'));return Math.abs(c.width-c.canvas.parentElement.clientWidth)<2})()", "Q(t) canvas follows inspector width")
        shot("05-enlarged-inspector")
        drag("#inspectorResizeWidth",-900,0);drag("#inspectorResizeHeight",0,-900)
        check("Math.round(document.querySelector('#sectionInspector').getBoundingClientRect().width)===340 && Math.round(document.querySelector('#sectionInspector').getBoundingClientRect().height)===280", "inspector respects 340x280 minimum")
        shot("06-small-resized-inspector")
        for tab in ["weather","planning","impact","observed"]:
            old=rect("#sectionInspector");pointer_click(f"[data-inspector-tab={tab}]")
            check(f"document.querySelector('#inspectorBody').dataset.tab==='{tab}' && Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().x-{old['x']})<1", "tab works without initiating drag: "+tab)
            check("document.querySelector('#inspectorBody').scrollWidth<=document.querySelector('#inspectorBody').clientWidth+1 && document.querySelector('.inspector-tabs').getBoundingClientRect().bottom<=document.querySelector('#sectionInspector').getBoundingClientRect().bottom", "small inspector content wraps and tabs stay accessible: "+tab)
        check("document.querySelector('#inspectorBody').scrollHeight>document.querySelector('#inspectorBody').clientHeight", "small inspector retains content scrolling")
        ev("document.querySelector('#inspectorBody').scrollTop=100;true")
        check("document.querySelector('#inspectorBody').scrollTop>0", "inspector content can actually scroll")
        drag("#inspectorDrag",-2000,2000,True)
        check(contained(), "drag clamps to lower-left map boundary")
        drag("#inspectorDrag",2000,-2000,True)
        check(contained(), "drag clamps to upper-right map boundary")
        pos=rect("#sectionInspector");pointer_click("#hideInspector");click("#reopenInspector")
        check(f"Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().x-{pos['x']})<1 && v4App.store.get().selectedId==='1081'", "hide/reopen retains position and selected section")
        key("#inspectorDrag","ArrowLeft")
        check(f"document.querySelector('#sectionInspector').getBoundingClientRect().x<{pos['x']}-10", "keyboard can move inspector header")
        key("#inspectorResizeCorner","ArrowRight")
        check("document.querySelector('#sectionInspector').getBoundingClientRect().width>340", "keyboard can resize inspector")
        click("[data-module=overview]");key("#sidebarResize","ArrowRight")
        check("document.querySelector('#contextPanel').getBoundingClientRect().width===296", "keyboard separator adjusts sidebar width")
        drag("#sidebarResize",180,0)
        check(contained(), "sidebar resizing reclamps floating inspector")
        saved=json.loads(ev("localStorage.getItem('sptc-v4-layout-v1')"));old_side=rect("#contextPanel")["width"];saved_position=rect('#sectionInspector')
        page.call("Page.reload", {"ignoreCache":True});page.wait("window.v4App?.layout",60);settle()
        click("[data-module=overview]");ev("v4App.select('1081')");page.wait("Chart.getChart(document.querySelector('#inspectorBody canvas'))");settle()
        check(f"Math.abs(document.querySelector('#contextPanel').getBoundingClientRect().width-{old_side})<1", "sidebar preference survives refresh")
        check(f"Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().width-{saved['inspector']['width']})<1 && Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().height-{saved['inspector']['height']})<1", "inspector size survives refresh")
        check(contained(), "restored inspector position is validated against workspace")
        check(f"Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().x-{saved_position['x']})<1 && Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().y-{saved_position['y']})<1", 'inspector position survives refresh exactly within current bounds')
        click("[data-workspace=compare]");page.wait("v4App.maps.entries.size===3");settle()
        cv=view("planning")
        drag("#sidebarResize",140,0)
        check(same_view(cv,"planning"), "Compare sidebar resize preserves planning center/zoom")
        check("(()=>{const a=v4App.maps.entries.get('planning').map,b=v4App.maps.entries.get('observed').map;return a.getZoom()===b.getZoom()&&a.project(a.getCenter()).distanceTo(a.project(b.getCenter()))<=1.1})()", "Compare maps stay synchronized after resizing")
        check("[...v4App.maps.entries.values()].filter(e=>e.map.getContainer().getClientRects().length).every(e=>e.map.getSize().x===e.map.getContainer().clientWidth && e.byId.size===10029 && e.map.getContainer().querySelector('canvas').width>0)", "Leaflet and Canvas sizes remain valid without missing roadway layers")
        shot("07-compare-after-sidebar-resize")
        ev("v4App.store.set({layer:'loss',temperatureWindow:'temporal_overlap_labels'})")
        before_state=ev("JSON.stringify(v4App.store.get())");before_compare=view("planning")
        click("#resetLayout")
        check(f"JSON.stringify(v4App.store.get())==={json.dumps(before_state)}", "Reset layout preserves every analytical state field")
        check(same_view(before_compare,"planning"), "Reset layout preserves Compare geographic view")
        check("document.querySelector('#contextPanel').getBoundingClientRect().width===352 && document.querySelector('#sectionInspector').getBoundingClientRect().width===350", "Reset layout restores default panel sizes")
        check(contained(), "Reset restores an accessible upper-right inspector")
        check("Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().right-document.querySelector('#main').getBoundingClientRect().right+70)<2", 'Reset restores default upper-right placement')
        for width,height in [(1920,1080),(1024,768)]:
            viewport(width,height)
            check(contained(), f"viewport {width}x{height} clamps inspector")
            check("document.documentElement.scrollWidth<=innerWidth+1", f"viewport {width}x{height} has no page overflow")
            drag("#sidebarResize",2000,0)
            check("document.querySelector('#main').getBoundingClientRect().width>=Math.min(640,innerWidth-348)-1", f"viewport {width} keeps a meaningful Compare map width")
            check(contained(), f"viewport {width} resize keeps close/drag controls accessible")
            click("#resetLayout")
        # Touch pointer capture on a tablet divider, then native mobile sheet.
        r=rect("#sidebarResize");x=r['x']+r['width']/2;y=r['y']+180
        page.call("Emulation.setTouchEmulationEnabled", {"enabled":True,"maxTouchPoints":1})
        start_width=rect("#contextPanel")['width']
        page.call("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
        page.call("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":[{"x":x+40,"y":y}]})
        page.call("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]});settle()
        check(f"document.querySelector('#contextPanel').getBoundingClientRect().width>{start_width}+3", "real tablet touch divider changes width within constraints")
        page.call("Emulation.setTouchEmulationEnabled", {"enabled":False})
        viewport(390,844)
        click("#collapsePanel")
        check("getComputedStyle(document.querySelector('#sectionInspector')).position==='fixed' && getComputedStyle(document.querySelector('#inspectorResizeCorner')).display==='none'", "mobile retains bottom sheet and disables desktop resize handles")
        check("document.querySelector('#sectionInspector').getBoundingClientRect().bottom<=innerHeight-65 && document.documentElement.scrollWidth<=innerWidth+1", "mobile sheet and controls stay within viewport")
        shot("08-mobile-layout")
        before_mobile=rect("#sectionInspector");drag("#inspectorDrag",60,-80,True)
        check(f"Math.abs(document.querySelector('#sectionInspector').getBoundingClientRect().top-{before_mobile['y']})<1", "mobile header cannot initiate floating-window drag")
        viewport(1440,900)
        check(contained(), "desktop/mobile/desktop transition restores valid floating bounds")
        check("v4App.store.get().selectedId==='1081' && v4App.store.get().layer==='loss'", "responsive transitions preserve section and analytical layer")
        requests=[e['params']['request']['url'] for e in page.events if e.get('method')=='Network.requestWillBeSent']
        assert sum('/data/geometry.json' in u for u in requests)==2, "Geometry should fetch only once per page load"
        checks.append("no geometry refetch during any layout interaction; only explicit refresh fetches again")
        assert sum('/curves/CS_1081.json' in u for u in requests)==2, "Curve should be cached throughout each page load"
        checks.append("no curve refetch on resize, drag, tab switching or layout reset")
        check("v4App.data.eventSummary.expected_demand_mobility_delay_cost_2024usd===288123004.94467396", "accepted event economics remains exact")
        errors=[e for e in page.events if e.get('method')=='Runtime.exceptionThrown' or (e.get('method')=='Log.entryAdded' and e['params']['entry']['level']=='error') or (e.get('method')=='Network.loadingFailed' and not e['params'].get('canceled')) or (e.get('method')=='Network.responseReceived' and e['params']['response']['status']>=400)]
        assert not errors,errors
        result={'status':'PASS','url':args.url,'checks':checks,'check_count':len(checks),'screenshots':screenshots,'browser_errors':errors,'request_count':len(requests)}
        (output/'acceptance.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'status':'PASS','checks':len(checks),'errors':0,'output':str(output)}),flush=True)
    except Exception as exc:
        shot('failure')
        (output/'failure.json').write_text(json.dumps({'error':str(exc),'checks':checks,'events':page.events[-35:]},indent=2),encoding='utf-8');print(json.dumps({'status':'FAIL','error':str(exc),'passed_checks':len(checks),'output':str(output)}),flush=True);raise
    finally:
        try:browser.call('Browser.close')
        except Exception:pass
        page.ws.close();browser.ws.close()
        try:process.wait(timeout=8)
        except subprocess.TimeoutExpired:pass


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--output-dir',required=True,type=Path);main(parser.parse_args())
