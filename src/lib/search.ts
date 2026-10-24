// Search for lists that grow (plans, decisions, the Giving guide): forgiving about case,
// accents, dollar formats ("$2M" = "2,000,000") and everyday words ("college" finds 529s).

/** Everyday words → words the app uses. A query word also matches its synonyms. */
const SYNONYMS: Record<string, string[]> = {
  house: ["home", "down payment", "mortgage"],
  home: ["house", "down payment"],
  college: ["529", "tuition", "school", "education"],
  school: ["529", "tuition", "college", "education"],
  education: ["529", "tuition", "school"],
  university: ["529", "tuition", "school"],
  trust: ["grat"],
  annuity: ["grat"],
  donate: ["charity", "charitable", "donor"],
  donation: ["charity", "charitable", "donor"],
  charity: ["charitable", "donor", "donate"],
  kids: ["child", "children"],
  kid: ["child", "children"],
  children: ["child", "kids"],
  stock: ["shares", "investments", "brokerage"],
  shares: ["stock"],
  lend: ["loan"],
  loan: ["lend", "lending"],
  doctor: ["medical"],
  hospital: ["medical"],
  will: ["bequest", "estate"],
  inheritance: ["estate", "bequest"],
  company: ["llc", "business"],
  business: ["llc"],
  ira: ["roth", "retirement"],
  roth: ["ira"],
  tax: ["taxes"],
  taxes: ["tax"],
  gift: ["give", "gifts"],
  give: ["gift", "gifts"],
};

/** Lowercase, no accents, money in plain digits ("$2,000,000" and "$2M" → "2000000"). */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\$?(\d+(?:\.\d+)?)\s*([km])\b/g, (_, n: string, unit: string) =>
      String(Math.round(Number(n) * (unit === "m" ? 1_000_000 : 1_000))),
    )
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\$/g, "");
}

/** The query's words, normalized. */
export function words(query: string): string[] {
  return normalize(query)
    .split(/[^a-z0-9.%]+/)
    .filter((w) => w.length > 0);
}

/** True when every word of `query` (or one of its synonyms) appears in some field. Empty query matches all. */
export function matches(query: string, fields: (string | null | undefined)[]): boolean {
  const ws = words(query);
  if (ws.length === 0) return true;
  const hay = normalize(fields.filter(Boolean).join(" \u0000 "));
  return ws.every((w) => [w, ...(SYNONYMS[w] ?? [])].some((v) => hay.includes(normalize(v))));
}

/** Splits `text` into plain and matched pieces for highlighting (exact word matches only). */
export function highlight(text: string, query: string): { text: string; match: boolean }[] {
  const ws = words(query).filter((w) => w.length > 1);
  if (ws.length === 0 || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of ws) {
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) {
      for (let k = i; k < i + w.length; k++) marks[k] = true;
    }
  }
  const out: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.match === marks[i]) last.text += text[i];
    else out.push({ text: text[i], match: marks[i] });
  }
  return out;
}
