/**
 * Offline fallback for the browser simulator: turns everyday English and
 * Hinglish shop talk into Bahi MCP tool calls without any language model.
 *
 * It only works out *intent and structure* (who, what, how many, how much).
 * Item and customer names are passed through as spoken; the MCP server
 * resolves them (including "cheeni" → Sugar) and asks when it isn't sure.
 * When an LLM is configured, the simulator uses it instead and this parser
 * is not involved.
 */
import type { State } from "../../../../packages/domain/src/ledger";
import { resolveName } from "../../../../packages/domain/src/names";
import { latestSale, latestPayment } from "../mcp/tools";

export type Context = {
  pending?: any;
  plan?: any;
  lastDraft?: string;
};
export type Command = { tool: string; args: any };

// ------------------------------------------------------------------ words → numbers

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Hindi
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, cheh: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20,
  pachchis: 25, pachis: 25, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50,
  saath: 60, sattar: 70, assi: 80, nabbe: 90,
};
const FRACTION: Record<string, number> = {
  half: 0.5, aadha: 0.5, adha: 0.5, dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5,
  paav: 0.25, pav: 0.25, quarter: 0.25,
};
const SCALE: Record<string, number> = { hundred: 100, sau: 100, thousand: 1000, hazaar: 1000, hazar: 1000, hajar: 1000 };
const UNIT_WORDS: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg", killo: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  packet: "packet", packets: "packet", pkt: "packet", pkts: "packet", pack: "packet", packs: "packet", paket: "packet",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", nag: "piece",
  bottle: "piece", bottles: "piece",
  dozen: "dozen", dozens: "dozen", darjan: "dozen",
};
const isUnit = (w?: string) => !!w && w in UNIT_WORDS;

/** Replace spelled-out numbers with digits: "two hundred fifty" → "250". */
export function wordsToNumbers(text: string, vocabulary: Set<string> = new Set()) {
  const words = text.split(" ");
  const out: string[] = [];
  let i = 0;
  const numeric = (w: string, next?: string) =>
    w in SMALL ||
    w in SCALE ||
    w in FRACTION ||
    /^\d+(\.\d+)?$/.test(w) ||
    // "do" is Hindi two only before a unit, scale or item word
    (w === "do" && !!next && (isUnit(next) || next in SCALE || vocabulary.has(next))) ||
    // "a"/"an" counts as one before a unit or scale word ("a kilo", "a hundred")
    ((w === "a" || w === "an") && !!next && (isUnit(next) || next in SCALE || next === "half"));
  while (i < words.length) {
    if (!numeric(words[i], words[i + 1])) {
      out.push(words[i++]);
      continue;
    }
    let total = 0,
      current = 0,
      used = 0,
      fraction = 0;
    while (i < words.length && (numeric(words[i], words[i + 1]) || (words[i] === "and" && used && words[i + 1] && (words[i + 1] in SMALL || words[i + 1] === "a" || words[i + 1] === "half")))) {
      const w = words[i];
      if (w === "and") {
        i++;
        continue;
      }
      if ((w === "a" || w === "an") && words[i + 1] === "half") {
        // "one and a half", "a half"
        if (current || total) fraction = 0.5;
        else current += 0.5;
        used++;
        i += 2;
        break;
      }
      if (w === "a" || w === "an") current += 1;
      else if (w === "do") current += 2;
      else if (/^\d/.test(w)) current += Number(w);
      else if (w in SMALL) current += SMALL[w];
      else if (w in FRACTION) {
        if (FRACTION[w] < 1 && (current || total)) fraction = FRACTION[w];
        else current += FRACTION[w];
      } else if (w in SCALE) {
        if (SCALE[w] === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * SCALE[w];
          current = 0;
        }
      }
      used++;
      i++;
      if (w === "half" || (w in FRACTION && FRACTION[w] < 1 && fraction)) break;
    }
    const value = total + current + fraction;
    out.push(String(+value.toFixed(3)));
  }
  return out.join(" ");
}

// ------------------------------------------------------------------ cleanup

const DAYS = /\b(today|yesterday|aaj|kal|(?:last |previous )?(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|(?:somvar|mangalvar|mangalwar|budhvar|budhwar|guruvar|guruwar|shukravar|shukrawar|shanivar|shaniwar|ravivar)|\d{4}-\d{2}-\d{2})\b/;

export function clean(text: string, vocabulary: Set<string> = new Set()) {
  let s = text
    .toLowerCase()
    .replace(/[₹]/g, " ")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?)(kg|kgs|g|gm|gms|pcs|pkt)\b/g, "$1 $2")
    .replace(/[^\p{L}\p{N}.\-' ]+/gu, " ,")
    .replace(/\.(?!\d)/g, " ,")
    .replace(/\b(rs|rupees|rupee|rupaye|rupaiye|rupay|rupiya|bucks)\b/g, " ")
    .replace(/^(hey |ok |okay )?(alexa|bahi)[, ]*/, "")
    .replace(/\b(please|ji|bhai|yaar)\b/g, " ")
    .replace(/\s*,\s*/g, " , ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^,|,$/g, "")
    .trim();
  s = wordsToNumbers(s, vocabulary);
  return s.replace(/\s+/g, " ").trim();
}

function unitOf(word?: string) {
  return word ? UNIT_WORDS[word] : undefined;
}

/** "3 rice", "2 kg sugar", "sugar 2 kg", "half kilo dal", "20 kilos of sugar" */
export function parseLine(raw: string) {
  const s = raw.replace(/^(and|aur|,)\s+/, "").replace(/\s+(and|aur|,)$/, "").trim();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?\s+(?:of\s+)?(.+)$/);
  if (m) {
    const unit = unitOf(m[2]);
    const item = (unit ? m[3] : `${m[2] ?? ""} ${m[3]}`).trim().replace(/^of\s+/, "");
    if (item) return { item, quantity: Number(m[1]), ...(unit ? { unit } : {}) };
  }
  m = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (m && (!m[3] || unitOf(m[3])))
    return { item: m[1].trim(), quantity: Number(m[2]), ...(unitOf(m[3]) ? { unit: unitOf(m[3]) } : {}) };
  return undefined;
}

function parseLines(text: string) {
  const parts = text
    .split(/\s*(?:,|\band\b|\baur\b|&|\bplus\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lines = parts.map(parseLine);
  if (!lines.length || lines.some((l) => !l)) return undefined;
  return lines as { item: string; quantity: number; unit?: string }[];
}

const dayIn = (s: string) => s.match(DAYS)?.[1];

const EXAMPLES =
  'Try "sold 2 kg sugar to Ramesh, he paid 50", "Ramesh paid 200", "who owes me money?", "what\'s running low?", "why were sales down on Tuesday?" or "no, that was 1 kg".';

// ------------------------------------------------------------------ main

export function parseCommand(text: string, state: State, context: Context): Command {
  const vocabulary = new Set<string>();
  for (const i of state.items)
    for (const n of [i.name, ...(i.aliases ?? [])]) for (const w of n.toLowerCase().split(" ")) vocabulary.add(w);
  for (const w of ["cheeni", "chini", "chawal", "atta", "dal", "daal", "tel", "chai", "doodh", "anda", "ande", "namak", "sabun"])
    vocabulary.add(w);
  const s = clean(text, vocabulary);
  const bare = s.replace(/[ ,]+/g, " ").trim();
  if (!bare) throw Error("I didn't hear anything. " + EXAMPLES);

  // ---- yes / no to a pending preview
  if (/^(confirm|yes|yes yes|yeah|yep|haan|haa|ha|han|haan ji|ok|okay|theek hai|thik hai|sahi hai|correct|record it|save it|do it|go ahead|sure)$/.test(bare)) {
    if (context.pending) return { tool: "confirm_operation", args: { operation: context.pending.id } };
    if (/save it/.test(bare) && context.plan) return { tool: "save_order_draft", args: { plan: context.plan.id } };
    throw Error("Nothing is waiting for a yes. Tell me what to record first.");
  }
  if (/^(no|nahi|nahin|na|discard|cancel it|cancel that|don't|dont|leave it|rehne do|chhodo|forget it|stop)$/.test(bare)) {
    if (context.pending) return { tool: "discard_operation", args: { operation: context.pending.id } };
    throw Error("Okay. Nothing was waiting to be recorded.");
  }

  // ---- shop setup (explicit forms)
  let m = bare.match(/^configure shop (.+?) timezone (utc|asia\/kolkata|india|ist)$/);
  if (m) return { tool: "configure_shop", args: { name: titleCase(m[1]), timezone: m[2] === "utc" ? "UTC" : "Asia/Kolkata" } };
  m = bare.match(/^add (?:a )?(?:new )?customer (.+?)(?: (?:balance|owes|who owes) (\d+(?:\.\d+)?))?$/);
  if (m) return { tool: "add_customer", args: { name: titleCase(m[1]), ...(m[2] ? { openingBalance: Number(m[2]) } : {}) } };
  m = bare.match(/^add (?:a )?(?:new )?item (.+?) unit (kg|packet|piece) stock (\d+(?:\.\d+)?) price (\d+(?:\.\d+)?)(?: cost (\d+(?:\.\d+)?|unknown))?(?: pack (\d+(?:\.\d+)?))?(?: lead (\d+))?$/);
  if (m)
    return {
      tool: "add_item",
      args: {
        name: titleCase(m[1]),
        unit: m[2],
        stock: Number(m[3]),
        price: Number(m[4]),
        ...(m[5] && m[5] !== "unknown" ? { cost: Number(m[5]) } : {}),
        ...(m[6] ? { packSize: Number(m[6]) } : {}),
        ...(m[7] ? { leadDays: Number(m[7]) } : {}),
      },
    };

  // ---- restock planning
  m = bare.match(/^(?:plan|what should i (?:stock|order|buy)|restock)(?: stock| for (?:the )?\w+)?(?: (?:with|in|for|budget|under))* (\d+(?:\.\d+)?)(?: (?:reserve|keep|keep aside|save) (\d+(?:\.\d+)?))?(?: (?:fee|delivery|delivery fee) (\d+(?:\.\d+)?))?$/);
  if (m)
    return {
      tool: "plan_restock",
      args: {
        budget: Number(m[1]),
        ...(m[2] ? { reserve: Number(m[2]) } : {}),
        ...(m[3] ? { deliveryFee: Number(m[3]) } : {}),
      },
    };
  if (/^plan\b/.test(bare) || /\bfor stock\b/.test(bare))
    throw Error('How much can you spend? Say for example "plan budget 2000 reserve 500 fee 0".');
  if (context.plan) {
    m = bare.match(/^(?:leave out|exclude|skip|remove|no|without|don't buy|dont buy) (.+)$/);
    if (m && !context.pending && state.items.length && tryItem(state, m[1]))
      return { tool: "revise_plan", args: { plan: context.plan.id, exclude: [...context.plan.constraints.exclude, m[1]] } };
    m = bare.match(/^(?:what if )?(?:budget|make it|spend|change budget to|increase budget to|budget to) (\d+(?:\.\d+)?)$/);
    if (m) return { tool: "revise_plan", args: { plan: context.plan.id, budget: Number(m[1]) } };
    m = bare.match(/^(?:prioriti[sz]e|first|buy first) (.+)$/) ?? bare.match(/^(.+) first$/);
    if (m) return { tool: "revise_plan", args: { plan: context.plan.id, priority: [m[1]] } };
    if (/^(save (the )?(draft|plan|order)|save it|make (the |an )?order( draft)?)$/.test(bare))
      return { tool: "save_order_draft", args: { plan: context.plan.id } };
  }
  if (/^save (the )?(draft|plan|order)$/.test(bare)) throw Error("Make a restock plan first.");
  m = bare.match(/^(?:receive|received delivery|delivery came|delivery) (.+)$/);
  if (m && /\bat\b/.test(m[1])) {
    const items = m[1]
      .split(/\s*(?:,|\band\b|\baur\b)\s*/)
      .filter(Boolean)
      .map((part) => {
        const x = part.match(/^(.+?) (?:at|@) (\d+(?:\.\d+)?)(?: (?:each|per \w+))?$/);
        const line = x && parseLine(x[1]);
        if (!line) throw Error('Say the delivery like "receive 5 kg sugar at 43".');
        return { ...line, pricePerUnit: Number(x![2]) };
      });
    return { tool: "receive_order", args: { ...(context.lastDraft ? { draft: context.lastDraft } : {}), items } };
  }
  if (/^cancel (the )?(draft|order|order draft)$/.test(bare))
    return { tool: "cancel_order_draft", args: context.lastDraft ? { draft: context.lastDraft } : {} };

  // ---- analyst questions
  if (/\b(why|kyun|kyon|kyu)\b/.test(bare) && /\b(sales?|business|bikri|dhanda|slow|down|up|low|high|kam|zyada|bad|good|quiet)\b/.test(bare)) {
    const day = dayIn(bare);
    return { tool: "explain_sales_change", args: day ? { date: day } : {} };
  }
  if (/\b(credit risk|risky|risk|defaulter|won't pay|wont pay|not paying|might not pay|trust)\b/.test(bare) || /should i give .* (credit|udhaar|udhar)/.test(bare))
    return { tool: "credit_risk", args: {} };
  if (/\b(dead stock|not (moving|selling)|slow moving|slow-moving|haven't sold|havent sold|nahi bik)\b/.test(bare))
    return { tool: "dead_stock", args: {} };
  m = bare.match(/^how long (?:will|does|would) (.+?) last$/) ?? bare.match(/^(.+?) kitne din (?:chalega|chalegi)$/);
  if (m) return { tool: "low_stock_forecast", args: { item: m[1] } };
  if (/\b(running low|run(ning)? out|low stock|khatam|reorder|what should i (order|reorder)|what do i need to (order|buy)|kya mangana)\b/.test(bare))
    return { tool: "low_stock_forecast", args: {} };
  m = bare.match(/^(?:show|chart|graph|draw)(?: me)?(?: the)? (?:sales )?(?:for )?(?:the )?(last|this|past) (month|week|(\d+) days)(?: sales)?(?: by (item|items|day|days|customer|customers|weekday|weekdays))?$/) ??
    bare.match(/^(?:sales|report) (?:by|per) (item|day|customer|weekday)()()()$/);
  if (m) {
    const by = (m[4] ?? m[1] ?? "day").replace(/s$/, "");
    const days = m[2] === "week" ? 7 : m[3] ? Number(m[3]) : 30;
    return { tool: "sales_report", args: { days: /^(item|day|customer|weekday)$/.test(m[1]) ? 28 : days, by: /^(item|day|customer|weekday)$/.test(by) ? by : "day" } };
  }
  if (/\b(busiest|best|slowest) day\b/.test(bare)) return { tool: "sales_report", args: { by: "weekday" } };
  m = bare.match(/^(?:how was|how were sales|how did (?:i|we) do|summary|daily summary|sales summary|hisaab|aaj ka hisaab)(?: (?:on|for))? ?(.*?)(?: (?:compared (?:with|to)|vs|versus|against) (.+))?$/);
  if (m && (m[1] === "" || dayIn(m[1]) || /^(today|yesterday)$/.test(m[1]))) {
    const date = m[1] ? dayIn(m[1]) : undefined;
    const compareTo = m[2] ? dayIn(m[2]) : undefined;
    return { tool: "daily_summary", args: { ...(date ? { date } : {}), ...(compareTo ? { compareTo } : {}) } };
  }
  if (/^(recent|last few|latest) (entries|sales|bills|transactions)$|^what did i (just )?record$/.test(bare))
    return { tool: "recent_entries", args: {} };

  // ---- balances and stock questions
  m = bare.match(/^(?:how much (?:does|do|is) (.+?) owe(?: me)?|(.+?) (?:ka|ki|ke) (?:udhaar|udhar|baki|baaki|hisaab)(?: kitna (?:hai|he))?|what does (.+?) owe(?: me)?|(.+?) owes how much)$/);
  if (m) return { tool: "who_owes", args: { customer: m[1] ?? m[2] ?? m[3] ?? m[4] } };
  if (/^(who owes( me)?( money)?|who all owe( me)?|who has to pay( me)?|balances?|outstanding|udhaar|udhar|udhaar list|kis kis ka udhaar( hai)?|credit list|who owes what)$/.test(bare))
    return { tool: "who_owes", args: {} };
  m = bare.match(/^(?:how much|how many) (.+?) (?:do (?:i|we) have|is left|are left|left|in stock|bacha hai|hai)$/) ??
    bare.match(/^(?:check )?stock (?:of|for) (.+)$/) ??
    bare.match(/^(.+?) (?:kitna|kitni|kitne) (?:hai|he|bacha|bachi|bache)(?: hai)?$/);
  if (m) return { tool: "check_stock", args: { item: m[1] } };
  if (/^(stock|check stock|what'?s in stock|what do i have|inventory|show stock|maal kitna hai)$/.test(bare))
    return { tool: "check_stock", args: {} };

  // ---- corrections
  if (/^(cancel|delete|remove|undo|void|reverse) (that|the|this|last|my last)?\s?(last )?(sale|entry|bill)$|^(galat entry|wrong entry)( hai)?$/.test(bare))
    return { tool: "correct_entry", args: { cancel: true } };
  m = bare.match(/^(?:no |nahi |correction )?(?:correct|change|fix) (?:the )?payment (?:to )?(\d+(?:\.\d+)?)$/) ??
    bare.match(/^(?:no |nahi )?(?:.+? )?(?:paid|gave|ne diye|diye) (\d+(?:\.\d+)?) not (\d+(?:\.\d+)?)$/);
  if (m) return { tool: "correct_payment", args: { amount: Number(m[1]) } };
  m = bare.match(/^(?:no |nahi |sorry )?(?:correct|change|fix|make) (?:the )?(.+?) (?:to|into) (\d+(?:\.\d+)?)(?: ([a-z]+))?$/);
  if (m && (!m[3] || unitOf(m[3]))) return correction(state, `${m[2]} ${m[3] ?? ""} ${m[1]}`);
  m = bare.match(/^(?:no |nahi |sorry |wait |oops )*(?:that was|it was|it's|its|that's|thats|make it|actually|woh|vo|wo) (.+?)(?: not (.+))?$/);
  if (m) return correction(state, m[1]);

  // ---- payments
  m =
    bare.match(/^([a-z][a-z ]*?) (?:has )?(?:paid|gave|returned|paid back|paid me|gave me|ne|ne diye|de gaya|de gayi|jama kiya|jama kiye)(?: me| back| us)? (\d+(?:\.\d+)?)(?: diye| de diye| diya| back| jama)?$/) ??
    bare.match(/^([a-z][a-z ]*?) ne (\d+(?:\.\d+)?) (?:diye|diya|de diye|lautaye|jama kiye)$/);
  if (m) return { tool: "record_payment", args: { customer: m[1], amount: Number(m[2]) } };
  m = bare.match(/^(?:got|received|mila|mile|collected) (\d+(?:\.\d+)?) from ([a-z][a-z ]*)$/);
  if (m) return { tool: "record_payment", args: { customer: m[2], amount: Number(m[1]) } };

  // ---- price changes
  m = bare.match(/^price (.+?) (\d+(?:\.\d+)?)(?: cost (\d+(?:\.\d+)?))?$/) ??
    bare.match(/^(?:set|change|make) (?:the )?(?:price of |selling price of )?(.+?) (?:price )?(?:to|at) (\d+(?:\.\d+)?)(?: cost (\d+(?:\.\d+)?))?$/) ??
    bare.match(/^(.+?) (?:price is now|is now|ka rate|rate) (\d+(?:\.\d+)?)()$/);
  if (m && tryItem(state, m[1]))
    return { tool: "set_price", args: { item: m[1], price: Number(m[2]), ...(m[3] ? { cost: Number(m[3]) } : {}) } };

  // ---- purchases
  m = bare.match(/^(?:got|bought|purchased|purchase|buy|received|kharida|kharide|mangaya|aaya|aya)(?: in)? (.+?) (for|at|@) (\d+(?:\.\d+)?)( each| per (?:kg|kilo|packet|piece|unit)| total| in total)?(?: from (?:the )?(?:supplier|wholesaler|market|mandi))?$/);
  if (m) {
    const lines = parseLines(m[1].replace(/ from (the )?(supplier|wholesaler|market|mandi)$/, ""));
    if (lines && lines.length === 1) {
      const perUnit = m[2] !== "for" || /each|per/.test(m[4] ?? "");
      return {
        tool: "record_purchase",
        args: { items: [{ ...lines[0], ...(perUnit ? { pricePerUnit: Number(m[3]) } : { totalCost: Number(m[3]) }) }] },
      };
    }
    if (lines) throw Error("Tell me one item at a time with its price, e.g. \"got 20 kg sugar for 900\".");
  }

  // ---- sales
  const sale = parseSale(bare);
  if (sale) return { tool: "record_sale", args: sale };

  throw Error("Sorry, I didn't understand that. " + EXAMPLES);
}

function titleCase(s: string) {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
function tryItem(state: State, name: string) {
  try {
    return resolveName(state.items, name, "item");
  } catch {
    return undefined;
  }
}
function tryCustomer(state: State, name: string) {
  try {
    return resolveName(state.customers, name, "customer");
  } catch {
    return undefined;
  }
}

function parseSale(s: string) {
  let rest = s.replace(/ , /g, " , ");
  let paid: number | undefined,
    full = false,
    credit = false,
    customer: string | undefined;
  // payment part
  const paidMatch =
    rest.match(/(?:,\s*)?(?:and\s+)?(?:he|she|they|customer)?\s*(?:paid|gave|has paid|ne diye|diye|de diye|diya)\s+(\d+(?:\.\d+)?)(?:\s+(?:cash|now|only))?\s*$/) ??
    rest.match(/(?:,\s*)?(\d+(?:\.\d+)?)\s+(?:paid|diye|de diye|diya|cash diye|jama)\s*$/);
  if (paidMatch) {
    paid = Number(paidMatch[1]);
    rest = rest.slice(0, paidMatch.index).trim();
  }
  const fullMatch = rest.match(/(?:,\s*)?(?:and\s+)?(?:he |she |they )?(?:paid in full|paid full|full payment|paid cash|in cash|cash|nakad|pura paisa diya|paid)\s*$/);
  if (fullMatch && paid === undefined) {
    full = true;
    rest = rest.slice(0, fullMatch.index).trim();
  }
  const creditMatch = rest.match(/(?:,\s*)?(?:on credit|on udhaar|udhaar|udhar|credit|baad mein|baad me|khate mein|khate me|likh do|likh lo)\s*$/);
  if (creditMatch) {
    credit = true;
    rest = rest.slice(0, creditMatch.index).trim();
  }
  rest = rest.replace(/[ ,]+$/, "");
  // customer part
  let cm = rest.match(/^([a-z][a-z ]*?) ko (.+)$/);
  if (cm) {
    customer = cm[1];
    rest = cm[2];
  } else {
    cm = rest.match(/^(.+?) (?:to|for) ([a-z][a-z ]*?)$/);
    if (cm) {
      rest = cm[1];
      customer = cm[2];
    }
  }
  rest = rest
    .replace(/^(?:i |we )?(?:just )?(?:sold|sell|sale of|sale|bech(?:a|i|e|o)?|bika|gave|give|de diya|diya|de do)\s+/, "")
    .replace(/\s+(?:sold|becha|bechi|diya|de diya|diye|de do|dena)$/, "")
    .replace(/[ ,]+$/, "")
    .trim();
  const lines = parseLines(rest);
  if (!lines) return undefined;
  if (customer && /^(cash|walk ?in|walkin|someone|a customer|customer)$/.test(customer)) customer = undefined;
  const args: any = { items: lines };
  if (customer) {
    args.customer = customer;
    if (full && paid === undefined) args.paidInFull = true;
    else if (paid !== undefined) args.paid = paid;
    else if (!credit) args.paid = 0;
    else args.paid = 0;
  } else if (credit) throw Error("Whose credit is this? Say the customer's name, like \"2 kg sugar to Ramesh on credit\".");
  return args;
}

/** "two sugar" / "Meena" / "cash" / "paid 50" → a correct_entry call on the latest sale. */
function correction(state: State, what: string): Command {
  const sale = latestSale(state);
  const payment = latestPayment(state);
  const text = what.replace(/^(?:a |the )/, "").replace(/[ ,]+$/, "").trim();
  const amount = text.match(/^(?:paid )?(\d+(?:\.\d+)?)(?: paid)?$/);
  if (amount) {
    if (payment && (!sale || payment.version > sale.version))
      return { tool: "correct_payment", args: { amount: Number(amount[1]) } };
    if (sale) return { tool: "correct_entry", args: { paid: Number(amount[1]) } };
  }
  if (!sale) throw Error("There's no sale to correct yet.");
  if (/^(cash|walk ?in|a cash sale|cash sale)$/.test(text))
    return { tool: "correct_entry", args: { customer: null } };
  if (/^(credit|udhaar|udhar|on credit)$/.test(text))
    return { tool: "correct_entry", args: { paid: 0 } };
  // "1 kg" / "2" with no item: only clear when the sale had a single item.
  const qtyOnly = text.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (qtyOnly && (!qtyOnly[2] || unitOf(qtyOnly[2]))) {
    if (sale.data.lines.length !== 1)
      throw Error("Which item should change? Say for example \"no, that was 2 kg sugar\".");
    const item = state.items.find((i) => i.id === sale.data.lines[0].item)!;
    return {
      tool: "correct_entry",
      args: { items: [{ item: item.name, quantity: Number(qtyOnly[1]), ...(unitOf(qtyOnly[2]) ? { unit: unitOf(qtyOnly[2]) } : {}) }] },
    };
  }
  const lines = parseLines(text);
  if (lines) {
    // Replace only the mentioned items; keep the rest of the sale.
    const items = sale.data.lines.map((l: any) => {
      const item = state.items.find((i) => i.id === l.item)!;
      return { item: item.name, quantity: l.qty / 1000 };
    });
    for (const line of lines) {
      const target = tryItem(state, line.item);
      const index = target ? items.findIndex((x: any) => x.item === target.name) : -1;
      if (index >= 0) items[index] = { item: target!.name, quantity: line.quantity, ...(line.unit ? { unit: line.unit } : {}) };
      else if (sale.data.lines.length === 1 && lines.length === 1) items[0] = line;
      else items.push(line);
    }
    return { tool: "correct_entry", args: { items } };
  }
  if (tryCustomer(state, text)) return { tool: "correct_entry", args: { customer: text } };
  throw Error(`What was wrong with the last sale? Say e.g. "no, that was 2 kg", "that was Meena" or "cancel that sale".`);
}
