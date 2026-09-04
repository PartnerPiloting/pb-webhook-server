"use client";
import React, { useState } from 'react';
import { createLead, searchLeads } from '../services/api';
import HelpButton from './HelpButton';

// Import icons using require to avoid Next.js issues
let UserPlusIcon, CheckIcon, ExclamationTriangleIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  UserPlusIcon = icons.UserPlusIcon;
  CheckIcon = icons.CheckIcon;
  ExclamationTriangleIcon = icons.ExclamationTriangleIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

// ---- Live LinkedIn verification (via the Wingguy extension) -----------------------------------
// The real "is this the right person" check (Guy, 2026-08-30): the extension (0.3.14+) opens the
// pasted profile in a hidden tab using the user's own LinkedIn session and returns the profile's
// actual name + headline. The server can never do this - only the browser can. When the extension
// isn't installed (or the check can't complete) the form falls back to the URL-slug name heuristic.
const LIVE_CHECK_TIMEOUT_MS = 45000; // hidden-tab read takes ~5-15s; be generous before falling back
const PING_TIMEOUT_MS = 2500;

const NewLeadForm = ({ onLeadCreated, initialValues }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    linkedinProfileUrl: '',
    viewInSalesNavigator: '',
    email: '',
    phone: '',
    location: '',

    notes: '',
    followUpDate: '',
    noFollowUpNeeded: false, // If true, sets Cease FUP = 'Yes'
    source: 'Follow-Up Personally', // Default value
    status: 'On The Radar', // Default value
    priority: '',
    linkedinConnectionStatus: '',
    // Met-path controls (not Airtable fields). pendingEmail = the address the recorder saw, the
    // identity the waiting transcripts attach by. fromMetList relaxes the LinkedIn URL rule.
    pendingEmail: '',
    fromMetList: false
  });

  // Pre-fill from "People you've met" (name/email/phone). Merges over the current values
  // whenever a new person is handed in. On the met-path the LinkedIn URL is optional (Guy,
  // 2026-09-04): for someone off a recorded call, the email is the identity and the transcript is
  // the value - neither needs LinkedIn. The URL can be pasted later from their record.
  React.useEffect(() => {
    if (initialValues && Object.keys(initialValues).length) {
      setFormData(prev => ({ ...prev, ...initialValues }));
    }
  }, [initialValues]);

  const metPath = !!formData.fromMetList;
  
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [duplicateCheck, setDuplicateCheck] = useState({ isChecking: false, duplicates: [] });
  // "Right person" confirmation — when the check (live or heuristic) doubts the URL belongs to the
  // person named, the user must tick a confirm box before Create works. Reset on URL/name changes.
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);

  // Live LinkedIn check state. status: idle | checking | found | notfound | unavailable.
  // `url` records which URL the result belongs to, so a changed URL invalidates it.
  const [liveCheck, setLiveCheck] = useState({ status: 'idle', url: '', name: '', headline: '' });
  const extensionAvailable = React.useRef(null); // null = unknown, then true/false after the ping
  const pendingVerify = React.useRef({});        // nonce → true while a request is in flight

  // Listen for the extension bridge's replies, and ping once to learn whether it's installed.
  React.useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== window || !event.data) return;
      const d = event.data;
      if (d.type === 'WG_PORTAL_PONG') { extensionAvailable.current = true; return; }
      if (d.type === 'WG_PORTAL_VERIFY_PROFILE_RESULT' && d.nonce && pendingVerify.current[d.nonce]) {
        const forUrl = pendingVerify.current[d.nonce];
        delete pendingVerify.current[d.nonce];
        setLiveCheck((prev) => {
          // Only accept the reply if the field still holds the URL we asked about
          if (prev.status !== 'checking' || prev.url !== forUrl) return prev;
          if (d.ok && d.found) return { status: 'found', url: forUrl, name: String(d.name || ''), headline: String(d.headline || '') };
          if (d.ok && !d.found) return { status: 'notfound', url: forUrl, name: '', headline: '' };
          return { status: 'unavailable', url: forUrl, name: '', headline: '' };
        });
      }
    };
    window.addEventListener('message', onMessage);
    const pingNonce = `wgping-${Math.random().toString(36).slice(2)}`;
    try { window.postMessage({ type: 'WG_PORTAL_PING', nonce: pingNonce }, window.location.origin); } catch { /* no-op */ }
    const pingTimer = setTimeout(() => { if (extensionAvailable.current === null) extensionAvailable.current = false; }, PING_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(pingTimer); };
  }, []);

  // Ask the extension to open this profile (hidden) and tell us who it belongs to.
  const startLiveCheck = () => {
    const url = String(formData.linkedinProfileUrl || '').trim();
    if (!url || !LINKEDIN_URL_SHAPE.test(url)) return;
    if (extensionAvailable.current === false) return;              // no extension → heuristic path
    if (liveCheck.url === url && liveCheck.status !== 'idle') return; // already checked/checking this URL
    const nonce = `wgverify-${Math.random().toString(36).slice(2)}`;
    pendingVerify.current[nonce] = url;
    setLiveCheck({ status: 'checking', url, name: '', headline: '' });
    try { window.postMessage({ type: 'WG_PORTAL_VERIFY_PROFILE', url, nonce }, window.location.origin); } catch { /* no-op */ }
    setTimeout(() => {
      if (pendingVerify.current[nonce]) {
        delete pendingVerify.current[nonce];
        setLiveCheck((prev) => (prev.status === 'checking' && prev.url === url ? { status: 'unavailable', url, name: '', headline: '' } : prev));
      }
    }, LIVE_CHECK_TIMEOUT_MS);
  };

  // Does the live-verified LinkedIn name match the names typed? Both first AND last must appear
  // (prefix-tolerant both ways, so Janey/Jane and Jon/Jonathan pass).
  const liveNameMatches = () => {
    if (liveCheck.status !== 'found' || !liveCheck.name) return null; // no verdict
    const tokens = liveCheck.name.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
    const first = String(formData.firstName || '').trim().toLowerCase();
    const last = String(formData.lastName || '').trim().toLowerCase();
    if (!first || !last || !tokens.length) return null;
    const appears = (name) => tokens.some((t) => t === name || t.startsWith(name) || name.startsWith(t));
    return appears(first) && appears(last);
  };

  // Copy the verified LinkedIn name into the name fields (the "Use LinkedIn's name" button).
  const useLinkedInName = () => {
    const parts = String(liveCheck.name || '').trim().split(/\s+/);
    if (!parts.length) return;
    setFormData((prev) => ({ ...prev, firstName: parts[0], lastName: parts.slice(1).join(' ') }));
    setMismatchConfirmed(false);
  };

  // The LinkedIn URL is the record's identity: dedup key, enrichment match key, what /wg and
  // Linked Helper reconcile against. So it is REQUIRED — the flow is: find them on LinkedIn,
  // paste the profile address, then fill in the rest (Guy, 2026-08-30).
  const LINKEDIN_URL_SHAPE = /linkedin\.com\/in\/[^/?#\s]+/i;

  // Does the pasted URL plausibly belong to the person named on the form? Most profile URLs carry
  // the name ("linkedin.com/in/jane-doe-4b21"), so a slug containing NEITHER name is worth a
  // "check it's the right person" nudge. Deliberately conservative: vanity/short/non-ASCII slugs
  // (fewer than two readable words) return false — we can't judge those, so we never nag on them.
  const slugNameMismatch = () => {
    const m = String(formData.linkedinProfileUrl || '').toLowerCase().match(/linkedin\.com\/in\/([^/?#\s]+)/);
    if (!m) return false;
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
    const tokens = slug.split(/[-_.]/).filter(t => /^[a-z]{2,}$/.test(t));
    if (tokens.length < 2) return false;
    const first = String(formData.firstName || '').trim().toLowerCase();
    const last = String(formData.lastName || '').trim().toLowerCase();
    if (!first || !last) return false;
    const appears = (name) => tokens.some(t => t === name || t.startsWith(name) || name.startsWith(t));
    return !appears(first) && !appears(last);
  };

  // Check for duplicate leads based on LinkedIn Profile URL
  const checkForDuplicates = async () => {
    if (!formData.linkedinProfileUrl || !formData.linkedinProfileUrl.trim()) {
      setDuplicateCheck({ isChecking: false, duplicates: [] });
      return [];
    }

    setDuplicateCheck(prev => ({ ...prev, isChecking: true }));
    
    try {
      // Normalize the LinkedIn URL for comparison
      const normalizeLinkedInUrl = (url) => {
        if (!url) return '';
        return url.toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '')
          .replace(/^www\./, '');
      };

      const normalizedInputUrl = normalizeLinkedInUrl(formData.linkedinProfileUrl);
      console.log('🔍 Checking for duplicates:');
      console.log('Input URL:', formData.linkedinProfileUrl);
      console.log('Normalized Input URL:', normalizedInputUrl);
      
      // Search for leads - returns { leads: [...], total: number|null }
      const response = await searchLeads(formData.linkedinProfileUrl, 'all');
      const results = response.leads || response; // Support both new and old format
      console.log('Search results:', results);
      
      // Filter for exact normalized LinkedIn URL matches
      const duplicates = results.filter(lead => {
        const leadLinkedInUrl = normalizeLinkedInUrl(lead['LinkedIn Profile URL']);
        
        console.log('Comparing lead:', lead['LinkedIn Profile URL']);
        console.log('Lead normalized:', leadLinkedInUrl);
        console.log('Input normalized:', normalizedInputUrl);
        
        // Simple normalized URL match
        const urlMatch = leadLinkedInUrl === normalizedInputUrl;
        
        console.log('URL match:', urlMatch);
        
        return urlMatch;
      });
      
      console.log('Found duplicates:', duplicates);
      
      setDuplicateCheck({ isChecking: false, duplicates });
      return duplicates;
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      setDuplicateCheck({ isChecking: false, duplicates: [] });
      return [];
    }
  };

  // Handle form field changes
  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear any existing messages when user starts typing
    if (message.text) {
      setMessage({ type: '', text: '' });
    }
    
    // Clear duplicate check when LinkedIn URL changes
    if (field === 'linkedinProfileUrl') {
      setDuplicateCheck({ isChecking: false, duplicates: [] });
    }
    // A changed URL or name invalidates any earlier "yes, right person" confirmation
    if (field === 'linkedinProfileUrl' || field === 'firstName' || field === 'lastName') {
      setMismatchConfirmed(false);
    }
    // A changed URL invalidates the live LinkedIn check
    if (field === 'linkedinProfileUrl') {
      setLiveCheck({ status: 'idle', url: '', name: '', headline: '' });
    }
  };

  // When the live check identifies the person and the name fields are still empty, fill them in —
  // paste the URL first, get the name for free.
  React.useEffect(() => {
    if (liveCheck.status === 'found' && liveCheck.name
        && !String(formData.firstName || '').trim() && !String(formData.lastName || '').trim()) {
      const parts = liveCheck.name.trim().split(/\s+/);
      setFormData((prev) => ({ ...prev, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCheck.status]);

  // Someone added WITHOUT a LinkedIn URL can't be caught by the URL duplicate check, so check the
  // name instead: an exact first + last match already in Wingguy is almost certainly them.
  const findSameNameLeads = async () => {
    const first = String(formData.firstName || '').trim().toLowerCase();
    const last = String(formData.lastName || '').trim().toLowerCase();
    if (!first || !last) return [];
    try {
      const response = await searchLeads(`${first} ${last}`, 'all');
      const results = response.leads || response || [];
      return results.filter((lead) =>
        String(lead['First Name'] || '').trim().toLowerCase() === first
        && String(lead['Last Name'] || '').trim().toLowerCase() === last);
    } catch (error) {
      console.error('Error checking for same-name leads:', error);
      return [];
    }
  };

  // Validate required fields
  const validateForm = () => {
    const urlOptional = metPath;
    const requiredFields = [
      ...(urlOptional ? [] : [{ field: 'linkedinProfileUrl', label: 'LinkedIn Profile URL' }]),
      { field: 'firstName', label: 'First Name' },
      { field: 'lastName', label: 'Last Name' },
      { field: 'source', label: 'Source' },
      { field: 'status', label: 'Status' }
    ];

    for (const { field, label } of requiredFields) {
      if (!formData[field] || formData[field].trim() === '') {
        setMessage({
          type: 'error',
          text: field === 'linkedinProfileUrl'
            ? 'LinkedIn Profile URL is required - find their profile on LinkedIn and paste its address here'
            : `${label} is required`
        });
        return false;
      }
    }

    // Met-path with no URL: skip every URL check. Still needs the address the transcripts attach by.
    if (urlOptional && !String(formData.linkedinProfileUrl || '').trim()) {
      if (!String(formData.email || '').trim() && !String(formData.pendingEmail || '').trim()) {
        setMessage({ type: 'error', text: 'An email address is needed for someone added without a LinkedIn URL - it is how their meeting transcripts find them' });
        return false;
      }
      return true;
    }

    // The URL has to actually be a LinkedIn profile address (linkedin.com/in/...)
    if (!LINKEDIN_URL_SHAPE.test(formData.linkedinProfileUrl)) {
      setMessage({
        type: 'error',
        text: 'That doesn\'t look like a LinkedIn profile URL - it should look like https://www.linkedin.com/in/username'
      });
      return false;
    }

    // "Right person" checks, strongest evidence first.
    const urlNow = String(formData.linkedinProfileUrl || '').trim();
    const liveIsCurrent = liveCheck.url === urlNow;
    if (liveIsCurrent && liveCheck.status === 'checking') {
      setMessage({
        type: 'error',
        text: 'Still checking that profile on LinkedIn - give it a few seconds, then try again'
      });
      return false;
    }
    const verdict = liveIsCurrent ? liveNameMatches() : null;
    if (verdict === false && !mismatchConfirmed) {
      setMessage({
        type: 'error',
        text: `LinkedIn says that profile belongs to "${liveCheck.name}", not "${formData.firstName} ${formData.lastName}" - use LinkedIn's name, fix the URL, or tick "Yes, this is the right person" to confirm`
      });
      return false;
    }
    if (verdict === null && liveIsCurrent && liveCheck.status === 'notfound' && !mismatchConfirmed) {
      setMessage({
        type: 'error',
        text: 'That profile couldn\'t be read on LinkedIn - check the URL is right (and that you\'re signed in to LinkedIn), or tick "Yes, this is the right person" to create anyway'
      });
      return false;
    }
    // No live verdict → fall back to the URL-slug heuristic
    if (verdict === null && liveCheck.status !== 'found' && slugNameMismatch() && !mismatchConfirmed) {
      setMessage({
        type: 'error',
        text: 'The URL doesn\'t appear to contain this person\'s name - tick "Yes, this is the right person" below the URL to confirm before creating'
      });
      return false;
    }
    
    // Require either a follow-up date OR "No follow-up needed" checkbox
    if (!formData.followUpDate && !formData.noFollowUpNeeded) {
      setMessage({ 
        type: 'error', 
        text: 'Please enter a Follow-up Date or check "Don\'t follow up"' 
      });
      return false;
    }
    
    return true;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Check for duplicates before creating (force fresh check)
    console.log('Form submitted, checking for duplicates...');
    const duplicates = await checkForDuplicates();
    console.log('Duplicate check result:', duplicates);
    if (duplicates.length > 0) {
      console.log('Duplicates found, preventing creation');
      setMessage({
        type: 'error',
        text: 'Duplicate LinkedIn Profile found. Please check the details.'
      });
      return;
    }
    // No URL to check on the met-path - check the name instead (a duplicate is one click away
    // otherwise). Same name already in Wingguy = add this email to THAT record, don't create.
    if (metPath && !String(formData.linkedinProfileUrl || '').trim()) {
      const sameName = await findSameNameLeads();
      if (sameName.length > 0) {
        const who = `${String(sameName[0]['First Name'] || '')} ${String(sameName[0]['Last Name'] || '')}`.trim();
        const theirEmail = String(sameName[0]['Email'] || '').trim();
        setMessage({
          type: 'error',
          text: `${who} is already in Wingguy${theirEmail ? ` (${theirEmail})` : ''}. If that's the same person, open their record in Lead Search and add ${String(formData.pendingEmail || formData.email || 'this email')} there instead - their meetings will attach as soon as the address is on the record.`
        });
        return;
      }
    }

    console.log('No duplicates found, proceeding with creation');
    setIsCreating(true);
    setMessage({ type: '', text: '' });

    try {
      // Prepare data for creation
      const createData = { ...formData };
      
      const newLead = await createLead(createData);
      
      // Success! Clear form and show message
      setMessage({ 
        type: 'success', 
        text: 'Lead created successfully!' 
      });
      
      // Reset form to defaults for next lead (Airtable-style behavior)
      setFormData({
        firstName: '',
        lastName: '',
        linkedinProfileUrl: '',
        viewInSalesNavigator: '',
        email: '',
        phone: '',
        location: '',
        
        notes: '',
        followUpDate: '',
        noFollowUpNeeded: false,
        source: 'Follow-Up Personally', // Keep default
        status: 'On The Radar', // Keep default
        priority: '',
        linkedinConnectionStatus: '',
        pendingEmail: '',
        fromMetList: false
      });
      setMismatchConfirmed(false);

      // Notify parent component if callback provided
      if (onLeadCreated) {
        onLeadCreated(newLead);
      }
      
      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 5000);
      
    } catch (error) {
      console.error('Error creating lead:', error);
      console.error('Error message:', error.message);
      console.error('Error response:', error.response?.data);
      setMessage({ 
        type: 'error', 
        text: error.message || 'Failed to create lead. Please try again.' 
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Reset form to defaults
  const handleReset = () => {
    setFormData({
      firstName: '',
      lastName: '',
      linkedinProfileUrl: '',
      viewInSalesNavigator: '',
      email: '',
      phone: '',
      location: '',
      
      notes: '',
      followUpDate: '',
      noFollowUpNeeded: false,
      source: 'Follow-Up Personally',
      status: 'On The Radar',
      priority: '',
      linkedinConnectionStatus: '',
      pendingEmail: '',
      fromMetList: false
    });
    setMessage({ type: '', text: '' });
    setMismatchConfirmed(false);
  };

  // Form field configurations (same as LeadDetailForm)
  const fieldConfig = {
    selectOptions: {
      source: [
        'SalesNav + LH Scrape',
        'Manually selected from my ASH Followers',
        '2nd level leads from PB',
        'Follow-Up Personally',
        'Existing Connection Added by PB'
      ],
      status: ['On The Radar', 'In Process', 'Archive', 'Not Interested'],
      priority: ['One', 'Two', 'Three'],
      linkedinConnectionStatus: [
        'Connected', 'Invitation Sent', 'Withdrawn', 'To Be Sent',
        'Candidate', 'Ignore', 'Queued Connection Request'
      ]
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <div className="mb-6 pb-6 border-b border-gray-200">
        <h2 className="text-2xl font-semibold text-gray-900 flex items-center">
          {UserPlusIcon && <UserPlusIcon className="h-6 w-6 mr-2" />}
          <span>New Lead</span>
          <HelpButton area="new_lead" className="ml-3" title="Help: New Lead" />
        </h2>
        <p className="text-sm text-gray-600 mt-2">
          Create a new lead record. Required fields are marked with *
        </p>
      </div>

      {/* Message display */}
      {message.text && (
        <div className={`mb-6 p-4 rounded-lg ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className="flex items-center">
            {message.type === 'success' && CheckIcon && (
              <CheckIcon className="h-5 w-5 mr-2" />
            )}
            {message.text}
          </div>
        </div>
      )}

      {/* Duplicate lead warning message */}
      {duplicateCheck.duplicates.length > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-100 text-yellow-800">
          <div className="flex items-center">
            {ExclamationTriangleIcon && (
              <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
            )}
            <span>
              {duplicateCheck.duplicates.length === 1 
                ? `Duplicate lead found: ${String(duplicateCheck.duplicates[0]['First Name'] || '')} ${String(duplicateCheck.duplicates[0]['Last Name'] || '')}`
                : `${duplicateCheck.duplicates.length} duplicate leads found with this LinkedIn profile`
              }
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Met-path banner: added from "People you've met" - transcripts attach automatically,
            LinkedIn URL optional for now. */}
        {metPath && (
          <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
            <p className="font-medium">Adding someone you met on a recorded call</p>
            <p className="mt-1">
              Their meeting transcripts attach to this record automatically when you click Create - you don&apos;t
              need their LinkedIn address for that. Paste it now if you have it, or add it to their record later.
              {formData.pendingEmail ? (
                <> The address Wingguy saw on the recording was <span className="font-medium">{formData.pendingEmail}</span>; it stays on the record even if you change the email below.</>
              ) : null}
            </p>
          </div>
        )}

        {/* Basic Information - Required Fields First */}
        <div className="space-y-6">
          <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Basic Information
          </h4>
          
          <div className="space-y-3">
            {/* THE URL COMES FIRST (Guy, 2026-08-30): find them on LinkedIn, paste their profile
                address, then fill in the rest. It's the record's identity — no URL, no lead. */}
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                LinkedIn Profile URL {metPath ? '' : '*'}
              </label>
              <div className="flex-1">
                <input
                  type="url"
                  value={formData.linkedinProfileUrl}
                  onChange={(e) => handleChange('linkedinProfileUrl', e.target.value)}
                  onBlur={() => { checkForDuplicates(); startLiveCheck(); }}
                  onPaste={(e) => {
                    // Trigger duplicate + live LinkedIn checks after the paste event processes
                    setTimeout(() => { checkForDuplicates(); startLiveCheck(); }, 100);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required={!metPath}
                  placeholder={metPath ? 'https://www.linkedin.com/in/username (optional for now)' : 'https://www.linkedin.com/in/username'}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {metPath ? (
                    <>Optional for someone you met. When you do add it, Wingguy fills in their profile details and
                    score the first time you open their profile, and can match them if they later arrive from Linked Helper.</>
                  ) : (
                    <>Step 1: find this person on LinkedIn and paste their profile address here. It&apos;s how
                    Wingguy prevents duplicates, and their profile details and score are filled in
                    automatically the first time you open their profile.</>
                  )}
                </p>
              </div>
            </div>

            {/* Duplicate Check Results */}
            {formData.linkedinProfileUrl && formData.linkedinProfileUrl.trim() && (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1">
                  {duplicateCheck.isChecking ? (
                    <div className="flex items-center text-blue-600 text-sm">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                      Checking for duplicates...
                    </div>
                  ) : duplicateCheck.duplicates.length > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                      <div className="flex items-center">
                        {ExclamationTriangleIcon && (
                          <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2" />
                        )}
                        <span className="text-sm font-medium text-red-800">
                          {duplicateCheck.duplicates.length === 1
                            ? `Duplicate found: ${String(duplicateCheck.duplicates[0]['First Name'] || '')} ${String(duplicateCheck.duplicates[0]['Last Name'] || '')}`
                            : `${duplicateCheck.duplicates.length} duplicates found`
                          }
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-green-600 text-sm">
                      ✓ No duplicate LinkedIn profiles found
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                First Name *
              </label>
              <input
                type="text"
                value={formData.firstName || ''}
                onChange={(e) => handleChange('firstName', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                required
                placeholder="Enter first name"
              />
            </div>

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Last Name *
              </label>
              <input
                type="text"
                value={formData.lastName || ''}
                onChange={(e) => handleChange('lastName', e.target.value)}
                onBlur={checkForDuplicates}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                required
                placeholder="Enter last name"
              />
            </div>

            {/* Live LinkedIn check status (extension 0.3.14+; silent when unavailable) */}
            {liveCheck.url === String(formData.linkedinProfileUrl || '').trim() && liveCheck.status === 'checking' && (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1 flex items-center text-blue-600 text-sm">
                  <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                  Checking this profile on LinkedIn...
                </div>
              </div>
            )}
            {liveCheck.url === String(formData.linkedinProfileUrl || '').trim() && liveCheck.status === 'found' && liveNameMatches() !== false && (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1 text-green-600 text-sm">
                  ✓ Verified on LinkedIn: <span className="font-medium">{liveCheck.name}</span>
                  {liveCheck.headline ? <span className="text-gray-500"> - {liveCheck.headline}</span> : null}
                </div>
              </div>
            )}

            {/* "Right person" checks, strongest evidence first: LinkedIn's real name beats the
                URL-slug heuristic; the heuristic only speaks when there's no live verdict. */}
            {liveCheck.url === String(formData.linkedinProfileUrl || '').trim() && liveCheck.status === 'found' && liveNameMatches() === false ? (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1 bg-yellow-50 border border-yellow-300 rounded-md p-3">
                  <p className="text-sm text-yellow-900 mb-2">
                    {ExclamationTriangleIcon && (
                      <ExclamationTriangleIcon className="h-5 w-5 inline mr-1 align-text-bottom" />
                    )}
                    LinkedIn says this profile belongs to <span className="font-semibold">{liveCheck.name}</span>,
                    but you&apos;ve typed &quot;{formData.firstName} {formData.lastName}&quot;.
                  </p>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={useLinkedInName}
                      className="px-3 py-1.5 text-sm font-medium bg-yellow-200 hover:bg-yellow-300 text-yellow-900 rounded-md"
                    >
                      Use LinkedIn&apos;s name
                    </button>
                    <label className="flex items-center text-sm text-yellow-900 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mismatchConfirmed}
                        onChange={(e) => setMismatchConfirmed(e.target.checked)}
                        className="h-4 w-4 mr-2"
                      />
                      Yes, this is the right person
                    </label>
                  </div>
                </div>
              </div>
            ) : liveCheck.url === String(formData.linkedinProfileUrl || '').trim() && liveCheck.status === 'notfound' ? (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-sm text-yellow-800 mb-2">
                    {ExclamationTriangleIcon && (
                      <ExclamationTriangleIcon className="h-5 w-5 inline mr-1 align-text-bottom" />
                    )}
                    That profile couldn&apos;t be read on LinkedIn - double-check the URL
                    (and that you&apos;re signed in to LinkedIn in this browser).
                  </p>
                  <label className="flex items-center text-sm text-yellow-900 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mismatchConfirmed}
                      onChange={(e) => setMismatchConfirmed(e.target.checked)}
                      className="h-4 w-4 mr-2"
                    />
                    Yes, this is the right person - create anyway
                  </label>
                </div>
              </div>
            ) : liveCheck.status !== 'found' && slugNameMismatch() ? (
              <div className="flex">
                <div className="w-32 flex-shrink-0"></div>
                <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-sm text-yellow-800 mb-2">
                    {ExclamationTriangleIcon && (
                      <ExclamationTriangleIcon className="h-5 w-5 inline mr-1 align-text-bottom" />
                    )}
                    The URL you pasted doesn&apos;t appear to contain &quot;{formData.firstName} {formData.lastName}&quot; -
                    double-check it&apos;s really their profile and not someone else&apos;s.
                  </p>
                  <label className="flex items-center text-sm text-yellow-900 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mismatchConfirmed}
                      onChange={(e) => setMismatchConfirmed(e.target.checked)}
                      className="h-4 w-4 mr-2"
                    />
                    Yes, this is the right person
                  </label>
                </div>
              </div>
            ) : null}

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                View In Sales Navigator
              </label>
              <input
                type="url"
                value={formData.viewInSalesNavigator}
                onChange={(e) => handleChange('viewInSalesNavigator', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="https://www.linkedin.com/sales/... (optional)"
              />
            </div>

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="email@example.com"
              />
            </div>

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Phone
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Enter phone number"
                autoComplete="off"
                inputMode="text"
              />
            </div>

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleChange('location', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. Sydney, Australia"
              />
            </div>
            
          </div>
        </div>

        {/* Status and Classification - Required Fields */}
        <div className="space-y-6">
          <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Status & Classification
          </h4>
          
          <div className="space-y-3">
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Source *
              </label>
              <select
                value={formData.source}
                onChange={(e) => handleChange('source', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                required
              >
                {fieldConfig.selectOptions.source.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Status *
              </label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                required
              >
                {fieldConfig.selectOptions.status.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Priority
              </label>
              <select
                value={formData.priority}
                onChange={(e) => handleChange('priority', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="">Select priority...</option>
                {fieldConfig.selectOptions.priority.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                LinkedIn Connection
              </label>
              <select
                value={formData.linkedinConnectionStatus}
                onChange={(e) => handleChange('linkedinConnectionStatus', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="">Select status...</option>
                {fieldConfig.selectOptions.linkedinConnectionStatus.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Follow-up Management */}
        <div className="space-y-6">
          <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Follow-up & Notes
          </h4>
          
          <div className="space-y-3">
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                Follow-up Date
              </label>
              <div className="flex-1">
                <input
                  type="date"
                  value={formData.followUpDate}
                  onChange={(e) => {
                    handleChange('followUpDate', e.target.value);
                    // Clear "no follow-up needed" if a date is entered
                    if (e.target.value) {
                      handleChange('noFollowUpNeeded', false);
                    }
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={formData.noFollowUpNeeded}
                />
              </div>
            </div>
            
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                &nbsp;
              </label>
              <div className="flex-1">
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.noFollowUpNeeded}
                    onChange={(e) => {
                      handleChange('noFollowUpNeeded', e.target.checked);
                      // Clear follow-up date if "no follow-up" is checked
                      if (e.target.checked) {
                        handleChange('followUpDate', '');
                      }
                    }}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Don't follow up</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Check to mark this lead as no follow-up needed
                </p>
              </div>
            </div>
            
            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 pt-2">
                Notes
              </label>
              <div className="flex-1">
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[120px] resize-y text-sm"
                  rows={6}
                  placeholder="Add initial notes about this lead..."
                  data-text-blaze="enabled"
                  data-tb-allow="true"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Initial notes about the lead. Additional conversations will be captured automatically.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={handleReset}
            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isCreating}
          >
            Reset Form
          </button>
          
          <button
            type="submit"
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isCreating}
          >
            {isCreating ? (
              <span className="inline-flex items-center">
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                Creating...
              </span>
            ) : (
              'Create Lead'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewLeadForm;