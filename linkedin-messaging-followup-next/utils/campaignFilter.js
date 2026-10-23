// The campaign picker on Today (23 Oct 2026, Sam Noble: Barclayss vs Find Me First).
// filter: 'all' | 'none' (leads that came in another way) | a Linked Helper campaign ID (number).
// A row carries campaignId (null = no campaign) only for a client running 2+ campaigns; for anyone
// else the filter stays 'all' and every row matches.

export function matchesCampaign(item, filter) {
  if (filter === 'all' || filter === undefined || filter === null) return true;
  const id = item && item.campaignId !== undefined ? item.campaignId : null;
  if (filter === 'none') return id === null;
  return id === Number(filter);
}

/** { campaignId|'none': count } over rows. */
export function tallyCampaigns(items = []) {
  const out = {};
  for (const it of items) {
    const key = it && it.campaignId !== undefined && it.campaignId !== null ? it.campaignId : 'none';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
