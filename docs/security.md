# Security and trust model

Bahi is a hackathon demo, not a production accounting service.

- **Binding:** loopback (`127.0.0.1`) by default. `BAHI_HOST=0.0.0.0` is for hosting behind HTTPS.
- **Host/Origin:** requests must carry `localhost`/`127.0.0.1` or a host listed in `BAHI_PUBLIC_URL`/`BAHI_ALLOWED_HOSTS` (DNS-rebinding protection). A mismatched `Origin` is refused. No permissive CORS.
- **Auth:** every `/mcp` and `/api` call needs a bearer token that maps to exactly one shop. Browser demo tokens are random and expire after 24 hours. The Alexa+ connector token (`BAHI_CONNECTOR_TOKEN`, 32+ characters) is long-lived; treat it like a password. There is no OAuth account linking yet.
- **Writes need a yes:** every change is a preview first. In the simulator, the confirm button and typed yes/haan send the id of the preview on screen, so a preview the shopkeeper never saw can't be confirmed. The optional language model can't call `confirm_operation` at all. Over MCP, the server instructions and the tool description tell the assistant to confirm only after the shopkeeper's yes.
- **History:** events can't be updated or deleted through SQLite (triggers). Someone with direct file access can still change the database.
- **Input limits:** 32 KiB bodies, 1000-character commands, 80-character names, 30 lines per entry, bounded amounts, strict schemas (unknown fields rejected, e.g. a forged shop id or a computed total).
- **Rate limits:** 30 new sessions/minute per address, 600 requests/minute per token, one simulator command at a time per token. In memory; reset on restart.
- **Language model (optional):** off by default. Endpoint must be HTTPS (or local http). Calls capped per session and per run; these are request caps, not a billing cap.
- **Privacy:** synthetic data only. Browser speech may send audio to the browser vendor; Bahi stores no audio. Customer balances can be hidden on a shared screen.
- **Secrets:** `.env`, databases and `data/demo-session.json` are git-ignored. Don't publish backups.
