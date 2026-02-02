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
  // Project Management
  'PMP', 'PRINCE2', 'CSM', 'PMI',
  // Technology & Security
  'CISSP', 'CISM', 'CISA', 'CCNA', 'CCNP', 'AWS', 'GCP', 'MCSE', 'ITIL',
  // Human Resources
  'SHRM', 'PHR', 'SPHR', 'GPHR', 'CIPD',
  // Healthcare
  'RN', 'NP', 'PA', 'FACS', 'FACP', 'FRCS',
  // Engineering
  'PE', 'CEng', 'CPEng', 'FIEAust', 'MIEAust',
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

module.exports = {
  stripCredentialSuffixes,
  normalizeNameForMatching,
  CREDENTIAL_SUFFIXES
};
