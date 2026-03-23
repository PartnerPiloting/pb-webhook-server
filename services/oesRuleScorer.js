/**
 * Rule-based Outbound Email Score (0–10) from LinkedIn-style raw profile JSON/text.
 * Mirrors the rubric in outboundEmailScoreService.buildOesSystemInstruction (no Gemini).
 *
 * Calibration: category points are conservative (multi-signal for top buckets); seniority is
 * capped without other signals; summed points are compressed onto 0–10 (see compressRawSumToDisplayScore).
 * Tune regexes / thresholds here; adjust compression formula if scores cluster too high/low.
 *
 * If future_awareness stays 0, a heavy raw penalty applies (default −4) so non-tech narratives
 * sink unless they show digital/innovation/AI language. Set OES_NO_FUTURE_TECH_RAW_PENALTY=0 to disable.
 */

const RE = {
  inflectionModerate:
    /\b(transformation|organizational\s+change|organisational\s+change|strategic\s+change|next\s+chapter|career\s+transition|portfolio\s+life)\b/i,
  collabStrong:
    /\b(collaboration|partnerships?|ecosystem|connecting\s+people|community\s+building|\bcommunity\b.*\bnetwork|\badvocacy\b|mentoring|building\s+relationships|network\s+of)\b/i,
  collabModerate:
    /\b(stakeholder\s+engagement|cross-?functional|cross\s+functional|people\s+leadership|team\s+leadership)\b/i,
  futureModerate:
    /\b(digital\s+transformation|digital\s+strategy|change\s+management|business\s+transformation)\b/i,
  expressionStrong: /\b(i\s+believe|i\s+help|i\s+work|i\s+lead|i\s+am\s+passionate|i'm\s+passionate|i\s+love\s+to|my\s+mission|my\s+approach)\b/i,
  seniorStrong:
    /\b(chief\s+|ceo|cfo|cto|coo|cmo|cpo|cio|vp\b|vice\s+president|svp\b|evp\b|director|head\s+of|general\s+manager|\bgm\b|managing\s+director|partner|principal|president)\b/i,
  seniorModerate: /\b(manager|lead\b|senior\s+manager|senior\s+lead|group\s+lead|team\s+lead)\b/i,
  seniorJunior: /\b(intern|graduate|junior|entry[\s-]level|assistant(?!.*manager))\b/i,
  technicalIc:
    /\b(software\s+engineer|developer|programmer|devops|sre\b|data\s+scientist|analyst)\b/i,
  transactional:
    /\b(open\s+to\s+work|#opentowork|dm\s+me|slide\s+into\s+my\s+dms|hiring\s+now|we'?re\s+hiring)\b/i,
};

function parseProfileObject(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function buildSearchBlob(obj, textFromRaw) {
  const chunks = [];
  const push = (v) => {
    if (v != null && String(v).trim()) chunks.push(String(v));
  };
  push(textFromRaw);
  if (obj && typeof obj === 'object') {
    push(obj.headline);
    push(obj.title);
    push(obj.occupation);
    push(obj.summary);
    push(obj.about);
    push(obj.linkedinDescription);
    push(obj.description);
    const exp = obj.experience || obj.positions || obj.workExperience || [];
    if (Array.isArray(exp)) {
      for (const row of exp.slice(0, 15)) {
        if (!row || typeof row !== 'object') continue;
        push(row.title);
        push(row.companyName || row.company || row.companyLinkedinUrl);
        push(row.description || row.summary);
      }
    }
    const skills = obj.skills || obj.topSkillsByEndorsements;
    if (Array.isArray(skills)) {
      for (const sk of skills.slice(0, 40)) {
        if (typeof sk === 'string') push(sk);
        else if (sk && sk.name) push(sk.name);
      }
    }
  }
  return chunks.join('\n').toLowerCase();
}

function hasLongTenureSignal(blob) {
  if (/\b(8|9|10|11|12|13|14|15|16|17|18|19|20)\+?\s*years?\b/i.test(blob)) return true;
  if (/\b\d{1,2}\s*years?\s+(at|with|in)\b/i.test(blob)) return true;
  if (/\b(20[0-2]\d|199\d)\s*[\u2013\-–]\s*(present|now|current)\b/i.test(blob)) return true;
  return false;
}

function countFirstPersonPhrases(blob) {
  const m = blob.match(/\b(i|my|me)\b/g);
  return m ? m.length : 0;
}

/** Distinct “movement / next chapter” strong themes (need 2+ or 1+moderate for max inflection). */
function countInflectionStrongGroups(blob) {
  let n = 0;
  if (/\b(advisor|adviser|consulting|consultant|fractional)\b/i.test(blob)) n++;
  if (/\b(portfolio\s+career|non-executive|non\s+executive|\bned\b|board\s+(member|director|role))\b/i.test(blob)) n++;
  if (/\b(independent\s+(advisor|consultant))\b/i.test(blob)) n++;
  if (/\b(building|exploring)\b/i.test(blob)) n++;
  if (/\bhelping\s+organisations?\s+navigate|navigate\s+change\b/i.test(blob)) n++;
  return n;
}

/** Collaboration evidence strength (multiple signals needed for 3/3). */
function collaborationStrength(blob) {
  let w = 0;
  if (RE.collabStrong.test(blob)) w += 2;
  if (RE.collabModerate.test(blob)) w += 1;
  if (/\b(leadership)\b/i.test(blob) && RE.collabModerate.test(blob)) w += 0.5;
  return w;
}

/**
 * Map summed rubric points (~0–13 before negatives) onto 0–10 with compression so
 * “everything maxes” is rare. Tuned for outbound prioritisation, not exam grades.
 */
function compressRawSumToDisplayScore(rawSum) {
  const x = Math.max(-4, Math.min(15, rawSum));
  return Math.max(0, Math.min(10, Math.round(x * 0.62 + 1.35)));
}

/** Strong tech / AI / future-of-work cues → futureAwareness = 2 */
function hasFutureStrongSignal(blob) {
  return /\b(\bai\b|artificial\s+intelligence|generative\s+ai|gen\s*ai|machine\s+learning|\bml\b|\bllm\b|large\s+language|chatgpt|gpt-?\d|automation|future\s+of\s+work|disruption|disruptive\s+innovation)\b/i.test(
    blob
  );
}

/** Moderate digital / change / innovation language → futureAwareness = 1 */
function hasFutureModerateSignal(blob) {
  return (
    RE.futureModerate.test(blob) ||
    /\b(digital|business)\s+strategy\b/i.test(blob) ||
    /\binnovation\b/i.test(blob) ||
    /\b(emerging\s+tech|technology\s+leadership|tech-?enabled)\b/i.test(blob)
  );
}

const NO_FUTURE_TECH_RAW_PENALTY = Math.min(
  8,
  Math.max(0, parseInt(process.env.OES_NO_FUTURE_TECH_RAW_PENALTY || '4', 10))
);

function classify(score) {
  if (score >= 9) return 'Pod Builder Potential';
  if (score >= 7) return 'High Priority';
  if (score >= 5) return 'Medium';
  return 'Low Priority';
}

/**
 * @param {string|object} raw — Raw Profile Data field value
 * @returns {{ ok: true, score: number, classification: string, breakdown: object } | { ok: false, error: string }}
 */
function scoreRawProfileForOesRules(raw) {
  const obj = parseProfileObject(raw);
  let textFromRaw = '';
  if (typeof raw === 'string') textFromRaw = raw;
  else if (obj) {
    try {
      textFromRaw = JSON.stringify(obj);
    } catch {
      textFromRaw = '';
    }
  }

  if (!String(textFromRaw).trim() && !obj) {
    return { ok: false, error: 'Empty raw profile' };
  }

  const blob = buildSearchBlob(obj, textFromRaw);
  if (!blob.trim()) {
    return { ok: false, error: 'Empty raw profile' };
  }

  const moderate = RE.inflectionModerate.test(blob);
  const longT = hasLongTenureSignal(blob);
  const strongGroups = countInflectionStrongGroups(blob);

  let inflection = 0;
  if (strongGroups >= 2 || (strongGroups >= 1 && moderate)) {
    inflection = 4;
  } else if (strongGroups === 1) {
    inflection = 3;
  } else if (moderate && longT) {
    inflection = 3;
  } else if (moderate || longT) {
    inflection = 2;
  } else if (RE.seniorStrong.test(blob) || RE.seniorModerate.test(blob)) {
    inflection = 1;
  }

  let collaboration = 0;
  const collabW = collaborationStrength(blob);
  if (collabW >= 3) collaboration = 3;
  else if (collabW >= 2) collaboration = 2;
  else if (collabW >= 1) collaboration = 1;
  else if (/\bteam(s)?\b/i.test(blob) && /\blead(er|ing)?\b/i.test(blob)) collaboration = 1;

  let futureAwareness = 0;
  if (hasFutureStrongSignal(blob)) {
    futureAwareness = 2;
  } else if (hasFutureModerateSignal(blob)) {
    futureAwareness = 1;
  }

  const noFutureTechPenalty =
    futureAwareness === 0 && NO_FUTURE_TECH_RAW_PENALTY > 0 ? NO_FUTURE_TECH_RAW_PENALTY : 0;

  let expression = 0;
  const fp = countFirstPersonPhrases(blob);
  if (RE.expressionStrong.test(blob) || fp >= 22) {
    expression = 2;
  } else if (fp >= 10) {
    expression = 1;
  }

  let seniority = 0;
  if (RE.seniorJunior.test(blob)) {
    seniority = 0;
  } else {
    const hasSubstance =
      inflection >= 2 || collaboration >= 2 || futureAwareness >= 1 || expression >= 1;
    if (RE.seniorStrong.test(blob)) {
      seniority = hasSubstance ? 2 : 1;
    } else if (RE.seniorModerate.test(blob)) {
      seniority = hasSubstance ? 1 : 0;
    }
  }

  let negativeAdjustment = 0;
  const narrativeLen = blob.replace(/\s+/g, ' ').length;
  const hasMovement = strongGroups >= 1 || moderate || longT;

  if (narrativeLen < 120 && !hasMovement && RE.seniorStrong.test(blob)) {
    negativeAdjustment += 2;
  }

  if (
    RE.technicalIc.test(blob) &&
    !/\b(director|head\s+of|vp\b|vice\s+president|chief|principal|architect|manager|lead\b)\b/i.test(blob)
  ) {
    negativeAdjustment += 2;
  }

  if (RE.transactional.test(blob)) {
    negativeAdjustment += 1;
  }

  const rawSum =
    inflection +
    collaboration +
    futureAwareness +
    expression +
    seniority -
    negativeAdjustment -
    noFutureTechPenalty;
  const score = compressRawSumToDisplayScore(rawSum);

  const breakdown = {
    inflection,
    collaboration,
    future_awareness: futureAwareness,
    expression,
    seniority,
    negative_adjustment: -negativeAdjustment,
    no_future_tech_penalty_raw: noFutureTechPenalty > 0 ? -noFutureTechPenalty : 0,
    raw_sum: Math.round(rawSum * 10) / 10,
  };

  return {
    ok: true,
    score,
    classification: classify(score),
    breakdown,
  };
}

module.exports = {
  scoreRawProfileForOesRules,
  buildSearchBlob,
  classify,
  compressRawSumToDisplayScore,
};
