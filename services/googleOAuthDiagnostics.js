/**
 * Step-by-step Google OAuth diagnostics (Gmail + Calendar guest booking).
 * Use on Render (debug URL) or locally: node scripts/diagnose-google-oauth-scopes.js
 */

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/**
 * @returns {Promise<{ ok: boolean, steps: Array<{ name: string, ok: boolean, [k: string]: any }> }>}
 */
async function runGoogleOAuthDiagnostics() {
  const steps = [];

  const rawRefresh = process.env.GMAIL_REFRESH_TOKEN;
  const refresh = rawRefresh ? String(rawRefresh).trim() : "";
  if (rawRefresh && rawRefresh !== refresh) {
    steps.push({
      name: "env_GMAIL_REFRESH_TOKEN_trim",
      ok: true,
      hint: "Token had leading/trailing whitespace — trim in Render to avoid issues.",
    });
  }

  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  steps.push({
    name: "env_client_credentials",
    ok: !!(id && clientSecret && refresh),
    hasClientId: !!id,
    hasClientSecret: !!clientSecret,
    hasRefreshToken: !!refresh,
    refreshTokenLength: refresh ? refresh.length : 0,
  });

  if (!id || !clientSecret || !refresh) {
    steps.push({
      name: "abort",
      ok: false,
      error: "Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN",
    });
    const failed = steps.filter((s) => s.ok === false);
    return {
      ok: false,
      steps,
      failedStepNames: failed.map((s) => s.name),
    };
  }

  const { google } = require("googleapis");
  const oauth2 = new google.auth.OAuth2(id, clientSecret);
  oauth2.setCredentials({ refresh_token: refresh });

  let accessToken;
  try {
    const tokenRes = await oauth2.getAccessToken();
    accessToken = tokenRes?.token;
    steps.push({
      name: "oauth2_getAccessToken",
      ok: !!accessToken,
    });
  } catch (e) {
    steps.push({
      name: "oauth2_getAccessToken",
      ok: false,
      error: e.message || String(e),
    });
    const failed = steps.filter((s) => s.ok === false);
    return {
      ok: false,
      steps,
      failedStepNames: failed.map((s) => s.name),
    };
  }

  try {
    const ti = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    const info = await ti.json();
    if (info.error) {
      steps.push({
        name: "tokeninfo",
        ok: false,
        error: info.error,
        description: info.error_description,
      });
    } else {
      const scopes = (info.scope || "").split(/\s+/).filter(Boolean);
      const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
      steps.push({
        name: "tokeninfo_scopes",
        ok: missing.length === 0,
        scope: info.scope,
        scopesArray: scopes,
        missingScopes: missing,
      });
    }
  } catch (e) {
    steps.push({
      name: "tokeninfo",
      ok: false,
      error: e.message || String(e),
    });
  }

  try {
    const auth = oauth2;
    const calendar = google.calendar({ version: "v3", auth });
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: tomorrow.toISOString(),
        items: [{ id: "primary" }],
      },
    });
    steps.push({
      name: "calendar_freebusy_query",
      ok: true,
    });
  } catch (e) {
    const msg = e.message || String(e);
    const errData = e.response?.data?.error || e.errors?.[0];
    steps.push({
      name: "calendar_freebusy_query",
      ok: false,
      error: msg,
      googleError: errData,
    });
  }

  try {
    const {
      getOAuthPrimaryBatchAvailability,
    } = require("./calendarOAuthAvailability.js");
    const tz = "Australia/Brisbane";
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replace(/\//g, "-");
    const today = new Date(`${todayStr}T12:00:00`);
    const dates = [today.toISOString().split("T")[0]];
    const { days, error } = await getOAuthPrimaryBatchAvailability(
      dates,
      9,
      17,
      tz
    );
    steps.push({
      name: "guest_availability_helper",
      ok: !error,
      error: error || null,
      dayCount: days?.length,
      firstDaySlots: days?.[0]?.freeSlots?.length,
    });
  } catch (e) {
    steps.push({
      name: "guest_availability_helper",
      ok: false,
      error: e.message || String(e),
    });
  }

  const failed = steps.filter((s) => s.ok === false);
  return {
    ok: failed.length === 0,
    steps,
    failedStepNames: failed.map((s) => s.name),
  };
}

module.exports = { runGoogleOAuthDiagnostics, REQUIRED_SCOPES };
