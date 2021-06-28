# core_process

This is a sidecar server which runs alongside the CLI
and/or desktop app, communicating with the remote EnvKey
backend server.

The core_process runs:
- an express server on port 19047 or `-p <integer>` 
- a web socket server on port 19048 or `-wsp <integer>`

## Integration with UI development

When running build:watch on the UI locally, it will output its
bundle to be served by this core_process off the express server
at http://localhost:19047/envkey-ui
