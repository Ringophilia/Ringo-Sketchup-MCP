# Contributing

Everyone is welcome to report bugs, suggest features, improve documentation,
and submit pull requests. Fork the repository, create a branch, and describe
the problem and your change in a pull request.

For bug reports, include your operating system, SketchUp version, Node.js
version, reproduction steps, and the error message. Remove tokens, private
model data, and personal paths from logs. Report vulnerabilities using the
private reporting link in [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run check
npm run check:ruby
npm run package:rbz
```

Ruby syntax checks require Ruby on PATH. Live tests require desktop SketchUp
and the extension; use a disposable model for integration testing. See
[validation notes](docs/validation.md) for the scope of existing checks.

Keep modeling features generic. Prefer existing geometry tools and the Ruby
API over commands tied to a particular object. Preserve loopback-only
transport, authentication, and opt-in Ruby evaluation.

Generated models, renders, logs, local credentials, and build outputs must
stay out of commits. Save local validation output under `artifacts/`.

Contributions are provided under the project's [MIT License](LICENSE).
