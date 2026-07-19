/**
 * Shared timezone detection from location string.
 * Used by: backend (calendar availability, quick-pick, chat) and detect-timezone API.
 *
 * @param {string} location - Location string (e.g. "Dandenong South, Victoria, Australia")
 * @returns {string|null} IANA timezone (e.g. "Australia/Melbourne") or null if no match
 */
function getTimezoneFromLocation(location) {
  const loc = (location || '').toLowerCase();
  if (!loc.trim()) return null;

  // Australia - Victoria and Melbourne metro/suburbs
  if (
    loc.includes('melbourne') ||
    loc.includes('victoria') ||
    loc.includes('ballarat') ||
    loc.includes('dandenong') ||
    loc.includes('geelong') ||
    loc.includes('bendigo') ||
    loc.includes('frankston') ||
    loc.includes('werribee') ||
    loc.includes('shepparton') ||
    loc.includes('warrnambool') ||
    loc.includes('traralgon') ||
    loc.includes('mildura')
  ) {
    return 'Australia/Melbourne';
  }

  // Australia - NSW
  if (
    loc.includes('sydney') ||
    loc.includes('canberra') ||
    loc.includes('nsw') ||
    loc.includes('new south wales') ||
    loc.includes('wollongong') ||
    loc.includes('newcastle') ||
    loc.includes('central coast') ||
    loc.includes('coffs harbour')
  ) {
    return 'Australia/Sydney';
  }

  // Australia - Queensland
  if (
    loc.includes('brisbane') ||
    loc.includes('queensland') ||
    loc.includes('gold coast') ||
    loc.includes('sunshine coast') ||
    loc.includes('cairns') ||
    loc.includes('townsville')
  ) {
    return 'Australia/Brisbane';
  }

  // Australia - other states
  if (loc.includes('perth') || loc.includes('western australia')) return 'Australia/Perth';
  if (loc.includes('adelaide') || loc.includes('south australia')) return 'Australia/Adelaide';
  if (loc.includes('darwin') || loc.includes('northern territory') || loc.includes('alice springs')) return 'Australia/Darwin';
  if (loc.includes('hobart') || loc.includes('tasmania') || loc.includes('launceston') || loc.includes('devonport')) return 'Australia/Hobart';

  // New Zealand (all of mainland NZ is one timezone; IANA Pacific/Auckland handles NZ DST).
  // AU/NZ-PREFERENCE POLICY (Guy 2026-07-20): Guy's book is Australian/NZ, so a city that also
  // exists elsewhere but is prominently AU/NZ resolves to the AU/NZ zone. That's why the AU blocks
  // above and this NZ block run BEFORE the UK/US ones — e.g. Perth→Australia (not Scotland),
  // Newcastle→Australia (not England), Christchurch→NZ (not Dorset UK). Coverage is by city/region
  // NAME, not just the country word, because LinkedIn often shows just "Christchurch" with no country.
  if (
    loc.includes('auckland') ||
    loc.includes('new zealand') ||
    loc.includes('aotearoa') ||
    loc.includes('wellington') ||
    loc.includes('christchurch') ||
    loc.includes('dunedin') ||
    loc.includes('tauranga') ||
    loc.includes('palmerston north') ||
    loc.includes('napier') ||
    loc.includes('rotorua') ||
    loc.includes('new plymouth') ||
    loc.includes('whangarei') ||
    loc.includes('invercargill') ||
    loc.includes('queenstown') ||
    loc.includes('canterbury') ||
    loc.includes('otago') ||
    loc.includes('waikato') ||
    loc.includes('northland') ||
    loc.includes('taranaki') ||
    loc.includes('manawatu') ||
    loc.includes('southland') ||
    loc.includes('bay of plenty') ||
    loc.includes("hawke's bay") ||
    loc.includes('hawkes bay')
  ) {
    return 'Pacific/Auckland';
  }

  // Asia
  if (loc.includes('singapore')) return 'Asia/Singapore';
  if (loc.includes('hong kong')) return 'Asia/Hong_Kong';
  if (loc.includes('tokyo') || loc.includes('japan')) return 'Asia/Tokyo';
  if (loc.includes('dubai')) return 'Asia/Dubai';

  // Europe
  if (loc.includes('london') || loc.includes('uk') || loc.includes('england')) return 'Europe/London';

  // US
  if (loc.includes('new york') || loc.includes('nyc') || loc.includes('ny,')) return 'America/New_York';
  if (loc.includes('los angeles') || loc.includes('la,') || loc.includes('california') || loc.includes('san francisco') || loc.includes('san jose') || loc.includes('oakland')) return 'America/Los_Angeles';
  if (loc.includes('chicago') || loc.includes('illinois')) return 'America/Chicago';
  if (loc.includes('texas')) return 'America/Chicago';
  if (loc.includes('florida')) return 'America/New_York';

  return null;
}

module.exports = { getTimezoneFromLocation };
