# Publishing & Extension Signing Guide

This guide covers publishing `@ringo/sketchup-mcp` to npm, creating tagged GitHub Releases with `.rbz` artifacts, and signing the SketchUp `.rbz` extension for SketchUp's default extension loading policy.

## 1. Preparing a Release

1. Update [CHANGELOG.md](../CHANGELOG.md) with a `## X.Y.Z` heading.
2. Synchronize all shipped version markers:
   ```sh
   npm run version:bump -- X.Y.Z
   ```
3. Run the full pre-release verification suite:
   ```sh
   npm run check
   npm run test:coverage
   npm run check:ruby
   npm run test:ruby
   npm audit --omit=dev --audit-level=high
   npm run package:rbz
   npm pack --dry-run
   ```

## 2. Tag-Triggered GitHub Release

Pushing a version tag (`vX.Y.Z`) triggers [.github/workflows/release.yml](../.github/workflows/release.yml), which:

- Verifies the tag matches `package.json`.
- Runs Node checks, Ruby syntax/contract tests, dependency audit, and builds `release/ringo-sketchup-mcp-X.Y.Z.rbz` + `.sha256`.
- Extracts the matching section from `CHANGELOG.md` via `scripts/release-notes.mjs` and creates a GitHub Release attaching the `.rbz` and SHA-256 files.
- Publishes `@ringo/sketchup-mcp` to npm automatically when `NPM_TOKEN` is configured in repository secrets.

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 3. Manual npm Publish

If publishing manually from a maintainer workstation:

```sh
npm login
npm pack --dry-run
npm publish --access public
```

Once published, end users can install without cloning the repository:

```sh
npx @ringo/sketchup-mcp setup
```

## 4. SketchUp RBZ Signing & Extension Warehouse

SketchUp's default Extension Loading Policy (**Approve Identified Extensions** / **Identified Extensions Only**) warns when loading unsigned `.rbz` packages. Digital signatures (`.susig` / `extension_info.txt`) can only be issued by Trimble's signing infrastructure using a registered Extension Developer account—this cannot be generated offline or in an unauthenticated CI job.

### Signing Workflow

1. Build the unsigned package cleanly:
   ```sh
   npm run package:rbz
   ```
   The generated archive at `release/ringo-sketchup-mcp-X.Y.Z.rbz` contains:
   - `ringo_sketchup_mcp.rb` (top-level `SketchupExtension` loader)
   - `ringo_sketchup_mcp/` (`config.rb`, `geometry.rb`, `main.rb`, `operations.rb`, `references.rb`, `scene.rb`, `server.rb`, `view.rb`, `LICENSE`)
   - Note: keep `extension/extension.json` synchronized (already handled by `npm run version:bump`).
2. Sign in with a Trimble Extension Developer account at the [SketchUp Extension Signing Portal](https://extensions.sketchup.com/extension/sign) and upload `release/ringo-sketchup-mcp-X.Y.Z.rbz`.
3. Download the signed `.rbz`, generate its SHA-256 checksum, and attach the signed `.rbz` (or submit it to the SketchUp Extension Warehouse) alongside the release.
4. Before distributing a signed `.rbz`, test installation via **Extensions → Extension Manager → Install Extension** on a clean SketchUp profile with **Identified Extensions Only** enabled, then run `npx @ringo/sketchup-mcp doctor --plugins "<PluginsPath>"`.
