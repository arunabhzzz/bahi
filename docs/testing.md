# Testing

```bash
npm test            # Vitest: ledger, corrections, names, parser, tools, analyst, seed, HTTP + MCP transport
npm run test:e2e    # Playwright in Chromium (npx playwright install chromium first)
npm run typecheck
npm run verify:local  # with the server running; writes docs/evidence/live-mcp.json
```

What the suites cover:

- **Ledger:** append-only history, shop isolation, preview/confirm idempotency, expiry and tamper checks, re-validation after unrelated entries, last-stock races, exact paise, historical prices, payment allocation, back-dating and future-date refusal, backup/restore, property tests over random sale/purchase sequences.
- **Corrections:** cash-sale quantity changes with cash returned, customer changes, credit ↔ cash, cancellation, payment corrections, refusal when repaid credit would need a refund.
- **Names and parser:** Hinglish aliases, plurals, spelling slips, ambiguity; spoken and Hindi numbers; sales, payments, corrections, questions and yes/no in natural phrasing.
- **Tools:** each tool has its own description and a strict schema; previews read correctly; errors are sentences the assistant can say back.
- **Analyst:** the planted demo stories are found for all seven weekdays; weekday reports; date resolution in the shop's timezone.
- **Transport/HTTP:** official SDK client negotiation and tool calls, auth/origin/host checks, retries, confirmation binding, rate limits, the full simulator conversation.
- **Browser:** sale → correction → payment → analyst → restock draft, lost responses, unseen-preview protection, speech consent fallbacks, mobile width.

Live microphone quality and the real Alexa+ connection need manual testing.
