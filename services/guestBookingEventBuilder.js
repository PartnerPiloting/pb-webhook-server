/**
 * Build Google Calendar event text for guest self-serve booking (Guy-only flow).
 * Mirrors linkedin-messaging-followup-next calendar-booking handleBookMeeting strings;
 * host fields come from Master Clients → Clients (same as /api/calendar/client-info).
 */

const DEFAULT_CLIENT_ID = "Guy-Wilson";

/**
 * @param {string} [clientId]
 * @returns {Promise<{ clientId: string, clientName: string | null, meetingLink: string | null, linkedInUrl: string | null, phone: string | null, status: string | undefined }>}
 */
async function fetchHostClientProfile(clientId) {
  const id = (clientId || process.env.GUEST_BOOKING_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
  const baseId = process.env.MASTER_CLIENTS_BASE_ID;
  const key = process.env.AIRTABLE_API_KEY;
  if (!baseId || !key) {
    throw new Error("Missing MASTER_CLIENTS_BASE_ID or AIRTABLE_API_KEY");
  }

  const fields = [
    "Client ID",
    "Client Name",
    "Status",
    "LinkedIn URL",
    "Phone",
    "Meeting Link",
    "Timezone",
    "Airtable Base ID",
  ];
  const fieldParams = fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
  const escapedId = id.replace(/\\/g, "\\\\").replace(/'/g, "''");
  const url = `https://api.airtable.com/v0/${baseId}/Clients?filterByFormula=${encodeURIComponent(
    `LOWER({Client ID})=LOWER('${escapedId}')`
  )}&${fieldParams}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`Airtable client lookup failed: ${res.status}`);
  }
  const data = await res.json();
  const rec = data.records?.[0];
  if (!rec) {
    throw new Error(`Client not found: ${id}`);
  }
  const f = rec.fields || {};
  return {
    clientId: f["Client ID"] || id,
    clientName: f["Client Name"] || null,
    status: f["Status"],
    meetingLink: f["Meeting Link"] || null,
    linkedInUrl: f["LinkedIn URL"] || null,
    phone: f["Phone"] || null,
    timezone: f["Timezone"] || "Australia/Brisbane",
    airtableBaseId: f["Airtable Base ID"] || null,
  };
}

/**
 * @param {Object} opts
 * @param {string} [opts.clientId] Master Clients Client ID (default Guy-Wilson / env)
 * @param {string} opts.leadFullName
 * @param {string} [opts.leadLinkedIn]
 * @param {string} [opts.guestNotes] appended under "Notes from guest:" if non-empty
 */
async function buildGuestBookingEventDetails(opts) {
  const { clientId, leadFullName, leadLinkedIn, guestNotes } = opts;

  const host = await fetchHostClientProfile(clientId);
  if (host.status && host.status !== "Active") {
    throw new Error(`Client is not active: ${host.clientId}`);
  }

  const leadNamePart = (leadFullName && String(leadFullName).trim()) || "Contact";
  const yourNamePart = host.clientName || "Guy Wilson";
  const summary = `${leadNamePart} and ${yourNamePart} meeting`;

  const descriptionLines = [];
  if (host.meetingLink) {
    descriptionLines.push(`Zoom: ${host.meetingLink}`);
  }
  if (leadLinkedIn && String(leadLinkedIn).trim()) {
    descriptionLines.push(`${leadNamePart}: ${String(leadLinkedIn).trim()}`);
  }
  if (host.linkedInUrl || host.phone) {
    let yourLine = `${yourNamePart}: `;
    if (host.linkedInUrl) yourLine += host.linkedInUrl;
    if (host.linkedInUrl && host.phone) yourLine += " | ";
    if (host.phone) yourLine += host.phone;
    descriptionLines.push(yourLine);
  }

  const notes = guestNotes && String(guestNotes).trim();
  if (notes) {
    descriptionLines.push("");
    descriptionLines.push("Notes from guest:");
    descriptionLines.push(notes);
  }

  const description = descriptionLines.join("\n");
  const location = host.meetingLink || "Zoom";

  return {
    summary,
    description,
    location,
    durationMinutes: 30,
    hostClientId: host.clientId,
    hostClientName: yourNamePart,
  };
}

module.exports = {
  fetchHostClientProfile,
  buildGuestBookingEventDetails,
  DEFAULT_CLIENT_ID,
};
