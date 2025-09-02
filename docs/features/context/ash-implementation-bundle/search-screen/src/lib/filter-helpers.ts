export function normalizeTerms(input: string): string[] {
  const toSlug = (s: string) => String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-\u036f]/g, "")
    .replace(/[^a-z0-9* ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = toSlug(input);
  return cleaned.split(/[,;\n\r\t ]+/).map(t => t.trim()).filter(Boolean);
}
export type LeadBase = { id: string; searchTerms?: string; [k: string]: any };
export type LeadWithIndex<T = any> = T & { _tagSet?: Set<string> };
export function indexLead<T extends LeadBase = LeadBase>(lead: T): LeadWithIndex<T> {
  const parts = normalizeTerms(lead.searchTerms || ""); return { ...lead, _tagSet: new Set(parts) };
}
export type FilterState = { includeAll: string[]; includeAny: string[]; exclude: string[] };
function setHasToken(set: Set<string>, token: string): boolean {
  if (token.endsWith("*")) { const prefix = token.slice(0, -1); for (const t of set) if (t.startsWith(prefix)) return true; return false; }
  return set.has(token);
}
export function filterLeadsByState<T = any>(indexedLeads: LeadWithIndex<T>[], state: FilterState): LeadWithIndex<T>[] {
  const { includeAll, includeAny, exclude } = state;
  return indexedLeads.filter(lead => {
    const S = (lead as any)._tagSet as Set<string> || new Set<string>();
    for (const t of includeAll) if (!setHasToken(S, t)) return false;
    if (includeAny.length > 0 && !includeAny.some(t => setHasToken(S, t))) return false;
    for (const t of exclude) if (setHasToken(S, t)) return false;
    return true;
  });
}