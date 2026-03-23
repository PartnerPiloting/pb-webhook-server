/**
 * Rule-based Outbound Email Score (0–10) from LinkedIn-style raw profile JSON/text.
 * Mirrors the rubric in outboundEmailScoreService.buildOesSystemInstruction (no Gemini).
 */

const RE = {
  inflectionStrong:
    /\b(advisor|adviser|consulting|consultant|fractional|portfolio\s+career|non-executive|non executive|\bned\b|board\s+(member|director|role)|independent\s+(advisor|consultant)|\bbuilding\b|\bexploring\b|helping\s+organisations?\s+navigate|navigate\s+change)\b/i,
  inflectionModerate:
    /\b(transformation|organizational\s+change|organisational\s+change|strategic\s+change|next\s+chapter|career\s+transition|portfolio\s+life)\b/i,
  collabStrong:
    /\b(collaboration|partnerships?|ecosystem|connecting\s+people|community\s+building|\bcommunity\b.*\bnetwork|\badvocacy\b|mentoring|building\s+relationships|network\s+of)\b/i,
  collabModerate:
    /\b(stakeholder\s+engagement|cross-?functional|cross\s+functional|people\s+leadership|team\s+leadership)\b/i,
  futureStrong:
    /\b(\bai\b|artificial\s+intelligence|machine\s+learning|\bml\b|automation|future\s+of\s+work|disruption|disruptive\s+innovation|\binnovation\b)\b/i,
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

  let inflection = 0;
  if (RE.inflectionStrong.test(blob)) {
    inflection = 4;
  } else {
    const moderate = RE.inflectionModerate.test(blob);
    const longT = hasLongTenureSignal(blob);
    if (moderate || longT) inflection = 3;
    else if (RE.seniorStrong.test(blob) || RE.seniorModerate.test(blob)) inflection = 1;
  }

  let collaboration = 0;
  if (RE.collabStrong.test(blob)) collaboration = 3;
  else if (RE.collabModerate.test(blob)) collaboration = 2;
  else if (/\b(leadership|teams?\b|people)\b/i.test(blob)) collaboration = 1;

  let futureAwareness = 0;
  if (RE.futureStrong.test(blob)) futureAwareness = 2;
  else if (RE.futureModerate.test(blob) || /\bstrategy\b/i.test(blob)) futureAwareness = 1;

  let expression = 0;
  const fp = countFirstPersonPhrases(blob);
  if (RE.expressionStrong.test(blob) || fp >= 12) expression = 2;
  else if (fp >= 5) expression = 1;

  let seniority = 0;
  if (RE.seniorJunior.test(blob)) seniority = 0;
  else if (RE.seniorStrong.test(blob)) seniority = 2;
  else if (RE.seniorModerate.test(blob)) seniority = 1;

  let negativeAdjustment = 0;
  const narrativeLen = blob.replace(/\s+/g, ' ').length;
  const hasMovement = RE.inflectionStrong.test(blob) || RE.inflectionModerate.test(blob) || hasLongTenureSignal(blob);

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

  const rawSum = inflection + collaboration + futureAwareness + expression + seniority - negativeAdjustment;
  const score = Math.max(0, Math.min(10, Math.round(rawSum)));

  const breakdown = {
    inflection,
    collaboration,
    future_awareness: futureAwareness,
    expression,
    seniority,
    negative_adjustment: -negativeAdjustment,
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
};
