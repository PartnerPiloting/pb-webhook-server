/**
 * Match Recall participant.email to Airtable leads.
 */

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/** @param {object} participant Recall participant object */
function participantEmail(participant) {
  if (!participant || typeof participant !== 'object') return null;
  const e = participant.email;
  if (typeof e !== 'string' || !e.trim()) return null;
  return e.trim().toLowerCase();
}

/**
 * Link one participant email to a lead and return lead id.
 * @returns {Promise<{ leadId: string|null, email: string, matchMethod?: string }>}
 */
async function linkRecallParticipantEmail(email, opts = {}) {
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();
  const log = createSafeLogger('SYSTEM', null, 'recall_lead_link');
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return { leadId: null, email: e };

  let client;
  try {
    client = await clientService.getClientById(coachClientId);
  } catch (err) {
    log.warn(`RECALL-LINK skip: client load ${err.message}`);
    return { leadId: null, email: e, matchMethod: 'client_load_failed' };
  }
  if (!client?.airtableBaseId) {
    return { leadId: null, email: e, matchMethod: 'no_airtable_base' };
  }

  try {
    const lead = await findLeadByEmail(client, e);
    if (lead?.id) return { leadId: lead.id, email: e, matchMethod: 'email' };
  } catch (err) {
    log.warn(`RECALL-LINK findLeadByEmail ${err.message}`);
  }
  return { leadId: null, email: e, matchMethod: 'unmatched' };
}

/**
 * For a Recall meeting, look up the coach's Google Calendar for the event
 * that overlaps the meeting window, and link every non-coach attendee email
 * that resolves to an Airtable lead.
 *
 * Runs on every recording.done/bot.done, not just auto-split cases, so a
 * normal single-meeting recording still gets its attendees linked when
 * Recall didn't capture participant emails.
 *
 * @param {number|string} meetingId
 * @param {{ coachClientId?: string, calendarEmail?: string }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   attendeesChecked?: number,
 *   leadsLinked?: number,
 *   participantsUpdated?: number,
 *   unmatched?: string[],
 *   error?: string,
 *   note?: string,
 * }>}
 */
async function linkMeetingByCalendarAttendees(meetingId, opts = {}) {
  const log = createSafeLogger('SYSTEM', null, 'recall_calendar_link');
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();

  const {
    getMeetingById,
    getParticipantsForMeeting,
    addMeetingLead,
    upsertRecallMeetingParticipant,
  } = require('./recallWebhookDb');

  const meeting = await getMeetingById(meetingId);
  if (!meeting) return { ok: false, error: 'meeting_not_found' };
  if (!meeting.meeting_start || !meeting.meeting_end) {
    return { ok: false, error: 'no_meeting_times' };
  }

  let coach;
  try {
    coach = await clientService.getClientById(coachClientId);
  } catch (err) {
    return { ok: false, error: `client_load_failed: ${err.message}` };
  }
  if (!coach?.airtableBaseId) return { ok: false, error: 'no_airtable_base' };

  const calendarEmail = (opts.calendarEmail || coach.googleCalendarEmail || '').trim();
  if (!calendarEmail) return { ok: false, error: 'no_calendar_email' };

  const recStart = new Date(meeting.meeting_start);
  const recEnd = new Date(meeting.meeting_end);
  if (isNaN(recStart) || isNaN(recEnd)) return { ok: false, error: 'invalid_meeting_times' };

  const padBefore = new Date(recStart.getTime() - 10 * 60 * 1000);
  const padAfter = new Date(recEnd.getTime() + 10 * 60 * 1000);
  const calResult = await listCalendarEventsWithAttendeesInRange(calendarEmail, padBefore, padAfter);
  if (calResult.error) {
    log.warn(`calendar lookup failed for meeting=${meetingId}: ${calResult.error}`);
    return { ok: false, error: `calendar_error: ${calResult.error}` };
  }

  const overlapping = (calResult.events || []).filter((ev) => {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    return s < recEnd && e > recStart;
  });
  if (overlapping.length === 0) {
    return { ok: true, attendeesChecked: 0, leadsLinked: 0, note: 'no_overlapping_events' };
  }

  const coachEmails = new Set();
  coachEmails.add(calendarEmail.toLowerCase());
  if (coach.clientEmailAddress) coachEmails.add(String(coach.clientEmailAddress).toLowerCase().trim());

  const attendeeEmails = new Set();
  for (const ev of overlapping) {
    for (const a of ev.attendees || []) {
      const e = (a.email || '').toLowerCase().trim();
      if (e && e.includes('@') && !coachEmails.has(e)) attendeeEmails.add(e);
    }
  }
  if (attendeeEmails.size === 0) {
    return { ok: true, attendeesChecked: 0, leadsLinked: 0, note: 'no_non_coach_attendees' };
  }

  const participants = await getParticipantsForMeeting(meetingId);
  const result = { ok: true, attendeesChecked: attendeeEmails.size, leadsLinked: 0, participantsUpdated: 0, unmatched: [] };
  const usedParticipantIds = new Set();

  // Resolve each attendee email to an Airtable lead and attach to the meeting.
  const leadsFromCalendar = []; // { email, lead }
  for (const email of attendeeEmails) {
    let lead = null;
    try {
      lead = await findLeadByEmail(coach, email);
    } catch (err) {
      log.warn(`findLeadByEmail failed for ${email}: ${err.message}`);
      continue;
    }
    if (!lead?.id) {
      result.unmatched.push(email);
      continue;
    }

    try {
      await addMeetingLead(meetingId, lead.id, coachClientId, 'calendar_attendee');
      result.leadsLinked++;
      log.info(`linked lead ${lead.id} (${email}) to meeting ${meetingId} via calendar`);
    } catch (err) {
      log.warn(`addMeetingLead failed for meeting=${meetingId} lead=${lead.id}: ${err.message}`);
    }

    leadsFromCalendar.push({ email, lead });
  }

  // Pool of speakers eligible to be matched to a lead:
  // skip the coach, skip any speaker already linked.
  const eligibleSpeakers = participants.filter(
    (p) => !p.airtable_lead_id && String(p.role || '').toLowerCase() !== 'coach'
           && String(p.verified_name || '').trim().length > 0,
  );

  // Pass 1: try to match each calendar lead to a speaker by name.
  for (const { email, lead } of leadsFromCalendar) {
    const leadFirst = String(lead.firstName || '').toLowerCase().trim();
    const leadLast = String(lead.lastName || '').toLowerCase().trim();
    if (!leadFirst && !leadLast) continue;

    const match = eligibleSpeakers.find((p) => {
      if (usedParticipantIds.has(p.id)) return false;
      return participantNameMatchesLead(p.verified_name, leadFirst, leadLast);
    });
    if (!match) continue;

    try {
      await upsertRecallMeetingParticipant({
        meetingId,
        platformParticipantId: match.platform_participant_id,
        speakerLabel: match.speaker_label,
        verifiedName: match.verified_name,
        verifiedEmail: match.verified_email || email,
        role: 'client',
        airtableLeadId: lead.id,
        coachClientId,
        matchMethod: 'calendar_attendee',
      });
      usedParticipantIds.add(match.id);
      match.airtable_lead_id = lead.id; // so Pass 2 doesn't touch this row
      result.participantsUpdated++;
    } catch (err) {
      log.warn(`participant update failed for meeting=${meetingId} speaker="${match.speaker_label}": ${err.message}`);
    }
  }

  // Pass 2: 1:1 safety net. If exactly one lead is still unmatched to a
  // speaker AND exactly one eligible speaker is still unmatched, link them
  // anyway — this covers nickname / display-name mismatches in 1:1 calls.
  const unmatchedLeads = leadsFromCalendar.filter(
    ({ lead }) => ![...usedParticipantIds].some((pid) => {
      const p = participants.find((q) => q.id === pid);
      return p && p.airtable_lead_id === lead.id;
    }),
  );
  const unmatchedSpeakers = eligibleSpeakers.filter((p) => !usedParticipantIds.has(p.id) && !p.airtable_lead_id);

  if (unmatchedLeads.length === 1 && unmatchedSpeakers.length === 1) {
    const { email, lead } = unmatchedLeads[0];
    const speaker = unmatchedSpeakers[0];
    try {
      await upsertRecallMeetingParticipant({
        meetingId,
        platformParticipantId: speaker.platform_participant_id,
        speakerLabel: speaker.speaker_label,
        verifiedName: speaker.verified_name,
        verifiedEmail: speaker.verified_email || email,
        role: 'client',
        airtableLeadId: lead.id,
        coachClientId,
        matchMethod: 'calendar_attendee_1to1',
      });
      result.participantsUpdated++;
      log.info(`1:1 fallback: linked speaker "${speaker.verified_name}" to lead ${lead.id} (${email})`);
    } catch (err) {
      log.warn(`1:1 fallback participant update failed for meeting=${meetingId}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Does the Recall speaker name plausibly refer to the Airtable lead?
 *
 * - If speaker is one word (e.g. "Jules"), match on first name only — allow
 *   either to be a prefix of the other to handle nickname / spelling drift
 *   (Jules / Julie, Matt / Matthew, Dan / Daniel).
 * - If speaker has 2+ words, require the last name as well.
 *
 * @param {string} speakerName
 * @param {string} leadFirst   already lower-cased
 * @param {string} leadLast    already lower-cased
 */
function participantNameMatchesLead(speakerName, leadFirst, leadLast) {
  const pName = String(speakerName || '').toLowerCase().trim();
  if (!pName) return false;
  const pParts = pName.split(/\s+/).filter(Boolean);
  if (pParts.length === 0) return false;

  const speakerFirst = pParts[0];

  const firstNameOk = leadFirst
    ? (speakerFirst === leadFirst
        || speakerFirst.startsWith(leadFirst)
        || leadFirst.startsWith(speakerFirst))
    : true;
  if (!firstNameOk) return false;

  if (pParts.length === 1) return true; // one-word speaker name → first-name match is enough

  if (leadLast && !pName.includes(leadLast)) return false;
  return true;
}

module.exports = {
  DEFAULT_COACH_CLIENT_ID,
  participantEmail,
  linkRecallParticipantEmail,
  linkMeetingByCalendarAttendees,
};
