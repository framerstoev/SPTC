/* Event narrative only; metric names/cards/plots come from the shared registry/components. */
(function(root){
  "use strict";
  const T=(...args)=>V4Inspector.text(...args);
  function section(host,eyebrow,title,description){const node=T("article","","module-card");node.append(T("p",eyebrow,"eyebrow"),T("h2",title),T("p",description));host.append(node);return node;}
  function about(host){
    section(host,"SPTC / RESEARCH PROGRAM","One network. Different evidence.","Hurricane Beryl, July 2024. Planning/Potential, observed traffic and conditional mobility impact retain distinct scientific roles.");
    section(host,"ATTRIBUTION","Roadway Resilience Explorer","SPTC research project, Texas A&M Transportation Institute, Texas A&M University. TxDOT / PRISM / ERA5 / NHC / NPMRDS-derived research evidence.");
    const link=T("a","Read the documentation","text-action");link.href="./docs.html?event=beryl_2024_07";host.append(link);
  }
  function dataPanel(host,data){
    const n=V4Presentation.counts(data,"texas","potential"),e=data.evidence;
    const coverage=section(host,"PACKAGE / COVERAGE","Texas Study Area","Package-wide source populations; county and metric-specific counts appear under Area.");
    const list=T("dl","","coverage-list");
    for(const [label,value] of [["Study sections",n.sections],["Core Q support",n.coreQ],["Any Q support",n.q],["Candidate B scores",n.phases],["B5 comparison cohort",n.quality],["Economic support",n.economic],["Selected phases overlapping core",e.valid_phases_overlapping_core],["Clock-supported returns",e.clock_contiguous_return_baseline_reference_supported_CS],["Sampling-ambiguous returns",e.recovery_evidence_classes.accepted_row_return_sampling_ambiguous],["Raw censored phases",e.raw_censored_CS],["Continuous phase/onset/return subset",e.entire_detected_phase_clock_contiguous_and_return_supported_CS]])list.append(T("dt",label),T("dd",value.toLocaleString("en-US")));
    coverage.append(list);
    section(host,"OBSERVATION / SCOPE","Event slowdown and period-weather focus","Observation defaults to an event-anchored Slowdown Score, with Minimum Q, Loss Area and Recovery as the other primary choices. The 943 qualified source Scores remain distinct from 1,464 selected episodes. Exploratory Impact Focus highlights period weather plus selected slowdown; Traffic Performance remains separately available in Layers. No causal damage or full physical recovery is inferred.");
    section(host,"HISTORICAL / EXPLORATORY","Full-Period Candidate B retained","3,805 original selected phases over June 17–July 28; only 587 overlap core. Core Mean Q and coverage remain separate. Missing primary support is unavailable, not zero or one; no eligible O1-B phase is not proof of no impact.");
    section(host,"SOURCES / METHODS","Accepted event evidence","B4 Q and Candidate B; B5 PRISM/ERA5/NHC; T2A fixed-reference Network Risk; P2 Potential V1; E2 conditional Economic V1. Source classifications overlap: seven Q0-uncertain cases are also raw-censored; counts are not all additive.");
    section(host,"REFERENCE / LIMITS","Retrospective planning screen","January 1, 2026 network snapshot; mixed AADT 2001-2024 with per-CS years unavailable. Not a historical-2024 reconstruction, prospective prediction or causal model.");
    const item=section(host,"PACKAGE / PROVENANCE",data.manifest.event_id,data.manifest.potential_freeze_id);
    const detail=T("details");detail.append(T("summary","Source windows and method versions"),T("pre",JSON.stringify({methods:data.manifest.method_versions,weather:data.manifest.source_weather_UTC,traffic:data.manifest.core_native_local},null,2)));item.append(detail);
  }
  root.V4Beryl=Object.freeze({about,dataPanel});
})(window);
