/**
 * Server-side name resolution for items and customers.
 *
 * Voice assistants hand us whatever the shopkeeper said: "cheeni", "Sugar",
 * "sugars", "shugar". Resolution order: exact id → exact name → alias
 * (per-item aliases plus a built-in Hindi/Hinglish dictionary) → singular /
 * plural → close spelling. Anything that matches more than one record is an
 * error that names the candidates, so the assistant asks instead of guessing.
 */

/** Common Hindi / Hinglish shop words mapped to English catalogue words. */
export const BUILT_IN_ALIASES: Record<string, string[]> = {
  sugar: ["cheeni", "chini", "shakkar", "shakar"],
  rice: ["chawal", "chaawal", "chaval"],
  atta: ["aata", "wheat flour", "flour", "gehu ka atta"],
  "toor dal": ["dal", "daal", "arhar dal", "arhar", "toor", "tur dal"],
  "mustard oil": ["sarson tel", "sarson ka tel", "sarson", "tel"],
  oil: ["tel"],
  tea: ["chai", "chai patti", "chaipatti", "patti"],
  milk: ["doodh", "dudh"],
  biscuits: ["biscuit", "biskut", "biskit"],
  salt: ["namak"],
  eggs: ["egg", "anda", "ande", "andey"],
  soap: ["sabun", "saabun"],
  noodles: ["noodle"],
  ghee: ["desi ghee"],
  onion: ["pyaz", "pyaaz", "kanda"],
  potato: ["aloo", "alu"],
  turmeric: ["haldi"],
  "chilli powder": ["mirchi", "lal mirch", "chili powder"],
};

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(word: string) {
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && /(s|x|z|ch|sh)es$/.test(word))
    return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3)
    return word.slice(0, -1);
  return word;
}

function stem(value: string) {
  return normalize(value).split(" ").map(singular).join(" ");
}

export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = temp;
    }
  }
  return prev[b.length];
}

export class NameError extends Error {
  constructor(
    message: string,
    public candidates: string[] = [],
  ) {
    super(message);
  }
}

type Named = { name: string; id?: string; aliases?: string[] };

function aliasesFor(record: Named) {
  const own = (record.aliases ?? []).map(stem);
  const builtIn = BUILT_IN_ALIASES[normalize(record.name)] ?? [];
  return [...own, ...builtIn.map(stem)];
}

/**
 * Resolve a spoken or typed name to exactly one record.
 * `kind` is used only for error messages ("item" / "customer").
 */
export function resolveName<T extends Named>(
  records: T[],
  input: string,
  kind: "item" | "customer",
): T {
  const raw = (input ?? "").trim();
  if (!raw) throw new NameError(`Which ${kind}? The name was empty.`);
  const byId = records.find((r) => r.id === raw);
  if (byId) return byId;
  const wanted = stem(raw);
  const unique = (found: T[], how: string): T | undefined => {
    const distinct = [...new Set(found)];
    if (distinct.length === 1) return distinct[0];
    if (distinct.length > 1)
      throw new NameError(
        `"${raw}" could be ${listNames(distinct.map((r) => r.name))}. Which one ${how}?`,
        distinct.map((r) => r.name),
      );
    return undefined;
  };
  // 1. exact (case/plural-insensitive) name
  const exact = unique(
    records.filter((r) => stem(r.name) === wanted),
    "did you mean",
  );
  if (exact) return exact;
  // 2. aliases. Own aliases beat built-in ones.
  const own = unique(
    records.filter((r) => (r.aliases ?? []).map(stem).includes(wanted)),
    "did you mean",
  );
  if (own) return own;
  const alias = unique(
    records.filter((r) => aliasesFor(r).includes(wanted)),
    "did you mean",
  );
  if (alias) return alias;
  // 3. the spoken words are the start or end of a longer name
  //    ("dal" → "Toor Dal", "ramesh" → "Ramesh Kumar")
  const partial = records.filter((r) => {
    const name = stem(r.name);
    return (
      name.split(" ").includes(wanted) ||
      name.startsWith(wanted + " ") ||
      name.endsWith(" " + wanted)
    );
  });
  const part = unique(partial, "did you mean");
  if (part) return part;
  // 4. close spelling, only when one candidate is clearly closest
  const limit = wanted.length <= 4 ? 1 : wanted.length <= 8 ? 2 : 3;
  const scored = records
    .flatMap((r) =>
      [stem(r.name), ...aliasesFor(r)].map((n) => ({
        r,
        d: editDistance(n, wanted),
      })),
    )
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d);
  if (scored.length) {
    const best = scored[0].d;
    const top = [...new Set(scored.filter((x) => x.d === best).map((x) => x.r))];
    if (top.length === 1) return top[0];
    throw new NameError(
      `"${raw}" could be ${listNames(top.map((r) => r.name))}. Which one did you mean?`,
      top.map((r) => r.name),
    );
  }
  const known = records.map((r) => r.name);
  throw new NameError(
    kind === "item"
      ? `I don't have an item called "${raw}".${known.length ? ` Items: ${listNames(known.slice(0, 15))}.` : ""}`
      : `I don't have a customer called "${raw}".${known.length ? ` Customers: ${listNames(known.slice(0, 15))}.` : " Add them first."}`,
    [],
  );
}

export function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
