# Changes

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
