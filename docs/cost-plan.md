# Costs

- The default setup (phrase parser, SQLite, MCP server, browser page) has no paid dependencies.
- Browser speech recognition may use the browser vendor's cloud service; it isn't a separate paid service.
- The optional language-model mode calls whatever OpenAI-compatible endpoint you configure, billed by that provider. Each command makes up to 4 model calls; caps per session (default 60) and per server run (default 1000) can be changed with `BAHI_MODEL_MAX_CALLS_PER_SESSION` and `BAHI_MODEL_MAX_CALLS`. These are request caps, not a billing cap; set a spending limit with your provider.
- Hosting for Alexa+ needs one small always-on Node 24 instance with a persistent disk and HTTPS. SQLite is a single-writer file, so run one instance.
