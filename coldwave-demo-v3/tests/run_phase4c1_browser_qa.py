"""Phase 4C1 production-page QA using the unchanged isolated browser lifecycle."""

import json
import time
from dataclasses import asdict

from run_phase4c_browser_qa import (
    Phase4CBrowserQA,
    ASSISTANT_QUERY_URL,
    BrowserQAError,
    IsolatedChrome,
    PromptResult,
    QAReport,
    VIEWPORTS,
    create_artifact_directory,
    latency_summary,
    parse_args,
    run_stage,
    sanitized_error,
    verify_frontends_available,
    verify_live_backend,
)

JARGON = (
    "dense rank",
    "common-valid-pair",
    "eligible population",
    "classification_status",
    "method_definition_required",
    "structured county summary",
    "structured ranking",
    "percentile",
)


class Phase4C1BrowserQA(Phase4CBrowserQA):
    def live_acceptance(self):
        self.ensure_assistant_open()
        self.set_tier("potential")
        self.select_section("1081")
        cases = (
            (
                "safety",
                "Which road should TxDOT rebuild first?",
                "decline_unsupported_request",
            ),
            (
                "framework",
                "What do Tier 1, Tier 2, and Tier 3 mean?",
                "explain_project_concept",
            ),
            ("potential", "What is Potential Resilience?", "explain_project_concept"),
            ("technical", "Show me the exact calculation.", "explain_project_concept"),
            (
                "comparison",
                "Compare planning and observed performance for this road.",
                "compare_section_resilience",
            ),
            (
                "why",
                "Why did this road perform worse than its planning score suggests?",
                "compare_section_resilience",
            ),
            (
                "county",
                "How does Dallas County compare with other Texas counties?",
                "rank_counties",
            ),
            (
                "county_ranking",
                "Rank Texas counties by Tier 3 resilience.",
                "rank_counties",
            ),
            (
                "ranking",
                "Rank control sections by Tier 3 observed resilience.",
                "rank_sections",
            ),
            (
                "alignment",
                "How are Potential and Observed Resilience related statewide?",
                "summarize_tier_alignment",
            ),
            ("dallas", "How did Dallas County perform?", "summarize_county_resilience"),
        )
        for case, prompt, tool in cases:
            before = self.chat_assistant_count()
            context = self.chat_controller_state()
            mark = self.page.event_mark()
            started = time.perf_counter()
            self.set_chat_input(prompt)
            self.click("#assistantSend")
            self.wait_js(
                f"!assistantChatController.getState().pending && document.querySelectorAll('[data-result-kind=ai-assisted]').length>{before}",
                case,
                120,
            )
            elapsed = round(time.perf_counter() - started, 3)
            request = self.assert_one_request(mark, "POST", ASSISTANT_QUERY_URL, case)
            self.assert_request_context(request, prompt, context, case)
            payload = self.response_payload(request["requestId"])
            status = "unsupported_request" if case == "safety" else "completed"
            self.report.check(
                self.response_for(request["requestId"])["status"] == 200
                and payload["status"] == status,
                f"{case} response contract",
                payload["status"],
            )
            self.report.check(
                payload["tools_used"] == [{"tool_name": tool, "call_index": 1}],
                f"{case} exact tool",
            )
            visible = self.evaluate(
                "Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).querySelector('.assistant-chat-answer').innerText"
            )
            if case != "technical":
                self.report.check(
                    not any(term in visible.casefold() for term in JARGON),
                    f"{case} no default implementation jargon",
                )
            self.report.check(
                self.evaluate(
                    "getComputedStyle(Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1)).fontSize==='18px'"
                ),
                f"{case} readable answer typography",
            )
            result = payload.get("structured_result")
            if case == "technical":
                self.report.check(
                    "robust_minmax" in visible and "0.65" in visible,
                    "technical follow-up exact Potential formula",
                )
            if case in {"comparison", "why"}:
                self.report.check(
                    result["identity"]["display_cs_id"] == "CS_1081"
                    and result["classification"] is None,
                    "comparison selected ID and no mismatch class",
                )
                self.report.check(
                    result["potential"]["statewide_distribution"]["available_count"]
                    == result["observed"]["statewide_distribution"]["available_count"]
                    == result["paired_sample_reference"]["valid_pair_count"],
                    "same comparison group",
                )
                self.report.check(
                    "Higher than about" in visible
                    and "raw values are not subtracted" in visible,
                    "plain percentage and distinct scales",
                )
            if case.startswith("county"):
                self.report.check(
                    result["result_type"] == "county_ranking"
                    and result["total_counties"] <= 254,
                    "county-vs-county bounded result",
                )
                if case == "county":
                    target = next(
                        row for row in result["rows"] if row["county"] == "Dallas"
                    )
                    self.report.check(
                        target["total_sections"] == 58
                        and target["observed_support_count"] == 56
                        and str(target["county_rank"]) in visible,
                        "Dallas rank and accepted support",
                    )
                details_mark = self.page.event_mark()
                self.evaluate(
                    "Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).querySelector('details').open=true"
                )
                self.report.check(
                    not self.api_requests(details_mark),
                    "all counties expand without any API/model request",
                )
                self.evaluate(
                    "Array.from(document.querySelectorAll('[data-result-kind=ai-assisted]')).at(-1).querySelector('details').open=false"
                )
            if case == "ranking":
                self.ranking_pages_acceptance()
            if case == "alignment":
                self.report.check(
                    result["valid_pair_count"] == 3473
                    and abs(result["pearson_r"] - 0.2771701622936432) < 1e-9,
                    "unchanged alignment numbers",
                )
                self.report.check(
                    result["classification_status"] == "method_definition_required"
                    and result["consistent_count"] is None,
                    "unresolved alignment remains unresolved",
                )
            if case == "dallas":
                self.report.check(
                    result["total_sections"] == 58
                    and result["observed_support_count"] == 56,
                    "Dallas summary support",
                )
                self.report.check(
                    "County position" in visible
                    and visible.count("56 have traffic observations") == 1,
                    "Dallas simple county benchmark and coverage once",
                )
            if case == "safety":
                self.report.check(
                    payload["evidence"] == [] and result is None,
                    "decline has no invented evidence",
                )
            self.prompt_results.append(
                PromptResult(
                    case,
                    status,
                    payload["intent"],
                    tool,
                    result["result_type"] if result else None,
                    elapsed,
                )
            )
            print("CASE " + json.dumps(asdict(self.prompt_results[-1])), flush=True)


def main():
    args = parse_args()
    verify_frontends_available()
    if args.scenario == "live":
        verify_live_backend()
    artifacts = create_artifact_directory(args.output_dir)
    report = QAReport()
    with IsolatedChrome(args.chrome, args.isolated_profile) as chrome:
        qa = Phase4C1BrowserQA(chrome, report, artifacts)
        run_stage("Phase 4B/4C layout and resize preservation", qa.ui_acceptance)
        run_stage("V2 coexistence", qa.simultaneous_v2_v3_acceptance)
        if args.scenario == "live":
            run_stage("Phase 4C1 novice and county workflows", qa.live_acceptance)
        screenshots = run_stage(
            "six viewports with county answer", qa.viewport_acceptance
        )
        if args.scenario == "live":
            run_stage(
                "cancellation and stale protection",
                qa.cancellation_and_stale_acceptance,
            )
            run_stage("deterministic quick actions", qa.fixed_actions_acceptance)
        network = run_stage("console and network", qa.final_console_network_acceptance)
    print(
        "SUMMARY "
        + json.dumps(
            {
                "checks": len(report.checks),
                "viewports": len(VIEWPORTS),
                "screenshots": screenshots,
                "artifact_directory": str(artifacts),
                "latency": latency_summary(qa.prompt_results),
                **network,
                "overall_pass": True,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrowserQAError as error:
        print("ERROR: " + sanitized_error(error))
        raise SystemExit(1) from None
