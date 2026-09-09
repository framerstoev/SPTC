"""Phase 4C real production-page acceptance, reusing the reviewed CDP lifecycle.

No application process management; only sanitized metadata is printed. Screenshots
are explicit visual-QA artifacts, never normal launcher logs.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import asdict

from run_phase4b_browser_qa import (
    ASSISTANT_QUERY_URL, BACKEND_ORIGIN, BrowserQAError, IsolatedChrome,
    Phase4BBrowserQA, PromptResult, QAReport, VIEWPORTS, create_artifact_directory,
    latency_summary, parse_args, run_stage, sanitized_error,
    verify_frontends_available, verify_live_backend,
)


class Phase4CBrowserQA(Phase4BBrowserQA):
    def resize_acceptance(self):
        timings = []
        for width, height in VIEWPORTS:
            self.set_viewport(width, height)
            self.ensure_assistant_open()
            mark = self.page.event_mark()
            if width > 900:
                rect = self.evaluate("(()=>{const r=document.querySelector('#assistantResizeHandle').getBoundingClientRect();return {x:r.x+12,y:r.y+12}})()")
                before = self.evaluate("document.querySelector('#assistantPanel').getBoundingClientRect().width")
                started = time.perf_counter()
                self.page.command("Input.dispatchMouseEvent", {"type": "mousePressed", **rect, "button": "left", "clickCount": 1})
                moved = {"x": rect["x"] - 90, "y": max(4, rect["y"] - 40)}
                self.page.command("Input.dispatchMouseEvent", {"type": "mouseMoved", **moved, "button": "left", "buttons": 1})
                self.page.command("Input.dispatchMouseEvent", {"type": "mouseReleased", **moved, "button": "left", "clickCount": 1})
                after = self.evaluate("document.querySelector('#assistantPanel').getBoundingClientRect().width")
                self.report.check(after > before, f"{width} pointer resize increases width")
                timings.append(round((time.perf_counter() - started) * 1000, 1))
                self.evaluate("document.querySelector('#assistantResizeHandle').focus(); for(let i=0;i<100;i++){for(const key of ['ArrowRight','ArrowDown']) document.querySelector('#assistantResizeHandle').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));} true")
                size = self.evaluate("(()=>{const r=document.querySelector('#assistantPanel').getBoundingClientRect();return [r.width,r.height]})()")
                self.report.check(size == [480, 420], f"{width} keyboard minimum 480x420", str(size))
                self.report.check(self.evaluate("document.activeElement.id==='assistantResizeHandle'"), f"{width} keyboard focus retained")
                self.evaluate("for(let i=0;i<100;i++){for(const key of ['ArrowLeft','ArrowUp']) document.querySelector('#assistantResizeHandle').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));} true")
                self.report.check(self.evaluate("(()=>{const r=document.querySelector('#assistantPanel').getBoundingClientRect();return r.width<=innerWidth*.92+1 && r.height<=innerHeight*.90+1 && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight})()"), f"{width} maximum bounds stay on screen")
                self.capture_screenshot(f"phase4c-resized-{width}x{height}", full_page=False)
                # Restore near-default with the public keyboard resize control.
                self.evaluate("(()=>{const h=document.querySelector('#assistantResizeHandle'),p=document.querySelector('#assistantPanel'); for(let i=0;i<100 && p.getBoundingClientRect().width>700;i++)h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));for(let i=0;i<100 && p.getBoundingClientRect().height>innerHeight*.78;i++)h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));})()")
            else:
                self.report.check(self.evaluate("document.querySelector('#assistantResizeHandle').hidden && document.querySelector('#assistantResizeHandle').disabled"), f"{width} manual resize disabled")
            self.report.check(self.evaluate("(()=>{const p=document.querySelector('#assistantPanel').getBoundingClientRect(),c=document.querySelector('#assistantComposer').getBoundingClientRect();return p.left>=0 && p.top>=0 && p.right<=innerWidth && p.bottom<=innerHeight && c.bottom<=p.bottom})()"), f"{width} composer visible and panel bounded")
            self.report.check(not self.query_requests(mark), f"{width} resize makes zero Assistant requests")
        self.set_viewport(1440, 900)
        print("RESIZE " + json.dumps({"pointer_roundtrip_ms": timings}), flush=True)

    def ui_acceptance(self):
        super().ui_acceptance()
        self.ensure_assistant_open()
        self.report.check(self.evaluate("document.querySelector('#assistantPanel').getBoundingClientRect().width===700"), "default Assistant width 700px")
        self.report.check(self.evaluate("document.querySelector('[data-requires-context=section][data-assistant-question]').disabled===false"), "selected comparison suggestion enabled")
        self.resize_acceptance()

    def ranking_pages_acceptance(self):
        mark = self.page.event_mark()
        before = self.chat_assistant_count()
        timings = []
        for selector, offset in ((".assistant-full-ranking", 0), ("#rankingNext", 25), ("#rankingLast", 3450), ("#rankingPrevious", 3425), ("#rankingFirst", 0)):
            request_mark = self.page.event_mark()
            started = time.perf_counter()
            self.click(selector)
            self.wait_js(f"document.querySelector('#rankingDialog').getAttribute('aria-busy')==='false' && document.querySelector('#rankingRange').textContent.startsWith('Showing {offset+1:,}')", "deterministic ranking page", 30)
            elapsed = round(time.perf_counter() - started, 3)
            request = self.assert_one_request(request_mark, "POST", BACKEND_ORIGIN + "/api/v1/sections/rank/page", "ranking page")
            result = self.response_payload(request['requestId'])
            self.report.check(result['offset'] == offset and result['total_count'] == 3473, "ranking page exact offset/denominator")
            self.report.check(len(result['rows']) == (23 if offset == 3450 else 25), "ranking page bounded size")
            self.report.check(self.evaluate("document.querySelectorAll('#rankingRows tr').length") == len(result['rows']), "all page rows rendered once")
            for row in result['rows']:
                value = self.evaluate(f"featureByCtrl.get('{row['section_id'][3:]}').properties.observed_curve_resilience_score_v0")
                self.report.check(math.isclose(value, row['value'], abs_tol=5.1e-7), "table value matches accepted release")
            timings.append({"offset": offset, "seconds": elapsed})
        self.click("#rankingClose")
        self.report.check(self.evaluate("!document.querySelector('#rankingDialog').open && document.activeElement.classList.contains('assistant-full-ranking')"), "ranking close restores Assistant trigger focus")
        self.report.check(not self.query_requests(mark) and self.chat_assistant_count() == before, "ranking open/paging/close makes zero LLM requests or chat messages")
        print("PAGINATION " + json.dumps(timings), flush=True)

    def live_acceptance(self):
        self.ensure_assistant_open()
        self.set_tier("potential")
        self.select_section("1081")
        cases = (
            ("ranking", "Rank control sections by Tier 3 observed resilience.", "rank_sections"),
            ("section_comparison", "Compare Potential and Observed Resilience for this section.", "compare_section_resilience"),
            ("alignment", "How are Potential and Observed Resilience related statewide?", "summarize_tier_alignment"),
            ("dallas", "How did Dallas County perform compared with the statewide results?", "summarize_county_resilience"),
            ("dallas_pattern", "What stands out about Dallas County in this event?", "summarize_county_resilience"),
            ("concept", "What is Potential Resilience?", "explain_project_concept"),
            ("safety", "Which road should TxDOT rebuild first?", "decline_unsupported_request"),
        )
        for case, prompt, tool in cases:
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
            self.report.check(self.response_for(request['requestId'])['status'] == 200 and payload['status'] == status, f"{case} response contract", payload['status'])
            self.report.check(payload['tools_used'] == [{"tool_name": tool, "call_index": 1}], f"{case} exact tool/control selection")
            visible = self.evaluate("Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).textContent")
            self.report.check(not visible.startswith("The structured"), f"{case} analysis-first visible answer")
            self.report.check(self.evaluate("getComputedStyle(Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1)).fontSize==='18px'"), f"{case} readable answer typography")
            result = payload.get('structured_result')
            if case == "ranking":
                self.report.check(result['distribution']['available_count'] == 3473 and "3,473" in visible and "highest 10 and lowest 10" in visible, "ranking complete eligibility and bounded tails explicit")
                self.report.check(not any(token in visible.casefold() for token in ('investment', 'treatment', 'not predictive')), "normal ranking excludes irrelevant disclaimers")
                self.ranking_pages_acceptance()
            elif case == "section_comparison":
                self.report.check(result['identity']['display_cs_id'] == 'CS_1081' and result['classification'] is None and result['relative_position'] != 'unavailable', "section comparison current host ID and no invented classification")
                self.report.check(all(token in visible for token in ('CS_1081','Percentile','dense rank','Common valid-pair')), "comparison evidence and reference scopes visible")
            elif case == "alignment":
                self.report.check(result['valid_pair_count'] == 3473 and abs(result['pearson_r']-.2771701622936432)<1e-9 and abs(result['spearman_rho']-.281802195769399)<1e-9, "unchanged alignment correlations")
                self.report.check(result['classification_status']=='method_definition_required' and result['consistent_count'] is None, "unresolved method retained")
                self.report.check(visible.count("reviewed rule") == 1, "alignment caveat once")
            elif case.startswith("dallas"):
                self.report.check(result['total_sections']==58 and result['observed_support_count']==56 and result['status_counts']['no_observed_support']==2, "Dallas exact support counts")
                self.report.check(all(token in visible for token in ('Q1', 'Q3', 'statewide median', 'Notable sections')), "Dallas distribution, references, extremes visible")
                self.report.check(visible.count('56 have Tier 3 support') == 1, "Dallas coverage once")
            elif case == "safety":
                self.report.check(payload['evidence'] == [] and result is None, "investment decline has no data evidence")
            self.prompt_results.append(PromptResult(case,status,payload['intent'],tool,result['result_type'] if result else None,elapsed))
            print('CASE ' + json.dumps(asdict(self.prompt_results[-1])), flush=True)


def main():
    args = parse_args()
    verify_frontends_available()
    if args.scenario == 'live':
        verify_live_backend()
    artifacts = create_artifact_directory(args.output_dir)
    report = QAReport()
    with IsolatedChrome(args.chrome, args.isolated_profile) as chrome:
        qa = Phase4CBrowserQA(chrome, report, artifacts)
        run_stage('Phase 4B preservation and Assistant resize', qa.ui_acceptance)
        run_stage('V2 coexistence', qa.simultaneous_v2_v3_acceptance)
        if args.scenario == 'live':
            run_stage('Phase 4C workflows and full ranking', qa.live_acceptance)
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
