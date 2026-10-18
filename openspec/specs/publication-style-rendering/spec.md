# publication-style-rendering Specification

## Purpose
Preserve publication author and Foliate renderer CSS semantics under the shared publication content security policy while retaining script, network and host isolation.

## Requirements

### Requirement: Author and renderer styles take effect under publication policy
Under the `publication` policy defined in `packages/native-reader/src/foliate-csp-policy.json`, book-authored style attributes, book-authored style elements and Foliate's actual pagination styles SHALL affect computed style and layout in the real publication document. Reader layout/style updates SHALL remain effective after opening and reopening. Any inline-style permission SHALL be confined to publication `style-src`; publication `script-src 'none'`, `connect-src 'none'`, and all other existing directive restrictions SHALL remain unchanged. No host or publication script capability SHALL be added. This scope SHALL NOT modify WebBase, publish npm packages, create tags/releases, open unnecessary PRs or change the Foliate submodule pin.

Implementation evidence and approved correction (HAM-53 comment `01a14e79-7ca3-7697-8b9d-98cb33738641`): pinned paginator.js creates empty style elements at line 979; setStyles at line 1100 has no CSS caller in this reader. Its real layout effects use element style attributes, including line 325. Thus option A verifies real effects; option B, adding a production stylesheet just for acceptance, is excluded. No test CSS may be injected.

#### Scenario: Author styles survive opening and reopening
- **GIVEN** a local EPUB containing a paragraph with `style="color: rgb(17, 34, 51)"` and another paragraph whose author style element sets `font-style: italic`
- **WHEN** an independent consumer opens, closes and reopens this same book without page reload
- **THEN** on each open the actual publication frame reports computed color `rgb(17, 34, 51)` for the first paragraph and computed font style `italic` for the second, without test-injected CSS

#### Scenario: Foliate injected style and updates work
- **GIVEN** the same book is rendered under the publication policy
- **WHEN** the renderer applies its real pagination styles and then a supported flow/layout update
- **THEN** renderer-owned style properties are reflected in computed style and pagination geometry, the update changes the expected layout, and both assertions also pass after reopening without test-injected CSS

#### Scenario: Author assertions detect the policy change
- **WHEN** a local differential run temporarily removes only publication style-src's `'unsafe-inline'` from an isolated exported runtime, leaving repository policy and generated artifacts untouched
- **THEN** author inline-style assertions fail; restoring the normal runtime passes, and commands plus before/after results are recorded in verification.md

#### Scenario: Styles do not authorize scripts or remote resources
- **GIVEN** a separate adversarial publication containing scripts, event handlers, remote stylesheet imports and CSS URLs referencing same-origin and cross-origin HTTP(S) resources
- **WHEN** it is rendered with the updated policy in security regression tests
- **THEN** author scripts and handlers do not execute, remote resources do not reach the HTTP(S) server, and no host bridge capability or external navigation is acquired; expected browser rejections in this negative test are not reused as default-consumer zero-error evidence
