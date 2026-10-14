# Demo data

Everything is synthetic. `apps/server/src/seed.ts` simulates a small Indian general store ("Sharma General Store") and records five weeks of history through the normal preview → confirm path, so every number the analyst reports can be traced to receipts.

- **14 items:** Sugar, Rice, Atta, Toor Dal, Mustard Oil, Tea, Milk, Biscuits, Salt, Eggs, Soap, Noodles, Ghee, Hair Oil, with sale prices, costs, pack sizes and supplier lead times.
- **Walk-in customers:** 7–12 cash bills a day (busier at weekends), randomised with a fixed seed.
- **Regular customers:** Ramesh (tea stall, buys big on credit every Tuesday and Friday, settles on Sunday), Meena (Mon/Thu/Sat, part cash, settles Saturday), Suresh and Anita (cash), Farooq (credit every third day, paid once ~4 weeks ago), Lakshmi (one old unpaid bill).
- **Deliveries:** every morning the shop restocks items running below about two days of demand. Sales never exceed stock.

**Planted stories, true on any weekday you run the demo:**

| Question | What the data shows |
|---|---|
| "Why were sales down on Tuesday?" | On the latest completed Tuesday, Ramesh didn't come and the sugar delivery had been short, so sugar ran out around 11:20 am. |
| "Who's a credit risk?" | Farooq: balance growing, no payment for ~25 days. Lakshmi: an unpaid bill over three weeks old. |
| "Which items aren't moving?" | Ghee (last sold over a month ago) and Hair Oil (never sold). |
| "What's running low?" | Tea, Toor Dal and Mustard Oil are kept lean in the last few days; which ones are flagged depends on the day. |

`tests/insights.test.ts` checks the Tuesday, credit-risk and dead-stock stories for all seven possible weekdays.
