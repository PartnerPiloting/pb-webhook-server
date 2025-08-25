export type FieldPath = string;
export type FieldMap = { email?: FieldPath[]; linkedin?: FieldPath[]; phone?: FieldPath[]; };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_RE = /^\+?[0-9()\-\s]{6,}$/;
const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/i;
function allStringValues(v: any): string[] { if (typeof v === "string") return [v]; if (Array.isArray(v)) return v.filter((x) => typeof x === "string") as string[]; return []; }
function normalizeEmail(s: string): string | null { const angle = s.match(/<([^>]+)>/); const cand = angle ? angle[1] : s; const lower = cand.trim().toLowerCase(); return EMAIL_RE.test(lower) ? lower : null; }
function normalizeLinkedIn(raw: string): string | null { let s = raw.trim(); const angle = s.match(/<([^>]+)>/); if (angle) s = angle[1]; if (!/^https?:\/\//i.test(s)) s = "https://" + s; try { const u = new URL(s); const host = u.hostname.replace(/^www\./i, "").toLowerCase(); if (!LINKEDIN_HOST_RE.test(host)) return null; u.search = ""; u.pathname = u.pathname.replace(/\/+$/, ""); return u.toString(); } catch { return null; } }
function normalizePhone(raw: string): string | null { const s = raw.trim(); if (!PHONE_RE.test(s)) return null; return s.replace(/\s+/g, " ").trim(); }
type Detector = { type: "email" | "linkedin" | "phone"; isValid: (s: string) => boolean; };
const DETECTORS: Detector[] = [
  { type: "email", isValid: (s) => !!normalizeEmail(s) },
  { type: "linkedin", isValid: (s) => !!normalizeLinkedIn(s) },
  { type: "phone", isValid: (s) => !!normalizePhone(s) },
];
export function detectFields(leads: any[], minValid = 3, minRatio = 0.15): { fieldMap: FieldMap } {
  if (!leads?.length) return { fieldMap: {} };
  const candidates = Array.from(new Set(Object.keys(leads[0]).concat(["emails","phones"])));
  const byType: Record<"email"|"linkedin"|"phone", { field: string; validCount: number }[]> = { email: [], linkedin: [], phone: [] };
  for (const field of candidates) {
    const values: string[] = [];
    for (const row of leads.slice(0, Math.min(1000, leads.length))) {
      const v = (row as any)[field]; const arr = allStringValues(v);
      arr.forEach((s) => values.push(...String(s).split(/[,;]+/).map((x) => x.trim()).filter(Boolean)));
    }
    for (const det of DETECTORS) {
      const validCount = values.reduce((acc, s) => acc + (det.isValid(s) ? 1 : 0), 0);
      const ratio = values.length ? validCount / values.length : 0;
      if (validCount >= minValid && ratio >= minRatio) byType[det.type].push({ field, validCount });
    }
  }
  const fieldMap: FieldMap = {};
  (["email","linkedin","phone"] as const).forEach((t) => {
    if (byType[t].length) { byType[t].sort((a,b)=>b.validCount - a.validCount); fieldMap[t] = byType[t].map(s=>s.field); }
  });
  return { fieldMap };
}
export function extractByFieldMap(lead: any, map: FieldMap): { email: string[]; linkedin: string[]; phone: string[] } {
  const out = { email: [] as string[], linkedin: [] as string[], phone: [] as string[] };
  const push = (arr: string[], v: string) => { if (!arr.includes(v)) arr.push(v); };
  const explode = (v:any) => (Array.isArray(v)? v: typeof v==="string"? v.split(/[,;]+/): []).map((s:any)=>String(s).trim()).filter(Boolean);
  (["email","linkedin","phone"] as const).forEach((type) => {
    const paths = map[type] || [];
    for (const p of paths) {
      const parts = explode((lead as any)[p]);
      for (const part of parts) {
        if (type === "email") { const n = normalizeEmail(part); if (n) push(out.email, n); }
        else if (type === "linkedin") { const n = normalizeLinkedIn(part); if (n) push(out.linkedin, n); }
        else if (type === "phone") { const n = normalizePhone(part); if (n) push(out.phone, n); }
      }
    }
  });
  return out;
}