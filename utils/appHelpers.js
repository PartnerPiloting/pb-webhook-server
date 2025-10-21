// utils/appHelpers.js

// We need fetch for the alertAdmin function
const fetch = require('node-fetch');
const { createLogger } = require('./contextLogger');

// Create module-level logger for app helpers
const logger = createLogger({ 
    runId: 'SYSTEM', 
    clientId: 'SYSTEM', 
    operation: 'app-helpers' 
});

/* ------------------------------------------------------------------
    helper: alertAdmin  (Mailgun)
------------------------------------------------------------------*/
async function alertAdmin(subject, text) {
    try {
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN || !process.env.ALERT_EMAIL || !process.env.FROM_EMAIL) {
            logger.warn("Mailgun not fully configured, admin alert skipped for:", { subject });
            return;
        }
        const mgUrl = `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`;
        const body = new URLSearchParams({
            from: process.env.FROM_EMAIL,
            to: process.env.ALERT_EMAIL,
            subject: `[LeadScorer-GeminiApp] ${subject}`,
            text
        });
        const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64");
        await fetch(mgUrl, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });
        logger.info("Admin alert sent from appHelpers:", { subject });
    } catch (err) {
        logger.error("alertAdmin error in appHelpers:", { error: err.message });
    }
}

/* ------------------------------------------------------------------
    helper: getJsonUrl
------------------------------------------------------------------*/
function getJsonUrl(obj = {}) {
    return (
        obj?.data?.output?.jsonUrl ||
        obj?.data?.resultObject?.jsonUrl ||
        obj?.data?.resultObject?.output?.jsonUrl ||
        obj?.output?.jsonUrl ||
        obj?.resultObject?.jsonUrl ||
        (() => {
            const m = JSON.stringify(obj).match(/https?:\/\/[^"'\s]+\/result\.json/i);
            return m ? m[0] : null;
        })()
    );
}

/* ------------------------------------------------------------------
    helper: canonicalUrl
------------------------------------------------------------------*/
function canonicalUrl(url = "") {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
}

/* ------------------------------------------------------------------
    helper: isAustralian
------------------------------------------------------------------*/
function isAustralian(loc = "") {
    return /\b(australia|aus|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|nsw|vic|qld|wa|sa|tas|act|nt)\b/i.test(
        loc
    );
}

/* ------------------------------------------------------------------
    helper: safeDate
------------------------------------------------------------------*/
function safeDate(d) {
    if (!d) return null;
    if (d instanceof Date) return isNaN(d) ? null : d;
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(d)) {
        const iso = d.replace(/\./g, "-");
        return new Date(iso + "T00:00:00Z");
    }
    const dt = new Date(d);
    return isNaN(dt) ? null : dt;
}

/* ------------------------------------------------------------------
    helper: getLastTwoOrgs
------------------------------------------------------------------*/
function getLastTwoOrgs(lh = {}) {
    const out = [];
    for (let i = 1; i <= 2; i++) {
        const org = lh[`organization_${i}`];
        const title = lh[`organization_title_${i}`];
        const sr = lh[`organization_start_${i}`];
        const er = lh[`organization_end_${i}`];
        if (!org && !title) continue;
        const range = sr || er ? `(${sr || "?"} – ${er || "Present"})` : "";
        out.push(`${title || "Unknown Role"} at ${org || "Unknown"} ${range}`);
    }
    return out.join("\n");
}

/* ------------------------------------------------------------------
    helper: isMissingCritical (bio ≥40, headline, job-history)
------------------------------------------------------------------*/
function isMissingCritical(profile = {}) {
    const about = (
        profile.about ||
        profile.summary ||
        profile.linkedinDescription ||
        ""
    ).trim();
    const hasBio = about.length >= 40;
    const hasHeadline = !!profile.headline?.trim();
    let hasJob = Array.isArray(profile.experience) && profile.experience.length > 0;
    if (!hasJob) {
        for (let i = 1; i <= 5; i++) {
            if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
                hasJob = true;
                break;
            }
        }
    }
    return !(hasBio && hasHeadline && hasJob);
}

module.exports = {
    alertAdmin,
    getJsonUrl,
    canonicalUrl,
    isAustralian,
    safeDate,
    getLastTwoOrgs,
    isMissingCritical
};