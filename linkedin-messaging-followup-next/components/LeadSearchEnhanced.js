"use client";
import React, { useState, useEffect, useRef } from 'react';
import HelpButton from './HelpButton';
import SearchTermsField from './SearchTermsField';
import LeadSearchTableDirect from './LeadSearchTableDirect';
import { formatLinkedInUrl, generateProfileKey } from '../utils/helpers';
import { getLeadByLinkedInUrl } from '../services/api';

// (Former flag gate removed)
const LeadSearchEnhanced = ({ 
  leads = [], 
  totalLeads = 0,
  currentPage = 1,
  leadsPerPage = 25,
  onLeadSelect, 
  selectedLead = null, 
  isLoading = false,
  onSearch,
  onQuickFieldUpdate
}) => {
  // Search states
  const [nameSearch, setNameSearch] = useState('');
  const [linkedinLookupError, setLinkedinLookupError] = useState('');
  const [priority, setPriority] = useState('all');
  const [searchTerms, setSearchTerms] = useState('');

  // Export modal state
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportType, setExportType] = useState(null); // 'emails' | 'phones' | 'linkedin'
  const [exportRunning, setExportRunning] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportProgress, setExportProgress] = useState({ pages: 0, items: 0 });
  const [lastPageCount, setLastPageCount] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [exportValues, setExportValues] = useState([]); // final unique values
  const [exportTooMany, setExportTooMany] = useState(false); // > COPY_MAX
  const cancelExportRef = useRef({ cancelled: false });
  const [exportAction, setExportAction] = useState('build'); // 'build' | 'copy'
  const [serverDownloading, setServerDownloading] = useState(false);
  const [serverDownloadFmt, setServerDownloadFmt] = useState(null); // 'txt' | 'csv' | null
  const [serverDownloadProgress, setServerDownloadProgress] = useState({ loaded: 0, total: 0 });
  const serverDownloadGuardRef = useRef(false);

  // Constants
  const COPY_MAX = 10000; // increased from 1000 per request
  const PAGE_LIMIT = 100; // server-enforced
  const MAX_RPS = 3; // throttle to protect Airtable/API
  const MIN_GAP_MS = Math.ceil(1000 / MAX_RPS);
  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 500;
  let lastRequestAt = 0;

  const openExportModal = (type) => {
    setExportType(type);
    setExportError('');
    setExportProgress({ pages: 0, items: 0 });
    setExportValues([]);
    setExportTooMany(false);
    cancelExportRef.current.cancelled = false;
  setLastPageCount(0);
  setStartedAt(null);
    setExportAction('build');
    setIsExportOpen(true);
  };

  const closeExportModal = () => {
    cancelExportRef.current.cancelled = true;
    setIsExportOpen(false);
    setExportRunning(false);
  };

  // Handle CSV export - download all matching leads with selected fields
  const handleCSVExport = async () => {
    try {
      // Fetch ALL matching leads from backend (not just current page)
      const apiBase = getApiBase();
      const p = new URLSearchParams();
      if (nameSearch) p.set('q', nameSearch);
      if (priority !== 'all') p.set('priority', priority);
      if (searchTerms) p.set('searchTerms', searchTerms);
      p.set('limit', '10000'); // High limit to get all results
      
      // Preserve testClient/test mode param
      try {
        const qs = new URLSearchParams(window.location.search || '');
        const tc = qs.get('testClient');
        if (tc) p.set('testClient', tc);
      } catch {}
      
      const url = `${apiBase}/leads/search?${p.toString()}`;
      const res = await fetch(url, { credentials: 'include' });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch leads: ${res.status}`);
      }
      
      const data = await res.json();
      const allLeads = Array.isArray(data) ? data : (data.leads || []);
      
      if (!allLeads || allLeads.length === 0) {
        alert('No leads to export');
        return;
      }

      // CSV Headers
      const headers = ['First Name', 'Last Name', 'Email', 'LinkedIn URL', 'Notes'];
      
      // CSV Rows - escape values that contain commas or quotes
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        // If contains comma, quote, or newline, wrap in quotes and escape existing quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const rows = allLeads.map(lead => [
        escapeCSV(lead['First Name'] || ''),
        escapeCSV(lead['Last Name'] || ''),
        escapeCSV(lead['Email'] || lead['Email Address'] || ''),
        escapeCSV(lead['LinkedIn Profile URL'] || ''),
        escapeCSV(lead['Notes'] || '')
      ]);

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const downloadUrl = URL.createObjectURL(blob);
      
      link.setAttribute('href', downloadUrl);
      link.setAttribute('download', `leads-export-${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      alert(`Exported ${allLeads.length} leads to CSV`);
    } catch (error) {
      console.error('CSV export error:', error);
      alert(`Export failed: ${error.message}`);
    }
  };

  // Handle name search change
  const handleNameSearchChange = async (e) => {
    const value = e.target.value;
    setLinkedinLookupError('');
    
    // Check if value is a LinkedIn URL BEFORE updating state
    const linkedinUrlRegex = /linkedin\.com\/in\/[\w-]+/i;
    if (value && linkedinUrlRegex.test(value)) {
      console.log(`🔗 Detected LinkedIn URL in search: ${value}`);
      
      // Set the value in the input box temporarily
      setNameSearch(value);
      
      try {
        // Look up lead by LinkedIn URL
        const lead = await getLeadByLinkedInUrl(value);
        console.log(`✅ Lead found by LinkedIn URL:`, lead);
        
        // Clear the search box
        setNameSearch('');
        
        // Open lead detail directly
        if (onLeadSelect) {
          onLeadSelect(lead);
        }
        
        return; // Don't trigger normal search
      } catch (error) {
        console.error('LinkedIn URL lookup error:', error);
        setLinkedinLookupError(error.message || 'Lead not found with that LinkedIn URL');
        // Clear the search box after error
        setNameSearch('');
        // Let the error display for 5 seconds
        setTimeout(() => setLinkedinLookupError(''), 5000);
        return; // Don't trigger normal search
      }
    }
    
    // Not a LinkedIn URL, update state and trigger normal search
    setNameSearch(value);
    if (onSearch) {
      onSearch({
        nameQuery: value,
        priority,
        searchTerms
      });
    }
  };

  // Handle priority change
  const handlePriorityChange = (e) => {
    const value = e.target.value;
    setPriority(value);
    
    // Trigger search with current filters
    if (onSearch) {
      onSearch({
        nameQuery: nameSearch,
        priority: value,
        searchTerms
      });
    }
  };

  // Handle search terms change (from SearchTermsField)
  // SearchTermsField calls onTermsChange(displayTerms, canonicalCsv)
  const handleSearchTermsChange = (displayTerms /* string */, canonicalCsv /* string */) => {
    const termsString = displayTerms || '';
    setSearchTerms(termsString);

    if (onSearch) {
      onSearch({
        nameQuery: nameSearch,
        priority,
        searchTerms: termsString
      });
    }
  };

  // Helpers for export
  const getApiBase = () => {
    const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/linkedin';
    const apiBase = rawBase.endsWith('/api/linkedin') || /\/api\/linkedin\/?$/.test(rawBase)
      ? rawBase.replace(/\/$/, '')
      : `${rawBase.replace(/\/$/, '')}/api/linkedin`;
    return apiBase;
  };

  const canonicalize = (type, value) => {
    if (!value) return '';
    const v = String(value).trim();
    if (!v) return '';
    if (type === 'emails') return v.toLowerCase();
    if (type === 'phones') return v.replace(/[^0-9+]/g, '');
    if (type === 'linkedin') return generateProfileKey(formatLinkedInUrl(v));
    return v;
  };

  const extractFromLead = (type, lead) => {
    if (type === 'emails') return lead['Email'] || lead['email'] || '';
    if (type === 'phones') return lead['Phone Number'] || lead['phone'] || '';
    if (type === 'linkedin') return lead['LinkedIn Profile URL'] || lead['linkedinProfileUrl'] || '';
    return '';
  };

  const startExport = async (action = 'build') => {
    if (!exportType) return;
    // If action is 'server-copy', use new fast endpoint with limit to avoid full client scan
    if (action === 'server-copy') {
      try {
        setExportRunning(true);
        setExportError('');
        const apiBase = getApiBase();
        const p = new URLSearchParams();
        if (nameSearch) p.set('q', nameSearch);
        if (priority !== 'all') p.set('priority', priority);
        if (searchTerms) p.set('searchTerms', searchTerms);
        p.set('type', exportType);
        p.set('format', 'txt');
  p.set('limit', String(COPY_MAX));
        // Preserve testClient/test mode param if present in page URL so copy & download behave the same
        try {
          const qs = new URLSearchParams(window.location.search || '');
          const tc = qs.get('testClient');
          if (tc) p.set('testClient', tc);
        } catch {}
        const url = `${apiBase}/leads/export?${p.toString()}`;
        const res = await fetch(url, { credentials: 'include' });
        let backendStatus = res.status;
        let backendErr = '';
        if (!res.ok) {
          try {
            const errJson = await res.json().catch(() => null);
            if (errJson) {
              if (errJson.error) backendErr = errJson.error;
              else if (errJson.message) backendErr = errJson.message;
              else if (errJson.code) backendErr = errJson.code;
            }
          } catch {}
          throw new Error(`HTTP ${backendStatus}${backendErr ? ' - ' + backendErr : ''}`);
        }
        const text = await res.text();
        
        // Count actual items copied (split by newlines, filter out empty lines)
        const actualCount = text.split('\n').filter(line => line.trim()).length;
        
        // Some browsers block clipboard without user gesture; attempt then fallback
        try {
          await navigator.clipboard.writeText(text);
          alert(`Copied ${actualCount.toLocaleString()} ${exportType}.`);
          closeExportModal();
  } catch (e) { // Clipboard attempt failed
          // Show a temporary textarea fallback
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.top = '-1000px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          alert(`Copied ${actualCount.toLocaleString()} ${exportType}.`);
          closeExportModal();
        }
      } catch (e) {
  console.error('Server copy failed', e);
        let detail = e && e.message ? e.message : 'Unknown error';
        if (/HTTP 401/.test(detail)) {
          setExportError('Copy failed: Not logged in (401). Open the main ASH site, log in, then retry. If already logged in, refresh this page.');
        } else {
          const hint = /HTTP 4\d\d/.test(detail) ? 'Check filters or permissions.' : (/HTTP 5\d\d/.test(detail) ? 'Server busy or Airtable error.' : '');
          setExportError(`Copy failed: ${detail}. ${hint} Use Download (.txt) if this persists.`);
        }
      } finally {
        setExportRunning(false);
      }
      return;
    }
    setExportAction(action);
    setExportRunning(true);
    setExportError('');
    setExportProgress({ pages: 0, items: 0 });
    setExportValues([]);
    setExportTooMany(false);
  setLastPageCount(0);
  setStartedAt(Date.now());

    const apiBase = getApiBase();
    const params = new URLSearchParams();
  if (nameSearch) params.set('q', nameSearch);
    if (priority !== 'all') params.set('priority', priority);
    if (searchTerms) params.set('searchTerms', searchTerms);
    params.set('limit', String(PAGE_LIMIT));
    try {
      const qs = new URLSearchParams(window.location.search || '');
      const tc = qs.get('testClient');
      if (tc) params.set('testClient', tc);
    } catch {}

  const unique = [];
    const seen = new Set();
    let offset = 0;
    let pages = 0;

  try {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const waitForThrottle = async () => {
        const now = Date.now();
        const delta = now - lastRequestAt;
        if (delta < MIN_GAP_MS) {
          await sleep(MIN_GAP_MS - delta);
        }
      };
      const fetchWithRetry = async (url) => {
        let attempt = 0;
        let backoff = INITIAL_BACKOFF_MS;
        // retry on 429/5xx with exponential backoff and throttle gap
        // honor Cancel between retries
        while (!cancelExportRef.current.cancelled) {
          await waitForThrottle();
          lastRequestAt = Date.now();
          try {
            const res = await fetch(url);
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
              if (attempt >= MAX_RETRIES) throw new Error(`HTTP ${res.status}`);
              attempt += 1;
              await sleep(backoff);
              backoff = Math.min(backoff * 2, 8000);
              continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          } catch (e) {
            if (attempt >= MAX_RETRIES) throw e;
            attempt += 1;
            await sleep(backoff);
            backoff = Math.min(backoff * 2, 8000);
          }
        }
        return [];
      };

      // Fetch all pages until exhausted or cancelled
      // We continue even after 1000 so we can offer full Download for big sets.
  while (!cancelExportRef.current.cancelled) {
        params.set('offset', String(offset));
        const url = `${apiBase}/leads/search?${params.toString()}`;
        const page = await fetchWithRetry(url);

        if (!Array.isArray(page) || page.length === 0) break;

        for (const lead of page) {
          const raw = extractFromLead(exportType, lead);
          if (!raw) continue;
          const key = canonicalize(exportType, raw);
          if (!key) continue;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(exportType === 'linkedin' ? formatLinkedInUrl(raw) : raw.trim());
            // In copy mode, stop early once we have enough
            if (action === 'copy' && unique.length >= COPY_MAX) {
              break;
            }
          }
        }

  pages += 1;
  setLastPageCount(page.length);
  setExportProgress({ pages, items: unique.length });

        // If copy mode hit limit, stop paginating
        if (action === 'copy' && unique.length >= COPY_MAX) {
          break;
        }

        // Advance offset
        offset += PAGE_LIMIT;
      }

      if (cancelExportRef.current.cancelled) {
        // User cancelled
        setExportRunning(false);
        return;
      }

      // Finalize
      setExportValues(unique);
      setExportTooMany(unique.length > COPY_MAX);

      // If this was a Copy action, copy immediately and close
      if (action === 'copy') {
        setExportRunning(false);
        try {
          const text = unique.slice(0, COPY_MAX).join('\n');
          await navigator.clipboard.writeText(text);
          alert(`Copied ${Math.min(unique.length, COPY_MAX)} ${exportType} to clipboard!`);
          closeExportModal();
          return;
        } catch (e) {
          console.error('Auto-copy failed', e);
          alert('Copy failed. You can use Download instead.');
        }
      }

      setExportRunning(false);
    } catch (error) {
      console.error('Export failed:', error);
      setExportError('Failed to export data. Please try again.');
      setExportRunning(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      const list = exportValues.slice(0, COPY_MAX);
      if (list.length === 0) return;
      const text = list.join('\n');
      await navigator.clipboard.writeText(text);
      alert(`Copied ${list.length} ${exportType} to clipboard!\n\nYou can now paste them into any program.`);
      closeExportModal();
    } catch (e) {
      console.error('Copy failed', e);
      alert('Copy failed. You can use Download instead.');
    }
  };

  const downloadTxt = () => {
    try {
      const list = exportValues;
      if (!list || list.length === 0) return;
      const crlf = list.join('\r\n');
      const blob = new Blob([crlf], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const base = exportType === 'linkedin' ? 'linkedin-urls' : (exportType === 'emails' ? 'emails' : 'phones');
      a.href = url;
      a.download = `${base}-${date}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      closeExportModal();
    } catch (e) {
      console.error('Download failed', e);
      alert('Download failed.');
    }
  };

  const downloadServer = async (fmt = 'txt') => {
    try {
  if (serverDownloadGuardRef.current) return; // prevent re-entry on double-click
  serverDownloadGuardRef.current = true;
  setServerDownloading(true);
  setServerDownloadFmt(fmt);
  setServerDownloadProgress({ loaded: 0, total: 0 });
      const apiBase = getApiBase();
      const p = new URLSearchParams();
      if (nameSearch) p.set('q', nameSearch);
      if (priority !== 'all') p.set('priority', priority);
      if (searchTerms) p.set('searchTerms', searchTerms);
      p.set('type', exportType || 'linkedin');
      p.set('format', fmt);
      try {
        const qs = new URLSearchParams(window.location.search || '');
        const tc = qs.get('testClient');
        if (tc) p.set('testClient', tc);
      } catch {}
      const url = `${apiBase}/leads/export?${p.toString()}`;
  const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        // Try to read error details
        let msg = `Download failed (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data && data.error) msg += `: ${data.error}`;
        } catch {}
        throw new Error(msg);
      }
      // Stream the response to track progress
      const total = Number(res.headers.get('Content-Length') || 0);
      const reader = res.body?.getReader ? res.body.getReader() : null;
      const chunks = [];
      if (reader) {
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            setServerDownloadProgress({ loaded: received, total });
          }
        }
      }
      const blob = reader
        ? new Blob(chunks, { type: (fmt === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8') })
        : await res.blob();
      // Extract filename from headers if present
      let filename = '';
      try {
        const disp = res.headers.get('Content-Disposition') || '';
        const m = disp.match(/filename="?([^";]+)"?/i);
        if (m && m[1]) filename = m[1];
      } catch {}
      if (!filename) {
        const date = new Date().toISOString().slice(0, 10);
        const base = (exportType === 'linkedin') ? 'linkedin-urls' : (exportType === 'emails' ? 'emails' : 'phones');
        filename = `${base}-${date}.${fmt}`;
      }
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
      closeExportModal();
    } catch (e) {
      console.error('Server download failed', e);
      alert(String(e && e.message ? e.message : 'Download failed.'));
    } finally {
      setServerDownloading(false);
  setServerDownloadFmt(null);
  setServerDownloadProgress({ loaded: 0, total: 0 });
  serverDownloadGuardRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      {(() => {
        try {
          // eslint-disable-next-line no-console
          console.debug('[LeadSearchEnhanced] Component types', {
            LeadSearchTableType: 'client-wrapper',
            SearchTermsFieldType: typeof SearchTermsField,
          });
        } catch {}
        return null;
      })()}
      {/* Search Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Search & Filter</h2>
          <HelpButton area="lead_search_and_update_search" title="Help for Search & Filter" />
        </div>
        
        {/* LinkedIn URL Error Message */}
        {linkedinLookupError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {linkedinLookupError}
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Name Search - narrower, 1 column */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search by Name or LinkedIn Profile
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Name or LinkedIn URL..."
                value={nameSearch}
                onChange={handleNameSearchChange}
              />
            </div>
          </div>

          {/* Priority Filter - narrow, 1 column */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <select
              value={priority}
              onChange={handlePriorityChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All</option>
              <option value="One">One</option>
              <option value="Two">Two</option>
              <option value="Three">Three</option>
            </select>
          </div>
          {/* Search Terms Filter - more space, 4 columns */}
          <div className="md:col-span-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <svg className="inline h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Search Terms
            </label>
            <div className="border border-gray-300 rounded-lg p-2 bg-white">
              {typeof SearchTermsField === 'function' ? (
                <SearchTermsField
                  initialTerms={searchTerms}
                  onTermsChange={handleSearchTermsChange}
                  placeholder="Type terms (use quotes for phrases, e.g. &quot;Mindset Mastery&quot;) and press Enter or comma..."
                />
              ) : (
                <div className="text-sm text-red-600">
                  SearchTermsField failed to load (type: {String(typeof SearchTermsField)}).
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Active Filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="text-sm text-gray-600">Active filters:</div>
          {nameSearch && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
              Name: "{nameSearch}"
            </span>
          )}
          {priority !== 'all' && (
            <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
              Priority: {priority}
            </span>
          )}
        </div>
      </div>

      {/* Results Table */}
      <div className="space-y-4">
        {/* Bulk Export Actions */}
        {leads && leads.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">Export matching leads:</span>
              </div>
        <div className="flex space-x-2">
                <button
          onClick={() => openExportModal('emails')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                  Export Emails…
                </button>
                <button
                  onClick={() => openExportModal('phones')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Export Phones…
                </button>
                <button
                  onClick={() => openExportModal('linkedin')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  Export LinkedIn URLs…
                </button>
                <button
                  onClick={() => handleCSVExport()}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export All to CSV
                </button>
              </div>
            </div>
          </div>
        )}

  <LeadSearchTableDirect
          leads={leads}
          totalLeads={totalLeads}
          currentPage={currentPage}
          leadsPerPage={leadsPerPage}
          onLeadSelect={onLeadSelect}
          selectedLead={selectedLead}
          isLoading={isLoading}
          onQuickFieldUpdate={onQuickFieldUpdate}
          hideFooter={true}
        />
      </div>
      {/* Export Modal */}
      {isExportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5" aria-busy={serverDownloading || exportRunning}>
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{`Export ${exportType === 'linkedin' ? 'LinkedIn URLs' : exportType === 'emails' ? 'Emails' : 'Phones'}`}</h3>
              <button
                className={`text-gray-400 ${serverDownloading ? 'opacity-40 cursor-not-allowed' : 'hover:text-gray-600'}`}
                onClick={() => { if (!serverDownloading) closeExportModal(); }}
                aria-label="Close"
                aria-disabled={serverDownloading}
              >✕</button>
            </div>

            {serverDownloading && !exportRunning && (
              <div className="mt-3 mb-2 text-sm flex items-center gap-2 text-gray-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                <svg className="animate-spin h-4 w-4 text-yellow-600" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span>Preparing download… your file will save automatically.</span>
              </div>
            )}

            {!exportRunning && exportValues.length === 0 && !exportError && (
              <div className="mt-3 text-sm text-gray-700 space-y-3">
                <p>Choose how you want the results. Copy hits the server once (fast, up to 10,000). Download fetches the full filtered set (no 10K cap).</p>
                <ul className="list-disc pl-5 space-y-1 text-gray-600">
                  <li>Copy: up to {COPY_MAX.toLocaleString()} unique values fast (server filtered).</li>
                  <li>Download (.txt): full filtered set (can exceed {COPY_MAX.toLocaleString()}).</li>
                </ul>
                {serverDownloading && (
                  <div className="mt-2">
                    {(() => {
                      const { loaded, total } = serverDownloadProgress;
                      let pct = 0;
                      if (total > 0) {
                        pct = Math.min(100, Math.round((loaded / total) * 100));
                      } else if (loaded > 0) {
                        // Unknown total: animate width based on bytes received so far
                        pct = Math.max(10, Math.floor(((loaded / 200000) % 1) * 100));
                      } else {
                        pct = 10; // initial hint
                      }
                      const label = total > 0
                        ? `${(loaded/1024/1024).toFixed(1)}MB / ${(total/1024/1024).toFixed(1)}MB (${pct}%)`
                        : (loaded > 0 ? `${(loaded/1024/1024).toFixed(1)}MB …` : 'Preparing download…');
                      return (
                        <>
                          <div className="h-2 bg-gray-200 rounded" title={label}>
                            <div className="h-2 bg-blue-600 rounded transition-[width] duration-200" style={{ width: `${pct}%` }}></div>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{label}</div>
                        </>
                      );
                    })()}
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white" onClick={() => startExport('server-copy')}>Copy (≤ {COPY_MAX.toLocaleString()})</button>
                    <button disabled={serverDownloading} className={`px-3 py-1.5 text-sm rounded text-white ${serverDownloading ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-700'}`} onClick={() => downloadServer('txt')}>
                      {serverDownloading && serverDownloadFmt === 'txt' ? 'Downloading…' : 'Download .txt (full set)'}
                    </button>
                  </div>
                  <div className="flex justify-between gap-2 items-center">
                    <div className="text-xs text-gray-500">Tip: Use Download if you need more than {COPY_MAX.toLocaleString()} or extra columns.</div>
                    <div className="flex gap-2">
                      <button disabled={serverDownloading} className={`px-3 py-1.5 text-sm rounded border ${serverDownloading ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={closeExportModal}>Cancel</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {exportRunning && (
              <div className="mt-4 text-sm text-gray-700">
                <div className="mb-2">
                  {exportAction === 'copy' ? (
                    <>Copying… Page {exportProgress.pages} • {exportProgress.items.toLocaleString()} unique so far (target: {COPY_MAX.toLocaleString()})</>
                  ) : (
                    <>Fetching… Page {exportProgress.pages} • {exportProgress.items.toLocaleString()} unique so far</>
                  )}
                  {lastPageCount ? <span className="text-gray-500"> (last page: {lastPageCount})</span> : null}
                </div>
                <div className="h-2 bg-gray-200 rounded" title="Progress is indeterminate; we stop when no more pages.">
                  <div className="h-2 bg-blue-500 rounded animate-pulse" style={{ width: '50%' }}></div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {(() => {
                    try {
                      if (!startedAt) return null;
                      const secs = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
                      const rate = Math.floor(exportProgress.items / secs);
                      return `~${rate || 1}/sec so far`;
                    } catch {
                      return null;
                    }
                  })()}
                </div>
                <div className="mt-4 flex justify-end">
                  <button className="px-3 py-1.5 text-sm rounded border" onClick={() => { cancelExportRef.current.cancelled = true; }}>Cancel</button>
                </div>
              </div>
            )}

            {!exportRunning && (exportValues.length > 0 || exportError) && (
              <div className="mt-4 text-sm text-gray-700">
                {exportError ? (
                  <div className="text-red-600">{exportError}</div>
                ) : (
                  <>
                    <div className="mb-3">
                      Found {exportValues.length.toLocaleString()} unique {exportType}. {exportValues.length > COPY_MAX ? 'That’s over the copy limit.' : ''}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button disabled={serverDownloading} className={`px-3 py-1.5 text-sm rounded border ${serverDownloading ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={closeExportModal}>Close</button>
                      {exportValues.length > 0 && exportValues.length <= COPY_MAX && (
                        <button className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white" onClick={copyToClipboard}>Copy to clipboard</button>
                      )}
                      {exportValues.length > 0 && (
                        <>
                          <button className="px-3 py-1.5 text-sm rounded bg-gray-800 text-white" onClick={downloadTxt}>Download .txt (local)</button>
                          <button disabled={serverDownloading} className={`px-3 py-1.5 text-sm rounded text-white ${serverDownloading ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-700'}`} onClick={() => downloadServer('txt')}>
                            {serverDownloading && serverDownloadFmt === 'txt' ? 'Downloading…' : 'Download .txt (full set)'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadSearchEnhanced;
