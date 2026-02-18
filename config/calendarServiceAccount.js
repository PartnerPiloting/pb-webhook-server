// config/calendarServiceAccount.js
// Service account-based Google Calendar access (no OAuth required)

require('dotenv').config();

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let calendarClient = null;
let serviceAccountEmail = null;

try {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (!credentialsPath) {
        console.warn('[CalendarServiceAccount] GOOGLE_APPLICATION_CREDENTIALS not set');
    } else if (!fs.existsSync(credentialsPath)) {
        console.warn(`[CalendarServiceAccount] Credentials file not found: ${credentialsPath}`);
    } else {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        serviceAccountEmail = credentials.client_email;
        
        const auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });
        
        calendarClient = google.calendar({ version: 'v3', auth });
        
        console.log(`[CalendarServiceAccount] Initialized with service account: ${serviceAccountEmail}`);
    }
} catch (error) {
    console.error('[CalendarServiceAccount] Failed to initialize:', error.message);
}

/**
 * Check availability for a calendar using service account
 * The calendar must be shared with the service account email
 * 
 * @param {string} calendarEmail - The email of the calendar to check (e.g., user@gmail.com)
 * @param {Date} timeMin - Start of time range
 * @param {Date} timeMax - End of time range
 * @returns {Promise<{busy: Array, error?: string}>}
 */
async function getFreeBusy(calendarEmail, timeMin, timeMax) {
    if (!calendarClient) {
        return { busy: [], error: 'Calendar service not initialized' };
    }
    
    try {
        const response = await calendarClient.freebusy.query({
            requestBody: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                items: [{ id: calendarEmail }],
            },
        });
        
        const calendars = response.data.calendars || {};
        const calendarData = calendars[calendarEmail];
        
        if (calendarData?.errors?.length > 0) {
            const error = calendarData.errors[0];
            if (error.reason === 'notFound') {
                return { busy: [], error: `Calendar not shared with service account. Share your calendar with: ${serviceAccountEmail}` };
            }
            return { busy: [], error: `Calendar error: ${error.reason}` };
        }
        
        return { busy: calendarData?.busy || [] };
    } catch (error) {
        console.error('[CalendarServiceAccount] FreeBusy error:', error.message);
        return { busy: [], error: error.message };
    }
}

/**
 * Get free time slots for a specific date
 * 
 * @param {string} calendarEmail - The email of the calendar to check
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} startHour - Start hour (0-23)
 * @param {number} endHour - End hour (0-23)
 * @param {string} timezone - Timezone string (e.g., 'Australia/Brisbane')
 * @returns {Promise<{slots: Array<{start: string, end: string}>, error?: string}>}
 */
async function getFreeSlotsForDate(calendarEmail, date, startHour = 9, endHour = 17, timezone = 'Australia/Brisbane') {
    // Get the timezone offset for the target date
    // Brisbane is UTC+10, Sydney is UTC+10 or UTC+11 (DST)
    const getTimezoneOffset = (tz, dateStr) => {
        const testDate = new Date(`${dateStr}T12:00:00Z`);
        const formatter = new Intl.DateTimeFormat('en-US', { 
            timeZone: tz, 
            timeZoneName: 'shortOffset' 
        });
        const parts = formatter.formatToParts(testDate);
        const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
        const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
        if (!match) return 10 * 60; // Default to Brisbane UTC+10
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || '0', 10);
        return sign * (hours * 60 + minutes);
    };
    
    const offsetMinutes = getTimezoneOffset(timezone, date);
    
    // Create times in the target timezone by adjusting from UTC
    // e.g., 9am Brisbane (UTC+10) = 9am - 10h = previous day 11pm UTC
    const startTime = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00Z`);
    startTime.setMinutes(startTime.getMinutes() - offsetMinutes);
    
    const endTime = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00Z`);
    endTime.setMinutes(endTime.getMinutes() - offsetMinutes);
    
    console.log(`[CalendarServiceAccount] getFreeSlotsForDate: ${date} ${startHour}:00-${endHour}:00 ${timezone} (offset: ${offsetMinutes}min)`);
    console.log(`[CalendarServiceAccount] Query range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    const { busy, error } = await getFreeBusy(calendarEmail, startTime, endTime);
    
    if (error) {
        return { slots: [], error };
    }
    
    // Calculate free slots (30-minute intervals)
    const slots = [];
    let current = new Date(startTime);
    const slotDuration = 30 * 60 * 1000; // 30 minutes
    
    while (current.getTime() + slotDuration <= endTime.getTime()) {
        const slotEnd = new Date(current.getTime() + slotDuration);
        
        // Check if this slot overlaps with any busy period
        const isBusy = busy.some(period => {
            const busyStart = new Date(period.start);
            const busyEnd = new Date(period.end);
            return current < busyEnd && slotEnd > busyStart;
        });
        
        if (!isBusy) {
            slots.push({
                start: current.toISOString(),
                end: slotEnd.toISOString(),
            });
        }
        
        current = slotEnd;
    }
    
    return { slots };
}

/**
 * Get calendar events for a specific date
 * 
 * @param {string} calendarEmail - The email of the calendar to check
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} timezone - Timezone string (e.g., 'Australia/Brisbane')
 * @returns {Promise<{events: Array<{summary: string, start: string, end: string}>, error?: string}>}
 */
async function getEventsForDate(calendarEmail, date, timezone = 'Australia/Brisbane') {
    if (!calendarClient) {
        console.error('[CalendarServiceAccount] getEventsForDate: Calendar client not initialized');
        return { events: [], error: 'Calendar service not initialized' };
    }
    
    console.log(`[CalendarServiceAccount] getEventsForDate: calendarEmail=${calendarEmail}, date=${date}, timezone=${timezone}`);
    
    try {
        // Get timezone offset for proper date range
        const getTimezoneOffset = (tz, dateStr) => {
            const testDate = new Date(`${dateStr}T12:00:00Z`);
            const formatter = new Intl.DateTimeFormat('en-US', { 
                timeZone: tz, 
                timeZoneName: 'shortOffset' 
            });
            const parts = formatter.formatToParts(testDate);
            const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
            const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
            if (!match) return 10 * 60; // Default to Brisbane UTC+10
            const sign = match[1] === '+' ? 1 : -1;
            const hours = parseInt(match[2], 10);
            const minutes = parseInt(match[3] || '0', 10);
            return sign * (hours * 60 + minutes);
        };
        
        const offsetMinutes = getTimezoneOffset(timezone, date);
        
        // Get events for the full day in the target timezone
        const startTime = new Date(`${date}T00:00:00Z`);
        startTime.setMinutes(startTime.getMinutes() - offsetMinutes);
        
        const endTime = new Date(`${date}T23:59:59Z`);
        endTime.setMinutes(endTime.getMinutes() - offsetMinutes);
        
        console.log(`[CalendarServiceAccount] Querying events from ${startTime.toISOString()} to ${endTime.toISOString()} (${timezone})`);
        
        const response = await calendarClient.events.list({
            calendarId: calendarEmail,
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        
        console.log(`[CalendarServiceAccount] Raw response items: ${response.data.items?.length || 0}`);
        
        const events = (response.data.items || []).map(event => ({
            summary: event.summary || '(No title)',
            start: event.start?.dateTime || event.start?.date,
            end: event.end?.dateTime || event.end?.date,
            location: event.location || '',
            // transparency: 'transparent' = Free/Available, 'opaque' (default) = Busy
            transparency: event.transparency || 'opaque',
            isFree: event.transparency === 'transparent',
        }));
        
        console.log(`[CalendarServiceAccount] Returning ${events.length} events`);
        
        return { events };
    } catch (error) {
        console.error('[CalendarServiceAccount] Events error:', error.message, error.code, error.errors);
        if (error.code === 404) {
            return { events: [], error: `Calendar not accessible. Share your calendar with: ${serviceAccountEmail}` };
        }
        return { events: [], error: error.message };
    }
}

/**
 * BATCH: Get availability for multiple days in a single freebusy query + events query
 * This is MUCH faster than calling getEventsForDate/getFreeSlotsForDate in a loop
 * 
 * @param {string} calendarEmail - The email of the calendar to check
 * @param {string[]} dates - Array of dates in YYYY-MM-DD format
 * @param {number} startHour - Start hour for availability (0-23)
 * @param {number} endHour - End hour for availability (0-23)
 * @param {string} timezone - Timezone string (e.g., 'Australia/Brisbane')
 * @returns {Promise<{days: Array<{date, day, events, freeSlots}>, error?: string}>}
 */
async function getBatchAvailability(calendarEmail, dates, startHour = 9, endHour = 17, timezone = 'Australia/Brisbane') {
    if (!calendarClient) {
        return { days: [], error: 'Calendar service not initialized' };
    }
    
    if (!dates || dates.length === 0) {
        return { days: [], error: 'No dates provided' };
    }
    
    console.log(`[CalendarServiceAccount] getBatchAvailability: ${dates.length} days, ${startHour}:00-${endHour}:00 ${timezone}`);
    
    // Helper to get timezone offset
    const getTimezoneOffset = (tz, dateStr) => {
        const testDate = new Date(`${dateStr}T12:00:00Z`);
        const formatter = new Intl.DateTimeFormat('en-US', { 
            timeZone: tz, 
            timeZoneName: 'shortOffset' 
        });
        const parts = formatter.formatToParts(testDate);
        const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
        const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
        if (!match) return 10 * 60; // Default to Brisbane UTC+10
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || '0', 10);
        return sign * (hours * 60 + minutes);
    };
    
    try {
        const offsetMinutes = getTimezoneOffset(timezone, dates[0]);
        
        // Get the full date range for batch query
        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        
        // Query the entire range at once for freebusy
        const rangeStart = new Date(`${firstDate}T00:00:00Z`);
        rangeStart.setMinutes(rangeStart.getMinutes() - offsetMinutes);
        
        const rangeEnd = new Date(`${lastDate}T23:59:59Z`);
        rangeEnd.setMinutes(rangeEnd.getMinutes() - offsetMinutes);
        
        console.log(`[CalendarServiceAccount] Batch query range: ${rangeStart.toISOString()} to ${rangeEnd.toISOString()}`);
        
        // Run freebusy and events queries in parallel (2 API calls instead of 42!)
        const [freebusyResponse, eventsResponse] = await Promise.all([
            calendarClient.freebusy.query({
                requestBody: {
                    timeMin: rangeStart.toISOString(),
                    timeMax: rangeEnd.toISOString(),
                    items: [{ id: calendarEmail }],
                },
            }),
            calendarClient.events.list({
                calendarId: calendarEmail,
                timeMin: rangeStart.toISOString(),
                timeMax: rangeEnd.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 250, // Reasonable limit for multi-week range
            }),
        ]);
        
        // Extract busy periods
        const calendars = freebusyResponse.data.calendars || {};
        const calendarData = calendars[calendarEmail];
        
        if (calendarData?.errors?.length > 0) {
            const error = calendarData.errors[0];
            if (error.reason === 'notFound') {
                return { days: [], error: `Calendar not shared. Share with: ${serviceAccountEmail}` };
            }
            return { days: [], error: `Calendar error: ${error.reason}` };
        }
        
        const allBusyPeriods = calendarData?.busy || [];
        const allEvents = (eventsResponse.data.items || []).map(event => ({
            summary: event.summary || '(No title)',
            start: event.start?.dateTime || event.start?.date,
            end: event.end?.dateTime || event.end?.date,
            location: event.location || '',
            // transparency: 'transparent' = Free/Available, 'opaque' (default) = Busy
            transparency: event.transparency || 'opaque',
            isFree: event.transparency === 'transparent',
        }));
        
        console.log(`[CalendarServiceAccount] Batch result: ${allBusyPeriods.length} busy periods, ${allEvents.length} events`);
        
        // Process each date
        const days = dates.map(date => {
            const dateObj = new Date(date);
            const dayLabel = dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', timeZone: timezone });
            
            // Filter events for this date
            const dayEvents = allEvents.filter(event => {
                const eventDate = event.start.split('T')[0];
                return eventDate === date;
            });
            
            // Calculate free slots for this date
            const dayStart = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00Z`);
            dayStart.setMinutes(dayStart.getMinutes() - offsetMinutes);
            
            const dayEnd = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00Z`);
            dayEnd.setMinutes(dayEnd.getMinutes() - offsetMinutes);
            
            // Filter busy periods that overlap with this day's working hours
            const dayBusy = allBusyPeriods.filter(period => {
                const busyStart = new Date(period.start);
                const busyEnd = new Date(period.end);
                return busyStart < dayEnd && busyEnd > dayStart;
            });
            
            // Calculate free 30-minute slots
            // Note: freebusy API only returns truly busy (opaque) events as busy periods
            // Events marked as "free" (transparent) don't block the slot but we track them as soft conflicts
            const freeSlots = [];
            const slotDuration = 30 * 60 * 1000;
            let current = new Date(dayStart);
            
            // Get events marked as "free" (transparent) for soft conflict detection
            const freeEvents = dayEvents.filter(e => e.isFree);
            
            while (current.getTime() + slotDuration <= dayEnd.getTime()) {
                const slotEnd = new Date(current.getTime() + slotDuration);
                
                const isBusy = dayBusy.some(period => {
                    const busyStart = new Date(period.start);
                    const busyEnd = new Date(period.end);
                    return current < busyEnd && slotEnd > busyStart;
                });
                
                if (!isBusy) {
                    // Check for soft conflicts (events marked as "free" that overlap)
                    const overlappingFreeEvents = freeEvents.filter(event => {
                        const eventStart = new Date(event.start);
                        const eventEnd = new Date(event.end);
                        return current < eventEnd && slotEnd > eventStart;
                    });
                    
                    const slot = {
                        time: current.toISOString(),
                        display: current.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: timezone }),
                        displayRange: `${current.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: timezone })}`,
                    };
                    
                    // Add soft conflict info if there are overlapping "free" events
                    if (overlappingFreeEvents.length > 0) {
                        slot.softConflict = overlappingFreeEvents.map(e => e.summary).join(', ');
                    }
                    
                    freeSlots.push(slot);
                }
                
                current = slotEnd;
            }
            
            return {
                date,
                day: dayLabel,
                events: dayEvents,
                freeSlots,
            };
        });
        
        return { days };
        
    } catch (error) {
        console.error('[CalendarServiceAccount] Batch error:', error.message, error.code);
        return { days: [], error: error.message };
    }
}

/**
 * Get the next upcoming meeting(s) where the given attendee email is invited
 * Used by Smart FUP to show "Next meeting: ..." when a future meeting exists with the lead
 *
 * @param {string} calendarEmail - The calendar to check (client's Google Calendar Email)
 * @param {string} attendeeEmail - Lead's email to match in event attendees
 * @param {number} daysAhead - How many days ahead to search (default 90)
 * @param {string} timezone - Timezone for date range (e.g., 'Australia/Brisbane')
 * @returns {Promise<{meeting: {summary, start, end, displayDate} | null, error?: string}>}
 */
async function getUpcomingMeetingsWithAttendee(calendarEmail, attendeeEmail, daysAhead = 90, timezone = 'Australia/Brisbane') {
    if (!calendarClient) {
        return { meeting: null, error: 'Calendar service not initialized' };
    }
    if (!attendeeEmail || !attendeeEmail.trim()) {
        return { meeting: null };
    }

    const normalizedLeadEmail = attendeeEmail.trim().toLowerCase();
    if (!normalizedLeadEmail) return { meeting: null };

    try {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + daysAhead);

        const response = await calendarClient.events.list({
            calendarId: calendarEmail,
            timeMin: now.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 100,
        });

        const items = response.data.items || [];
        const match = items.find(event => {
            const attendees = event.attendees || [];
            return attendees.some(a => String(a.email || '').toLowerCase() === normalizedLeadEmail);
        });

        if (!match) {
            return { meeting: null };
        }

        const start = match.start?.dateTime || match.start?.date;
        const end = match.end?.dateTime || match.end?.date;
        const summary = match.summary || '(No title)';

        if (!start) return { meeting: null };

        const startDate = new Date(start);
        const displayDate = startDate.toLocaleString('en-AU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: timezone,
        });

        return {
            meeting: {
                summary,
                start,
                end: end || '',
                displayDate,
            },
        };
    } catch (error) {
        console.error('[CalendarServiceAccount] getUpcomingMeetingsWithAttendee error:', error.message);
        if (error.code === 404) {
            return { meeting: null, error: `Calendar not shared with service account` };
        }
        return { meeting: null, error: error.message };
    }
}

module.exports = {
    calendarClient,
    serviceAccountEmail,
    getFreeBusy,
    getFreeSlotsForDate,
    getEventsForDate,
    getBatchAvailability,
    getUpcomingMeetingsWithAttendee,
};
