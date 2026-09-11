# Security Policy

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/Ringophilia/Ringo-Sketchup-MCP/security/advisories/new) to report a suspected
vulnerability. Include the affected version, operating system, SketchUp
version, reproduction steps, and any relevant logs with secrets removed.

Do not publish credentials, configuration files, or exploit details in a
public issue.

## Security notes

The bridge listens on the local loopback interface and authenticates each
request. Ruby evaluation is disabled by default. Enable it only for trusted
MCP clients because evaluated Ruby has access to the SketchUp API and the
local machine through the host process.
