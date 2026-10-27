# Changes

## 1.3.4

- Update `@modelcontextprotocol/sdk` to 1.32.2 and refresh its transitive dependencies (`body-parser`, `fast-uri`, `hono`, `ip-address`) to clear the published advisories.
- Migrate to `zod` 4.6.7 to fix memory exhaustion while validating oversized constrained collections; tool schemas and validation messages are otherwise unchanged.
- A connection lost between connecting and sending now fails with `-32002` and `outcome: not_sent` instead of an unhandled `TypeError`.
- Read the Node request timeout from `timeout_ms` in the config file; `SKETCHUP_TIMEOUT_MS` still takes precedence.
- Quote the Node test glob so POSIX shells cannot silently skip top-level tests.
- Add `npm run version:bump` and a test that keeps every shipped version marker in sync with `package.json`.
- Add Dependabot version updates for npm and GitHub Actions, and an `npm audit` job to CI.

## 1.3.3

- Update the indirect `proxy-addr` dependency from 2.0.7 to 2.0.8 to fix IP spoofing under affected proxy trust configurations (CVE-2026-90711, #2).
- Update the indirect `ip-address` dependency from 10.7.0 to 10.7.3, including fixes for cross-family subnet comparisons and oversized address input handling (#1).

## 1.3.2

- Clarify that multi-instance profile and service names are user-defined labels, and move the acceptance example to neutral project profiles.
- Move the multi-instance QA fixture out of the user setup flow; use generic geometry, configurable profiles and portable configuration paths with `test:multi-instance`.
- Require explicit opt-in and verify both target identities before the QA fixture clears either disposable model.

## 1.3.1

- Restore the previously verified transitive dependency lock for reproducible Linux/macOS `npm ci`.
- Add npm registry retry settings to the compatibility workflow.

## 1.3.0

- Add isolated SketchUp profiles with separate ports, tokens, config files, registry entries, and generated MCP service names.
- Add profile selection in the SketchUp extension menu; port conflicts now produce a recoverable status message instead of a raw startup dialog.
- Add `instance` metadata to bridge and model status so an LLM can confirm the target SketchUp process before editing.
- Add profile-aware setup, diagnostics, agent configuration generation, and duplicate-port validation.
- Add a two-instance acceptance demo and fix integer RGB conversion for SketchUp materials.

## 1.2.0

- Resolve references through parent definitions with consistent local/world transforms; reject ambiguous writes before mutation and enforce locked ancestors.
- Bind edits to the last inspected model and edit context, including queued operations and batches.
- Stop ordinary queries after one page; bound traversal time and report incomplete results explicitly.
- Add path-free view_capture with MCP PNG output and frame nested entities in world coordinates.
- Add one-command setup, complete extension backup and rollback, bilingual diagnostics, and an expanded usage guide.
- Add Ruby behavioral tests and real SketchUp nested/shared/edit-context and 5000-instance performance regressions to the validation workflow.
- Isolate cancellation per connection and retain request IDs in disconnect errors.

## 1.1.0

- Make nested entity paths and world transforms consistent for list, inspect, create, duplicate and group results.
- Add explicit parent path references and shared-component mutation warnings.
- Carry `model_id` through modification, export, selection and batch tool schemas.
- Validate batch subcommands with the same schemas as standalone tools before queueing.
- Return small `view_export` images directly as MCP image content for visual verification.
- Bound large-model entity listing and statistics scans with explicit exactness metadata.

## 1.0.0

- Generate credential-free, absolute-path MCP configuration for ChatGPT/Codex, Claude/Cursor and VS Code with `npm run config:agents`.
- Document macOS installation, official client integration requirements and the distinction between desktop stdio and hosted ChatGPT tools.
- Capability negotiation instead of exact application version matching.
- Authenticated loopback transport, bounded nonblocking I/O, queue deadlines and queued cancellation.
- Generic mesh/extrude, instance paths, materials/tags/scenes/camera, undo/redo, atomic batch, snapshots/diff, image/model export.
- Structured MCP results, annotations, progress and redacted request logs.
- Unified Ruby source; cross-platform installer, doctor and RBZ packaging.
- First public release of the cross-platform SketchUp MCP bridge.
