# Spec Delta

## ADDED Requirements

### Requirement: Reproducible reader chrome acceptance
The repository SHALL document a runnable Web acceptance path using its committed Demo, with setup prerequisites, startup command, local URL and deterministic redistributable samples for a long title and scrollable nested TOC. The path SHALL use the public reader package and SHALL not depend on an uncommitted temporary shell or a privately supplied book. Documentation SHALL provide a manual interaction checklist for contents visibility/scrolling, chapter boundaries, reading-flow selection/status, responsive widths, title truncation, minimum body height, source replacement and error states. Native shared-chrome checks SHALL distinguish component/layout evidence from actual device rendering evidence and preserve existing platform support limits.

#### Scenario: Reviewer follows documented entry
- **WHEN** a reviewer follows clean-checkout setup and starts the committed Web Demo
- **THEN** the documented local URL permits selecting repository samples and inspecting the actual shared reader chrome without reconstructing the screenshot shell

#### Scenario: Reviewer completes chrome checks
- **WHEN** the reviewer follows the checklist at wide and narrow reader widths using the documented samples
- **THEN** the reviewer can assess long-title truncation, initially hidden TOC, toggle and final TOC entry reachability, chapter boundaries, confirmed flow, fixed-layout fallback, viewport height, replacement and error recovery with explicit expected outcomes
