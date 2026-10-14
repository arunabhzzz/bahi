# Integration notes

- MCP TypeScript SDK 1.32.1, protocol 2025-11-25, stateless Streamable HTTP with JSON responses.
- The browser simulator uses the official MCP client against the server's own `/mcp` endpoint, so the same tool surface is exercised as an external client would see it.
- Browser speech is optional and consent-gated; typing always works.
- npm workspaces (no pnpm); Node's built-in SQLite (no separate database service).
- Not yet exercised: a real Alexa+ connection, OAuth account linking, public HTTPS hosting.
