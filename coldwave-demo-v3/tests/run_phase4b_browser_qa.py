"""Phase 4B production-page QA; reuse the accepted isolated CDP lifecycle.

Run with the base Python environment. Never starts/stops application services.
No prompts, answers, evidence, or model reasoning are persisted in normal output.
Screenshots are explicit visual QA artifacts in a fresh temporary run directory.
"""

from __future__ import annotations

import json
import math
import time
from contextlib import suppress
from dataclasses import asdict

from run_phase4a_browser_qa import (
    ASSISTANT_QUERY_URL, BACKEND_ORIGIN, EXPECTED_METHOD, EXPECTED_RELEASE,
    FORBIDDEN_VISIBLE, RAW_JSON, BrowserQAError, IsolatedChrome, Phase4ABrowserQA,
    PromptResult, QAReport, create_artifact_directory, latency_summary, parse_args,
    read_json, run_stage, sanitized_error, verify_frontends_available, verify_live_backend,
)

VIEWPORTS = ((1920, 1080), (1440, 900), (1366, 768), (1024, 768), (768, 900), (390, 844))


class Phase4BBrowserQA(Phase4ABrowserQA):
    def ui_acceptance(self):
        self.set_viewport(1440, 900)
        mark = self.navigate()
        self.wait_js("typeof planningControlLayer !== 'undefined' && Boolean(planningControlLayer && workspaceController)", "both shared-data layers")
        self.report.check(not self.api_requests(mark), "page load makes zero Assistant requests")
        self.report.check(self.evaluate("document.querySelectorAll('.leaflet-container').length === 2 && document.querySelectorAll('#csSearch').length === 1"), "exactly two maps and one shared search")
        self.report.check(self.evaluate("document.querySelectorAll('[data-analysis-layer]').length === 3 && !document.querySelector('[data-analysis-layer=tier3]')"), "only planning offers a tier selector")
        self.select_section("1081")
        self.wait_js("Boolean(curveChart) && !document.querySelector('#curveChartWrap').hidden", "observed curve")
        original_chart = self.evaluate("curveRequestId")
        for tier, labels in (("tier1", ["WEATHER_REI"]), ("tier2", ["NETWORK_REI", "AADT"]), ("potential", ["Potential", "Tier 1", "Tier 2"])):
            self.set_tier(tier)
            text = self.evaluate("document.querySelector('#planningAnalysis').innerText")
            self.report.check(all(label in text for label in labels), f"{tier} compact reviewed metrics")
            self.report.check(not any(label in text for label in ("Lite", "EVENT_REI", "this is not", "planning context, not")), f"{tier} has no internal labels/repeated microcopy")
            self.report.check(self.evaluate("document.querySelectorAll('#tierMetrics .metric-card').length === 4 && !document.querySelector('#curvePanel').hidden"), f"{tier} leaves four observed KPIs and Q(t) visible")
            self.report.check(self.evaluate("curveRequestId") == original_chart, f"{tier} does not fetch or reconstruct Q(t)")
        self.report.check(self.evaluate("controlLayer.options.style(mapData.features[0]).color === featureColor(mapData.features[0].properties,'tier3')"), "observed map remains fixed to Tier 3")
        self.report.check(self.evaluate("document.querySelector('#legend').textContent.includes('Higher = more favorable observed resilience') && document.querySelector('#planningLegend').textContent.includes('Higher = more favorable planning context')"), "independent correct legends")
        self.report.check(len([r for r in self.all_requests() if r['request']['url'].endswith('data_driven_resilience_map_v0.geojson')]) == 1, "large geometry fetched only once")
        self.report.check(self.evaluate("controlLayer.getLayers().length === 10029 && planningControlLayer.getLayers().length === 10029"), "both Canvas layers reuse the reviewed network")
        for name in ("map", "planningMap"):
            self.evaluate(f"{name}.panBy([40,20], {{animate:false}}); true")
            self.wait_js("map.getCenter().equals(planningMap.getCenter(),1e-8)", f"{name} pan synchronization")
            self.evaluate(f"{name}.setZoom({name}.getZoom()+1, {{animate:false}}); true")
            self.wait_js("map.getZoom() === planningMap.getZoom() && map.getCenter().equals(planningMap.getCenter(),1e-8)", f"{name} zoom synchronization")
        self.evaluate("globalThis.__qaMoves=0; map.on('move',()=>globalThis.__qaMoves++); planningMap.on('move',()=>globalThis.__qaMoves++); map.panBy([15,0],{animate:false}); true")
        time.sleep(0.4)
        moves = self.evaluate("globalThis.__qaMoves")
        time.sleep(0.4)
        self.report.check(moves <= 4 and self.evaluate("globalThis.__qaMoves") == moves, "map synchronization settles without recursive loops")
        self.evaluate("planningLayerByCtrl.get('257').fire('click'); true")
        self.wait_js("selectedProps.CTRL_SECT_KEY === 'CS_257' && Boolean(curveChart)", "planning-map selection")
        self.report.check(self.evaluate("selectedLeafletLayer === layerByCtrl.get('257') && planningSelectedLayer === planningLayerByCtrl.get('257') && Boolean(selectedHaloLayer && planningHaloLayer)"), "one selection highlighted on both maps")
        self.splitter_acceptance()
        for section, status in (("1081", "Detected"), ("257", "No sustained drop"), ("3597", "Recovery censored"), ("1", "No observed support"), ("583693", "Detected")):
            self.select_section(section)
            self.wait_js("!document.querySelector('#curveNote').textContent.includes('Loading')", "curve settled")
            self.report.check(status in self.evaluate("document.querySelector('#statusBadges').innerText"), f"CS_{section} essential status")
            if section in {"257", "1"}:
                self.report.check(self.evaluate("Array.from(document.querySelectorAll('#tierMetrics strong')).every(node=>node.textContent==='N/A')"), f"CS_{section} missing metrics not zero")
            if section == "3597":
                self.report.check("Censored endpoint" in self.evaluate("document.querySelector('#phaseMarkerLegend').innerText"), "censored endpoint not labelled confirmed recovery")
        self.select_section("1081")
        self.wait_js("Boolean(curveChart)", "selected supported curve")
        self.ensure_assistant_open()
        self.ensure_assistant_closed()
        self.report.check(not self.api_requests(mark), "selection, tiers, map sync, resize, visibility and AI toggling make zero automatic requests")
        self.report.check(self.evaluate("document.querySelector('#assistantMessages').children.length === 0"), "normal initial timeline contains no unsolicited metadata/context messages")

    def splitter_acceptance(self):
        self.evaluate("globalThis.__qaResize=[0,0,0]; [map,planningMap].forEach((m,i)=>{const fn=m.invalidateSize; m.invalidateSize=function(...args){__qaResize[i]++;return fn.apply(this,args)}}); const fn=curveChart.resize; curveChart.resize=function(...args){__qaResize[2]++;return fn.apply(this,args)}")
        for selector, axis in (("#workspaceSplitter", "x"), ("#observedSplitter", "y"), ("#planningSplitter", "y")):
            rect = self.evaluate(f"(()=>{{const r=document.querySelector('{selector}').getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()")
            self.page.command("Input.dispatchMouseEvent", {"type": "mousePressed", **rect, "button": "left", "clickCount": 1})
            moved = dict(rect)
            moved[axis] += 45
            self.page.command("Input.dispatchMouseEvent", {"type": "mouseMoved", **moved, "button": "left", "buttons": 1})
            self.page.command("Input.dispatchMouseEvent", {"type": "mouseReleased", **moved, "button": "left", "clickCount": 1})
            self.report.check(self.evaluate(f"Number(document.querySelector('{selector}').getAttribute('aria-valuenow'))") not in (43, 50), f"{selector} pointer drag changes ratio")
            for key, expected in (("Home", 35 if axis == "x" else 25), ("End", 65)):
                self.evaluate(f"document.querySelector('{selector}').dispatchEvent(new KeyboardEvent('keydown',{{key:'{key}',bubbles:true}}))")
                self.report.check(self.evaluate(f"document.querySelector('{selector}').getAttribute('aria-valuenow')") == str(expected), f"{selector} keyboard {key} clamps")
            # Restore the default using the same keyboard control, not private state mutation.
            self.evaluate(f"document.querySelector('{selector}').dispatchEvent(new KeyboardEvent('keydown',{{key:'Home',bubbles:true}}))")
            for _ in range(7 if axis == "x" else 9):
                self.evaluate(f"document.querySelector('{selector}').dispatchEvent(new KeyboardEvent('keydown',{{key:'{'ArrowRight' if axis == 'x' else 'ArrowDown'}',bubbles:true}}))")
        self.wait_js("__qaResize.every(value=>value>0)", "both maps invalidated and Q(t) resized")
        ratio = self.evaluate("document.querySelector('#workspaceSplitter').getAttribute('aria-valuenow')")
        for side, other in (("Planning", "observed"), ("Observed", "planning")):
            self.click(f"#toggle{side}")
            self.report.check(self.evaluate(f"document.querySelector('#{other}Workspace').getBoundingClientRect().width > document.querySelector('#comparativeWorkspace').clientWidth*.95"), f"hide {side}: other workspace expands")
            self.click(f"#toggle{side}")
        self.report.check(self.evaluate("document.querySelector('#workspaceSplitter').getAttribute('aria-valuenow')") == ratio, "restoring hidden sides preserves divider position")
        self.click("#togglePlanning")
        self.click("#toggleObserved")
        self.report.check(self.evaluate("document.querySelector('#planningWorkspace').getBoundingClientRect().width>0"), "last hidden side restores the other instead of empty workspace")
        self.click("#toggleObserved")

    def viewport_acceptance(self):
        artifacts = []
        for width, height in VIEWPORTS:
            self.ensure_assistant_closed()
            self.set_viewport(width, height)
            self.wait_js("document.documentElement.scrollWidth <= innerWidth", "no horizontal overflow")
            time.sleep(0.2)
            self.report.check(self.evaluate("document.documentElement.scrollHeight <= innerHeight"), f"{width}x{height} no page-height growth")
            if width <= 900:
                self.click("#togglePlanning")
                self.report.check(self.evaluate("document.querySelector('#map').clientWidth === 0 && document.querySelector('#planningMap').clientWidth > 300"), f"{width} mobile planning tab not two tiny maps")
                self.click("#toggleObserved")
                self.report.check(self.evaluate("document.querySelector('#planningMap').clientWidth === 0 && document.querySelector('#map').clientWidth > 300"), f"{width} mobile observed tab restores map")
            else:
                self.report.check(self.evaluate("map.getContainer().clientWidth>350 && planningMap.getContainer().clientWidth>350"), f"{width} both desktop maps usable")
            if width == 1440:
                layout = self.evaluate("(()=>{const a=document.querySelector('#observedAnalysis'),c=document.querySelector('#curveChart').getBoundingClientRect(),p=document.querySelector('#phaseMarkerLegend').getBoundingClientRect();return {scroll:a.scrollHeight-a.clientHeight,chart:c.height,markers:p.bottom,bottom:a.getBoundingClientRect().bottom}})()")
                self.report.check(layout['scroll'] <= 1 and layout['chart'] >= 185 and layout['markers'] <= layout['bottom'], "1440x900 all four KPIs, full Q(t), markers and status fit without analysis scrolling", json.dumps(layout))
            artifacts.append(self.capture_screenshot(f"phase4b-workspace-{width}x{height}", full_page=False))
            self.ensure_assistant_open()
            self.report.check(self.evaluate("(()=>{const p=document.querySelector('#assistantPanel').getBoundingClientRect(),m=document.querySelector('#assistantMessages').getBoundingClientRect(),c=document.querySelector('#assistantComposer').getBoundingClientRect();return p.left>=0 && p.right<=innerWidth && p.bottom<=innerHeight && m.height>p.height*.40 && c.bottom<=p.bottom})()"), f"{width} floating Assistant timeline and anchored composer fit")
            artifacts.append(self.capture_screenshot(f"phase4b-assistant-{width}x{height}", full_page=False))
        self.ensure_assistant_closed()
        self.set_viewport(1440, 900)
        return artifacts

    def live_acceptance(self):
        cases = (
            ("concept", "What is Potential Resilience?", "explain_project_concept", []),
            ("ranking", "Rank control sections by Tier 3 observed resilience.", "rank_sections", ["PARTIAL_OBSERVED_COVERAGE", "METHOD_SCOPE"]),
            ("dallas", "How did roadway sections in Dallas County perform during this event?", "summarize_county_resilience", ["PARTIAL_OBSERVED_COVERAGE", "METHOD_SCOPE"]),
            ("alignment", "How consistent are Potential Resilience and Tier 3 Observed Resilience?", "summarize_tier_alignment", ["METHOD_DEFINITION_REQUIRED", "METHOD_SCOPE"]),
            ("safety", "Which road should TxDOT rebuild first?", "decline_unsupported_request", []),
            ("section", "Explain this control section.", "get_section_summary", ["METHOD_SCOPE"]),
        )
        for case, prompt, tool, codes in cases:
            before = self.chat_assistant_count()
            context = self.chat_controller_state()
            mark = self.page.event_mark()
            started = time.perf_counter()
            self.set_chat_input(prompt)
            self.click("#assistantSend")
            self.wait_js(f"!assistantChatController.getState().pending && document.querySelectorAll('[data-result-kind=ai-assisted]').length>{before}", f"{case} model response", 120)
            elapsed = round(time.perf_counter() - started, 3)
            request = self.assert_one_request(mark, "POST", ASSISTANT_QUERY_URL, case)
            self.assert_request_context(request, prompt, context, case)
            payload = self.response_payload(request['requestId'])
            status = "unsupported_request" if case == "safety" else "completed"
            self.report.check(self.response_for(request['requestId'])['status'] == 200 and payload['status'] == status, f"{case} HTTP and response contract")
            self.report.check(payload['tools_used'] == [{"tool_name": tool, "call_index": 1}], f"{case} exact tool/control selection")
            self.report.check([w['code'] for w in payload['warnings']] == codes, f"{case} warning consistency")
            self.report.check(payload['data_release'] == EXPECTED_RELEASE and payload['method_version'] == EXPECTED_METHOD, f"{case} internal provenance retained")
            visible = self.evaluate("Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).textContent")
            self.report.check(self.evaluate("Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).children.length===1"), f"{case} single plain answer node")
            self.report.check(not any(code in visible for code in codes) and not RAW_JSON.search(visible) and not FORBIDDEN_VISIBLE.search(visible), f"{case} no internal codes/JSON/provenance UI")
            result = payload.get('structured_result')
            if case == "ranking":
                self.report.check(result['distribution']['available_count'] == 3473 and "3,473" in visible, "ranking eligible denominator in prose")
                for tail in ('highest_sections', 'lowest_sections'):
                    self.report.check(len(result[tail]) == 10 and all(row['section_id'] in visible for row in result[tail]), f"{tail} bounded complete visible text list")
                    for row in result[tail]:
                        value = self.evaluate(f"featureByCtrl.get('{row['section_id'][3:]}').properties.observed_curve_resilience_score_v0")
                        self.report.check(math.isclose(value, row['value'], abs_tol=5.1e-7), "ranking numerical evidence matches loaded release")
            if case == "dallas":
                self.report.check(result['total_sections'] == 58 and result['observed_support_count'] == 56 and result['status_counts']['no_observed_support'] == 2, "Dallas exact 58/56/2 denominator")
                self.report.check(all(token in visible for token in ('58', '56', '2', 'support')), "Dallas denominator and caveat in prose")
            if case == "alignment":
                self.report.check(result['valid_pair_count'] == 3473 and result['common_support_count'] == 3842 and abs(result['pearson_r']-.277170)<1e-6 and abs(result['spearman_rho']-.281802)<1e-6, "alignment reviewed pairs and correlations unchanged")
                self.report.check(result['classification_status'] == 'method_definition_required' and result['consistent_count'] is None and result['mismatch_count'] is None and result['representative_examples'] is None, "alignment classification remains undefined")
                self.report.check(all(token in visible for token in ('3,473','0.277','0.282','reviewed classification rule has not been defined')), "alignment pair count/correlation/limitation in plain prose")
            if case == "section":
                expected = read_json(BACKEND_ORIGIN + '/api/v1/sections/1081')
                # Accepted V3 Potential projection is two statuses plus three
                # planning metrics, not the legacy V2 full-summary projection.
                evidence = {item['evidence_id']: item for item in payload['evidence']}
                expected_values = {
                    'e_detection_status': expected['support_status']['detection_status'],
                    'e_observed_support': expected['support_status']['observed_support'],
                    **{'e_metric_' + name: expected['planning_context'][name] for name in (
                        'potential_resilience_score', 'weather_rei', 'netrisk_lite')},
                }
                self.report.check(len(payload['evidence']) == len(expected_values) and set(evidence) == set(expected_values), "section exact active-Potential evidence schema")
                for name, value in expected_values.items():
                    self.report.check(evidence[name]['section_id'] == 'CS_1081' and evidence[name]['value'] == value, "section identity and deterministic evidence values match summary")
                self.report.check(expected['identity']['route'] in visible or expected['identity']['route'].rstrip('_') not in visible, "section route preserved exactly when referenced")
            if case == "safety":
                self.report.check(payload['evidence'] == [] and result is None, "investment remains unsupported without numerical evidence")
            self.prompt_results.append(PromptResult(case,status,payload['intent'],tool,result['result_type'] if result else None,elapsed))
            print('CASE ' + json.dumps(asdict(self.prompt_results[-1])), flush=True)

    def cancellation_and_stale_acceptance(self) -> None:
        self.ensure_assistant_open()
        self.page.command(
            "Fetch.enable",
            {"patterns": [{"urlPattern": ASSISTANT_QUERY_URL, "requestStage": "Request"}]},
        )
        try:
            # Explicit cancellation: the paused request cannot reach the model.
            before = self.chat_assistant_count()
            mark = self.page.event_mark()
            self.set_chat_input("What is Q(t)?")
            self.click("#assistantSend")
            paused = self.wait_for_paused_query(mark)
            loading = self.evaluate(
                "({busy:document.querySelector('#assistantAgent').getAttribute('aria-busy'),"
                "inputDisabled:document.querySelector('#assistantInput').disabled,"
                "sendDisabled:document.querySelector('#assistantSend').disabled,"
                "cancelHidden:document.querySelector('#assistantCancel').hidden,"
                "cancelDisabled:document.querySelector('#assistantCancel').disabled})"
            )
            self.report.check(
                loading
                == {
                    "busy": "true",
                    "inputDisabled": True,
                    "sendDisabled": True,
                    "cancelHidden": False,
                    "cancelDisabled": False,
                },
                "pending Assistant request exposes one bounded cancellable state",
            )
            self.click("#assistantSend")
            time.sleep(0.2)
            self.report.check(
                len(self.query_requests(mark)) == 1,
                "disabled Send prevents duplicate Assistant submission",
            )
            self.click("#assistantCancel")
            self.wait_js(
                "assistantChatController.getState().pending === false "
                "&& document.querySelector('#assistantChatStatus').textContent"
                ".toLowerCase().includes('cancelled')",
                "explicit Assistant cancellation",
            )
            with suppress(BrowserQAError):
                self.page.command(
                    "Fetch.failRequest",
                    {"requestId": paused["requestId"], "errorReason": "Aborted"},
                    timeout=3,
                )
            time.sleep(0.25)
            self.report.check(
                self.chat_assistant_count() == before and len(self.query_requests(mark)) == 1,
                "cancelled request adds no assistant result or second request",
            )

            # Context staleness: a host-owned tier change aborts the paused request.
            self.set_tier("potential")
            before = self.chat_assistant_count()
            mark = self.page.event_mark()
            self.set_chat_input("What is Tier 3?")
            self.click("#assistantSend")
            paused = self.wait_for_paused_query(mark)
            self.set_tier("tier1")
            with suppress(BrowserQAError):
                self.page.command(
                    "Fetch.failRequest",
                    {"requestId": paused["requestId"], "errorReason": "Aborted"},
                    timeout=3,
                )
            time.sleep(0.25)
            state = self.chat_controller_state()
            self.report.check(
                self.chat_assistant_count() == before
                and state.get("pending") is False
                and state.get("activeAnalysisLayer") == "tier1"
                and state.get("activeMetric") == "weather_rei"
                and len(self.query_requests(mark)) == 1,
                "tier change prevents a stale assistant result from rendering",
            )
        finally:
            with suppress(BrowserQAError):
                self.page.command("Fetch.disable", timeout=3)

    def fixed_actions_acceptance(self) -> None:
        self.ensure_assistant_open()
        self.set_tier("potential")
        self.select_section("1081")
        self.evaluate("document.querySelector('.assistant-quick-actions').open = true")
        cases = (
            (
                "#assistantExplainSection",
                "GET",
                f"{BACKEND_ORIGIN}/api/v1/sections/1081",
                "fixed section explanation",
            ),
            (
                "#assistantExplainMetric",
                "GET",
                f"{BACKEND_ORIGIN}/api/v1/metrics/potential_resilience_score",
                "fixed metric explanation",
            ),
            (
                "#assistantGenerateReviewNote",
                "POST",
                f"{BACKEND_ORIGIN}/api/v1/reports/review-note",
                "fixed review note",
            ),
        )
        for selector, method, url, case_id in cases:
            before = int(
                self.evaluate(
                    "document.querySelectorAll("
                    "'#assistantMessages [data-result-kind=verified]').length"
                )
                or 0
            )
            mark = self.page.event_mark()
            self.click(selector)
            self.wait_js(
                "document.querySelectorAll("
                "'#assistantMessages [data-result-kind=verified]').length > "
                f"{before} && document.querySelector('#assistantMessages')"
                ".getAttribute('data-action-busy') !== 'true'",
                case_id,
                30,
            )
            self.assert_one_request(mark, method, url, case_id)
            self.report.check(
                not self.query_requests(mark),
                f"{case_id} remains outside the LLM path",
            )
            latest = self.evaluate(
                "Array.from(document.querySelectorAll("
                "'#assistantMessages [data-result-kind=verified]')).at(-1).textContent"
            )
            self.report.check(
                isinstance(latest, str)
                and FORBIDDEN_VISIBLE.search(latest) is None
                and RAW_JSON.search(latest) is None,
                f"{case_id} renders bounded public deterministic text",
            )

def main():
    args = parse_args()
    verify_frontends_available()
    if args.scenario == 'live':
        verify_live_backend()
    artifacts = create_artifact_directory(args.output_dir)
    report = QAReport()
    with IsolatedChrome(args.chrome, args.isolated_profile) as chrome:
        qa = Phase4BBrowserQA(chrome, report, artifacts)
        run_stage('comparative workspace', qa.ui_acceptance)
        run_stage('V2 coexistence', qa.simultaneous_v2_v3_acceptance)
        if args.scenario == 'live':
            run_stage('six live workflows', qa.live_acceptance)
            run_stage('cancellation and stale responses', qa.cancellation_and_stale_acceptance)
            run_stage('deterministic quick actions', qa.fixed_actions_acceptance)
        screenshots = run_stage('six visual viewports', qa.viewport_acceptance)
        network = run_stage('console and network', qa.final_console_network_acceptance)
    print('SUMMARY ' + json.dumps({'checks':len(report.checks),'viewports':len(VIEWPORTS),'screenshots':screenshots,'artifact_directory':str(artifacts),'latency':latency_summary(qa.prompt_results),**network,'overall_pass':True}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except BrowserQAError as error:
        print('ERROR: ' + sanitized_error(error))
        raise SystemExit(1) from None
