/**
 * Name Normalizer Utility
 * Handles cleaning and normalizing names, particularly removing professional credential suffixes
 */

// Common professional designations/credentials that appear after names
// These are typically separated by comma or space after the person's actual name
const CREDENTIAL_SUFFIXES = [
  // Australian/International Board & Governance
  'GAICD', 'FAICD', 'MAICD', 'AAICD',
  // Academic degrees
  'PhD', 'DPhil', 'EdD', 'DBA', 'MBA', 'MPA', 'MSc', 'MA', 'MS', 'MEng', 'MFA',
  'BSc', 'BA', 'BEng', 'BCom', 'BBA', 'LLB', 'LLM', 'JD', 'MD', 'DO',
  // Accounting & Finance
  'CPA', 'CA', 'CFA', 'CFP', 'FCPA', 'FCA', 'ACA', 'ACCA', 'CIMA', 'CMA',
  'FCMA', 'MAcc', 'BAcc', 'BBus',
  // C-suite / role designations people append like credentials
  'CEO', 'CFO', 'COO', 'CIO', 'CTO', 'CMO', 'CISO', 'CHRO', 'CDO', 'CRO', 'CPO',
  // Project Management
  'PMP', 'PRINCE2', 'CSM', 'PMI', 'MSP',
  // Technology & Security
  'CISSP', 'CISM', 'CISA', 'CCNA', 'CCNP', 'AWS', 'GCP', 'MCSE', 'ITIL',
  'CGEIT', 'CRISC', 'CDPSE',
  // Human Resources
  'SHRM', 'PHR', 'SPHR', 'GPHR', 'CIPD',
  // Healthcare
  'RN', 'NP', 'PA', 'FACS', 'FACP', 'FRCS',
  // Engineering
  'PE', 'CEng', 'CPEng', 'FIEAust', 'MIEAust', 'RPEQ', 'EngExec', 'CompIEAust', 'FRAES',
  // Academia / other professional bodies
  'SFHEA', 'FHEA', 'AMIIA', 'AICGG',
  // Other common suffixes
  'Esq', 'OAM', 'AM', 'AO', 'AC', 'OM', 'CH', 'CBE', 'OBE', 'MBE', 'KBE', 'DBE',
  'FRSA', 'FRS', 'FIET', 'FBCS', 'FACS'
];

// Build regex pattern - match credentials at end of string, optionally preceded by comma
// Pattern: optional comma + optional spaces + credential + optional more credentials + end of string
const credentialPattern = new RegExp(
  `(?:,?\\s+(?:${CREDENTIAL_SUFFIXES.join('|')}))+\\s*$`,
  'i'
);

/**
 * Strip professional credential suffixes from a name
 * @param {string} name - The name potentially containing credentials
 * @returns {string} - The cleaned name without credentials
 * 
 * @example
 * stripCredentialSuffixes("Carinne Bird, GAICD") // returns "Carinne Bird"
 * stripCredentialSuffixes("John Smith MBA PhD") // returns "John Smith"
 * stripCredentialSuffixes("Jane Doe, CPA, CFA") // returns "Jane Doe"
 * stripCredentialSuffixes("Bob Jones") // returns "Bob Jones" (unchanged)
 */
function stripCredentialSuffixes(name) {
  if (!name || typeof name !== 'string') {
    return name || '';
  }
  
  // Remove credential suffixes from the end
  let cleaned = name.replace(credentialPattern, '').trim();
  
  // Also handle case where comma is left dangling
  cleaned = cleaned.replace(/,\s*$/, '').trim();
  
  return cleaned;
}

/**
 * Normalize a name for matching/comparison
 * Strips credentials, trims whitespace, and optionally lowercases
 * @param {string} name - The name to normalize
 * @param {boolean} lowercase - Whether to lowercase the result (default: false)
 * @returns {string} - The normalized name
 */
function normalizeNameForMatching(name, lowercase = false) {
  let normalized = stripCredentialSuffixes(name);
  if (lowercase) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

const CREDENTIAL_SET = new Set(CREDENTIAL_SUFFIXES.map((c) => c.toLowerCase()));

/**
 * Is this Last Name "broken" — i.e. not a usable surname?
 * True when it's empty, symbol/punctuation-only (e.g. "-", "▪"), or is itself just a
 * professional credential ("Gaicd", "Cfo"). Used to decide whether to fall back to the
 * full display name (original_full_name).
 */
function isBrokenLastName(last) {
  const l = (last || '').trim();
  if (!l) return true;
  if (!l.replace(/[^A-Za-z]/g, '')) return true; // no letters at all → symbol-only
  if (CREDENTIAL_SET.has(l.toLowerCase())) return true; // the whole thing is a credential
  return false;
}

/**
 * Clean a LinkedIn display name (e.g. original_full_name) down to just the person's name:
 * drops trailing credential blobs after a comma, parentheticals, emoji/symbols/decorations
 * (Δ, ▪, ®), a leading title (Dr./Prof./Mr…), and trailing credential tokens.
 * "Bree Taylor CFO" -> "Bree Taylor"; "Allan Ryan -Δ" -> "Allan Ryan";
 * "Dr. Anand Shankaran GAICD, FCPHR" -> "Anand Shankaran".
 */
function cleanFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  let n = fullName.split(',')[0];                  // drop ", CPA, CFA, …"
  n = n.replace(/\([^)]*\)/g, ' ');                // drop (parentheticals)
  n = n.replace(/[^A-Za-zÀ-ɏ\s.'-]/g, ' '); // drop emoji / symbols / Δ / ▪ / ®
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/^(dr|prof|professor|mr|mrs|ms|miss|mx)\.?\s+/i, ''); // leading title
  n = stripCredentialSuffixes(n);
  let tokens = n.split(' ').filter((t) => t && t !== '-' && t !== '.');
  while (tokens.length > 1 && CREDENTIAL_SET.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  return tokens.join(' ');
}

/**
 * Derive {firstName, lastName} from a full display name. firstName = first token,
 * lastName = everything after (so compound surnames like "Van Der Berg" survive).
 * Returns empty strings if fewer than two usable tokens.
 */
function deriveNameFromFull(fullName) {
  const clean = cleanFullName(fullName);
  const t = clean.split(' ').filter(Boolean);
  if (t.length < 2) return { firstName: '', lastName: '' };
  return { firstName: t[0], lastName: t.slice(1).join(' ') };
}

module.exports = {
  stripCredentialSuffixes,
  normalizeNameForMatching,
  isBrokenLastName,
  cleanFullName,
  deriveNameFromFull,
  CREDENTIAL_SUFFIXES
};
