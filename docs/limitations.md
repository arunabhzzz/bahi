# Limitations

- **Alexa+ itself is not tested.** The server speaks standard MCP over Streamable HTTP with a bearer token. Alexa+ access from India, its connector requirements, and whether it needs OAuth account linking are unverified. OAuth isn't implemented.
- **Phrase parser:** handles common English/Hinglish shop phrasing, not open-ended conversation. Anything it can't parse gets "Sorry, I didn't understand" with examples. Turn on the language-model mode for free-form speech.
- **Names:** fuzzy matching handles small slips and built-in Hindi words; it doesn't transliterate Devanagari script or guess between similar names (it asks).
- **Units:** kg, packet and piece (grams and dozens are converted). No litres; liquids are sold as pieces/bottles.
- **Money:** INR only. Expenses, supplier payments, refunds of already-repaid credit, tax and banking aren't tracked. "Cash received" isn't cash in hand.
- **Analyst:** weekday averages over 4 weeks; no seasonality, festivals or price effects. Demand during stock-outs is under-counted. The restock plan is a heuristic, not an optimiser.
- **Scale:** one SQLite file and one process; state is replayed per shop and cached. Fine for a demo shop (hundreds to low thousands of events), not for many shops under load.
- **Verification gaps:** no real shopkeeper trial, no live microphone testing in a noisy shop, no Docker or public deployment tested.
