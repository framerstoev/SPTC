# Future Statewide Overview Architecture

> Future concept only. Phase 3J does not add an Overview interface, statewide
> analytics, global AI capability, or new backend tools.

## View seam

The current production page is explicitly the `Explorer` view. The root
`[data-application-shell]` contains a shared application header and
`#appViewHost`; the current `#explorerView[data-app-view="explorer"]` is one
view inside that host. A future, reviewed Overview can be introduced as a
sibling view and real navigation can be inserted in the shared header. Until
that view exists, there is deliberately no Overview button, empty panel, or
placeholder chart.

The existing Explorer remains map-centered section analysis: search, map-layer
selection, selected-section evidence, Q(t), Tier 1/2 context, methods, and the
optional floating Assistant. A future Overview could present reviewed counts;
support/status, resilience, recovery, warning, and coverage distributions; and
a descriptive statewide summary. Moving the map-layer selector into the map is
also a possible later refinement, not part of Phase 3J.

## Deterministic aggregate boundary

Future network-level answers must be grounded in allowlisted, deterministic
aggregate tools. Those tools should return structured evidence, warnings,
limitations, release and method metadata, and explicit denominators and null
handling. An LLM may explain those results but must not calculate or invent the
aggregates itself.

Candidate tool names are:

- `get_network_summary`
- `count_sections_by_status`
- `summarize_metric_distribution`
- `summarize_support_coverage`
- `summarize_by_district`

All five names are unimplemented, unregistered, inactive, and unavailable to
the current Assistant. Phase 3J does not enable the existing filter or rank
tools, expose unrestricted SQL or raw files, or send all 10,029 section records
to the model. Prediction, causal inference, optimization, treatment selection,
investment recommendations, and investment ranking remain outside scope.

Potential future questions, after contracts and validation exist, include:

- How many sections have observed curve support?
- How common is censored recovery?
- What does the statewide resilience distribution look like?
- How does observed support vary across the network?
- How do districts differ descriptively?

## Decisions still required

District aggregation is unresolved. The current frontend GeoJSON has no
canonical district field, so a reviewed source, definition, and public-serving
decision are required before `summarize_by_district` can receive a contract.
Aggregate denominators, missing-value treatment, applicability by detection
status, disclosure thresholds, and release/method/timezone metadata also need
explicit review before implementation.

Conversational paraphrase robustness remains deferred. It must not be bundled
into future Overview routing, prompt, or tool work without a separate review.
