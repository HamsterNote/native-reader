# Spec Delta

## MODIFIED Requirements

### Requirement: Reproducible reader chrome acceptance
The repository SHALL document a runnable Web acceptance path using its committed Demo, with setup prerequisites, startup command, local URL and deterministic redistributable samples for a long title, scrollable nested TOC, single-chapter multiple pages, multiple long chapters and fixed-layout navigation. The path SHALL use the public reader package and SHALL not depend on an uncommitted temporary shell or a privately supplied book. Documentation SHALL provide expected outcomes for drawer and settings visibility, focus containment/restoration, Escape/backdrop dismissal, background iframe isolation, final TOC entry reachability, successful versus unresolved TOC navigation, page and book boundaries, both reading flows, confirmed flow/status and fixed-layout fallback, 679/680 container breakpoint, 44-pixel targets, responsive widths, title truncation, minimum body height, source replacement and error states. Browser evidence SHALL cover 1440/390/320 viewport widths and a separate embedded 320-pixel reader. Automated tests SHALL exercise page protocol success, boundary no-op, serialization, stale confirmation and terminal timeout/failure. Native shared-chrome checks SHALL distinguish component/layout and local protocol evidence from actual device rendering evidence and preserve existing platform support and acceptance limits.

#### Scenario: Reviewer follows documented entry
- **WHEN** a reviewer follows clean-checkout setup and starts the committed Web Demo
- **THEN** the documented local URL permits selecting repository samples and inspecting the shared reader chrome, drawer and settings without reconstructing a temporary screenshot shell

#### Scenario: Reviewer completes chrome checks
- **WHEN** the reviewer follows the checklist at wide and narrow viewport and reader-container widths using documented samples
- **THEN** the reviewer can assess initial closure, drawer/settings focus and dismissal, iframe input blocking, TOC outcomes, Paginated page movement and zero wheel displacement, Scrolled direct readable-chapter stepping and native scrolling, confirmed flow-specific boundaries, title truncation, 240-pixel underlying viewport, unchanged renderer identity, replacement and error recovery with explicit expected outcomes

#### Scenario: Toolbar gap is measured in Chromium
- **WHEN** the reviewer compares the committed Demo before and after the layout revision at wide and narrow widths
- **THEN** recorded chrome height, visible body height and toolbar-to-first-reading-text distance identify the removed empty status row and renderer margin, while the final toolbar/body join has zero added gap and retains publication-authored spacing

#### Scenario: Browser focus behavior is verified
- **WHEN** modal focus, Tab/Shift+Tab cycling, Escape/backdrop dismissal and background iframe isolation are accepted
- **THEN** evidence includes actual browser interaction and geometry/screenshots, and jest mocks or native bundle success alone are not represented as behavioral proof

#### Scenario: Protocol or generated assets are changed
- **WHEN** page navigation is implemented across Web and native adapters
- **THEN** runtime staging and consumer sync checks, closed-schema and shared-wire-corpus tests, current-command confirmation, stale events, boundary no-op and terminal timeout tests pass against matching generated assets before the change is accepted

#### Scenario: Native modal evidence is reported
- **WHEN** native drawer/settings implementation is reviewed
- **THEN** local platform-container compatibility checks use the secure host, component tests check Modal close/accessibility wiring, and the report explicitly marks Android/iOS device behavior unverified and makes no hardware-keyboard containment claim under RN 0.86.3 default feature flags
