# Architecture

## Request path

**With Alexa+:** shopkeeper speaks → Alexa+ (speech, conversation, tool choice) → `POST /mcp` (Streamable HTTP, bearer token) → official `McpServer` → tool in `apps/server/src/mcp/tools.ts` → domain ledger (`packages/domain`) or analyst (`packages/analytics`) → SQLite.

**With the browser simulator:** text or browser speech → `/api/command` → phrase parser or optional language model → official MCP `Client` → the same `POST /mcp` over loopback → same tools. The simulator never writes to the ledger directly; it only reads ledger state to draw the side panel.

## Ledger

One `events` table per shop, append-only (update/delete triggers abort). Current state (stock, balances, receivables, drafts, revenue, cash received) is rebuilt by replaying events (`applyEvent`), cached per shop and extended incrementally.

- Money is integer paise; quantities are milli-units (1000 = 1 kg or 1 packet). Packets and pieces must be whole.
- A write is `preview` (validated, stored as an operation with a hash and 5-minute expiry) then `confirm` (in `BEGIN IMMEDIATE`). If other entries happened in between, the payload is re-validated and must come out identical; otherwise the shopkeeper gets a fresh preview. Confirming twice returns the same receipt.
- `correct_entry` writes one event that reverses the original sale and applies the replacement: different items or quantities, a different customer, credit ↔ cash, a different amount paid (the cash difference is recorded and read back, e.g. "give back ₹48"), or cancellation. Corrections chain; the original stays in history. A correction that would need a refund of credit already repaid is refused.
- `correct_payment` changes or cancels a payment and re-allocates it to the customer's oldest bills.
- Sales, purchases and payments can be back-dated ("yesterday") but not dated in the future.

## Names

`packages/domain/src/names.ts` resolves what was said to one catalogue item or customer: id → exact (case and plural insensitive) → the item's own aliases → built-in Hindi/Hinglish words (cheeni, chawal, doodh, anda…) → a word of a longer name ("dal" → Toor Dal) → close spelling. More than one match is an error that lists the candidates.

## Analyst

All in `packages/analytics/src`, computed from final (post-correction) sales:

- `explain_sales_change`: the day vs. the average of the same weekday over the previous 4 weeks; per-item and per-customer gaps; a stock timeline in business time detects stock-outs and when they happened; regular customers who didn't come are named.
- `low_stock_forecast`: per-item demand by weekday (last 4 weeks), projected from current stock; flags items that run out before the supplier lead time.
- `credit_risk`: ages each customer's unpaid bills; flags growing balances with no recent payment.
- `dead_stock`, `sales_report` (per day / item / customer / weekday, with chart data), `daily_summary` (with a comparison day; for today, compared up to the same time of day).
- `restock-plan.ts`: budget-constrained restock proposal covering lead time + 2 days of recent demand, most urgent first, never reordering items with no recent sales.

## Transport

MCP TypeScript SDK 1.32.1, protocol 2025-11-25, stateless Streamable HTTP with JSON responses; `GET /mcp` returns 405. The server sends usage instructions in the MCP `initialize` response, and each tool has its own description and strict input schema.
