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
    // Create date range in the specified timezone
    const startTime = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
    const endTime = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`);
    
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

module.exports = {
    calendarClient,
    serviceAccountEmail,
    getFreeBusy,
    getFreeSlotsForDate,
};
