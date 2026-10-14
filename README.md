# Bahi

**A talking account book (bahi-khata) for small shops, built as an MCP server for Alexa+.**

A shopkeeper's hands are busy with goods and cash. Bahi lets them run the books by voice: record sales and credit (udhaar), fix mistakes, check stock, and ask why business changed. Alexa+ handles speech and conversation. Bahi holds the shop's private data, does every calculation in code, and keeps an append-only ledger so totals can't drift.

> "Sold three rice and two sugar to Ramesh, he paid fifty."
> *"Sale to Ramesh: 3 kg Rice ₹180, 2 kg Sugar ₹96. Total ₹276; paid ₹50, ₹226 on credit. Shall I record it?"*
> "Haan." → *"Recorded. Rice now 37 kg, Sugar now 13 kg. Ramesh owes ₹226."*
>
> "Why were sales down on Tuesday?"
> *"Tuesday 13 Oct: sales were ₹995, 59% down on a usual Tuesday (₹2,439). Two reasons: Ramesh, who usually spends about ₹1,350 on Tuesdays, didn't buy anything; and Sugar ran out around 11:20 am."*

## What Alexa+ gains from Bahi

| Alexa+ can't do this alone | Bahi |
|---|---|
| See private shop data | Stock, sales, credit and purchases for one shop, in SQLite |
| Take real actions | Sales move stock; credit changes balances; every change is previewed and confirmed |
| Do exact maths | Integer paise and milli-units, computed in code; the model only narrates |
| Remember across days | Five weeks of history drive the analyst |

## The MCP tools

Tools take names as spoken ("cheeni", "chawal", "ramesh"), money in rupees and quantities in the item's own unit. The server matches names, including Hindi/Hinglish aliases and small spelling slips, and asks when a name is ambiguous ("oil could be Mustard Oil or Hair Oil"). Every result includes a short `say` sentence to read aloud.

| Group | Tools |
|---|---|
| Record (preview first) | `record_sale`, `record_payment`, `record_purchase`, `add_item`, `add_customer`, `set_price`, `configure_shop` |
| Fix | `correct_entry` (quantity, items, customer, amount paid, or cancel), `correct_payment` |
| Commit | `confirm_operation` (only after the shopkeeper says yes), `discard_operation` |
| Look up | `check_stock`, `who_owes`, `recent_entries`, `daily_summary` (with comparison day) |
| Analyst | `explain_sales_change`, `low_stock_forecast` (day-of-week), `credit_risk`, `dead_stock`, `sales_report` (chart data) |
| Restock | `plan_restock`, `revise_plan`, `save_order_draft`, `receive_order`, `cancel_order_draft` |

Writes are two-step on purpose: a write tool returns a preview and an operation id, and nothing is saved until `confirm_operation`. Confirming twice returns the same receipt, so a retried call can't double-record a sale. A preview stays valid while unrelated entries happen; if prices, stock or balances change in a way that alters it, confirming fails and asks for a fresh preview.

## Run it locally

Needs Node 24+ (built-in SQLite). Tested versions are pinned in `package-lock.json` and `.nvmrc`.

```bash
npm ci
npm test              # Vitest suite
npm run dev           # http://127.0.0.1:4317
```

The browser page is an **Alexa+ simulator**: type or speak, and it calls the real MCP server over Streamable HTTP. Each visitor gets an isolated synthetic shop ("Sharma General Store") with 14 items, 6 customers and five weeks of history. Things to try:

```text
Sold 2 kg cheeni to Ramesh, he paid 30        → yes
No, that was 1 kg                             → haan
That was Meena, not Ramesh                    → yes
Ramesh ko do kilo cheeni, sau rupaye diye     (₹4 change)
Meena paid two hundred · no, Meena paid 100 not 200
Who owes me money? · how much rice do I have?
What's running low? · how long will sugar last?
Why were sales down on Tuesday? · who's a credit risk?
Which items are not moving? · show me last month by item
How was today compared with last Saturday?
Got 20 kilos of sugar for 900 rupees
Plan budget 2000 reserve 500 · leave out biscuits · save it
```

**Two language modes:**

- **Built-in phrase parser** (default, free, offline): handles everyday English and Hinglish shop talk, including spelled-out and Hindi numbers ("do sau", "dedh kilo").
- **Language model** (optional, closest to Alexa+): set `BAHI_MODEL_ENABLED=true`, `BAHI_MODEL_URL` (an OpenAI-compatible `/chat/completions` endpoint), `BAHI_MODEL_KEY` and `BAHI_MODEL_NAME`. The model gets the real MCP tool list and calls tools through the MCP client. It can preview but never confirm; "yes" always comes from the shopkeeper. Calls are capped per session and per run (`BAHI_MODEL_MAX_CALLS_PER_SESSION`, `BAHI_MODEL_MAX_CALLS`).

## Connect it to Alexa+

1. Host it behind HTTPS (any Node 24 host with a persistent disk for `data/`).
2. Set the environment:
   ```bash
   BAHI_HOST=0.0.0.0
   BAHI_PUBLIC_URL=https://your-host.example.com
   BAHI_CONNECTOR_TOKEN=<random string, 32+ characters>   # e.g. openssl rand -hex 32
   BAHI_TRUST_PROXY=true                                  # if behind a proxy
   NODE_ENV=production
   ```
   On first start, the connector token gets its own shop, seeded with the demo data (`BAHI_CONNECTOR_SEED=false` for an empty shop).
3. Point Alexa+ (or any MCP client) at `https://your-host.example.com/mcp` with the header `Authorization: Bearer <BAHI_CONNECTOR_TOKEN>`.
4. Check it from your machine: `BAHI_URL=https://your-host.example.com BAHI_TOKEN=... npm run check:mcp`.

Not built yet: OAuth account linking. If the Alexa+ developer flow requires OAuth instead of a bearer header, that is the next piece to add.

## How it's built

- `packages/domain`: append-only event ledger (SQLite triggers block edits and deletes), preview/confirm, corrections, server-side name matching.
- `packages/analytics`: the analyst: weekday baselines, stock timeline and stock-out detection, credit ageing, dead stock, reports, restock planner.
- `apps/server/src/mcp`: the MCP tool surface (`tools.ts`) and SDK registration (`server.ts`).
- `apps/server/src/agent`: the simulator's phrase parser, optional model loop, and MCP client.
- `apps/web`: the simulator page: conversation, previews, analyst cards with charts, and a stock/credit side panel.

Details: [architecture](docs/architecture.md), [security](docs/security.md), [limitations](docs/limitations.md), [demo data](docs/demo-data.md), [demo script](docs/demo-script.md), [testing](docs/testing.md).

## Scripts

```bash
npm test                 # all Vitest tests
npm run test:e2e         # Playwright browser tests (npx playwright install chromium first)
npm run typecheck
npm run format           # Prettier
npm run build && npm start
npm run verify:local     # with the server running: scripted conversation → docs/evidence/live-mcp.json
npm run check:mcp        # read-only check of a deployed MCP endpoint
npm run demo:seed        # seed a shop into data/bahi.sqlite from the CLI
npm run db:backup -- data/bahi.sqlite data/backup.sqlite
```

All demo data is synthetic. No real shop or customer data is included.
