'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { lookupLead, quickUpdateLead, previewParse, getLeadNotesSummary, updateClientTimezone } from '../services/api';

/**
 * Clean up LinkedIn message noise from notes
 * Removes artifacts like "View X's profile", "Remove reaction", pronouns, concatenated names
 * @param {string} text - Raw notes text
 * @returns {string} Cleaned text
 */
const cleanLinkedInNoise = (text) => {
  if (!text) return '';
  
  return text
    // Remove "View X's profileName" patterns (concatenated)
    .replace(/\s*View\s+[^']+['']s\s*profile[A-Za-z\s]*/gi, '')
    // Remove standalone "View X's profile" 
    .replace(/\s*View\s+[^']+['']s\s*profile/gi, '')
    // Remove "Remove reaction" 
    .replace(/\s*Remove\s+reaction/gi, '')
    // Remove pronouns like (She/Her), (He/Him), (They/Them)
    .replace(/\s*\((?:She\/Her|He\/Him|They\/Them)\)/gi, '')
    // Remove "1st degree connection" markers
    .replace(/\s*·?\s*1st(?:\s+degree)?\s*(?:connection)?/gi, '')
    // Clean up multiple spaces
    .replace(/  +/g, ' ')
    // Clean up lines that are just whitespace
    .replace(/^\s*$/gm, '')
    // Remove excessive blank lines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * QuickUpdateModal - Rapid lead notes and contact update modal
 * 
 * Features:
 * - Lead lookup by URL, email, or name
 * - Section-based notes (LinkedIn, Sales Nav, Manual)
 * - Auto-parsing of raw LinkedIn/Sales Nav content
 * - Live preview of formatted output
 * - Full notes display (scrollable)
 * - Contact info updates (email, phone, follow-up date)
 * - Keyboard shortcuts (Esc, Ctrl+Enter, Ctrl+N)
 */

const SECTIONS = [
  { key: 'linkedin', label: 'LinkedIn', description: 'Paste LinkedIn DM conversation' },
  { key: 'salesnav', label: 'Sales Nav', description: 'Paste Sales Navigator messages' },
  { key: 'manual', label: 'Manual', description: 'Type a note (auto-dated)' }
];

// Helper function to validate IANA timezone identifiers
const isValidTimezone = (tz) => {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
};

// Available timezone options for self-service configuration
const TIMEZONE_OPTIONS = [
  { value: 'Australia/Perth', label: 'Perth (AWST)', region: 'Australia' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)', region: 'Australia' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)', region: 'Australia' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)', region: 'Australia' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', region: 'Australia' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)', region: 'Australia' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)', region: 'Australia' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', region: 'Pacific' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', region: 'Asia' },
  { value: 'Europe/London', label: 'London (GMT/BST)', region: 'Europe' },
  { value: 'America/New_York', label: 'New York (EST/EDT)', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)', region: 'Americas' },
  { value: 'America/Chicago', label: 'Chicago (CST/CDT)', region: 'Americas' }
];

export default function QuickUpdateModal({ 
  isOpen, 
  onClose, 
  initialLeadId = null, 
  clientId = null,
  clientTimezone = null,
  onTimezoneUpdate = null
}) {
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lookupMethod, setLookupMethod] = useState(null);
  
  // Timezone configuration state
  const [showTimezoneSelector, setShowTimezoneSelector] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState('');
  const [customTimezone, setCustomTimezone] = useState('');
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [timezoneError, setTimezoneError] = useState(null);
  
  const [activeSection, setActiveSection] = useState('linkedin');
  const [noteContent, setNoteContent] = useState('');
  const [parsePreview, setParsePreview] = useState(null);
  
  const [followUpDate, setFollowUpDate] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  
  const [notesSummary, setNotesSummary] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [error, setError] = useState(null);
  
  // View toggle for notes
  const [showNotesPreview, setShowNotesPreview] = useState(false);
  
  const searchInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Focus search input when modal opens
      setTimeout(() => searchInputRef.current?.focus(), 100);
      
      // If initial lead ID provided, load that lead
      if (initialLeadId) {
        loadLeadById(initialLeadId);
      }
    } else {
      // Reset state when closing
      resetForm();
    }
  }, [isOpen, initialLeadId]);

  // Track unsaved changes
  useEffect(() => {
    const hasChanges = noteContent.trim() !== '' || 
      (selectedLead && (
        followUpDate !== (selectedLead.followUpDate || '') ||
        email !== (selectedLead.email || '') ||
        phone !== (selectedLead.phone || '')
      ));
    setHasUnsavedChanges(hasChanges);
  }, [noteContent, followUpDate, email, phone, selectedLead]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      
      try {
        const result = await lookupLead(searchQuery);
        setSearchResults(result.leads || []);
        setLookupMethod(result.lookupMethod);
      } catch (err) {
        setError(err.message);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Parse preview on content change (debounced)
  useEffect(() => {
    if (!noteContent.trim() || activeSection === 'manual') {
      setParsePreview(null);
      return;
    }
    
    const timeout = setTimeout(async () => {
      try {
        const preview = await previewParse(noteContent, activeSection);
        setParsePreview(preview);
      } catch (err) {
        console.error('Parse preview failed:', err);
        setParsePreview(null);
      }
    }, 500);
    
    return () => clearTimeout(timeout);
  }, [noteContent, activeSection]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e) => {
      // Escape - close (with unsaved warning if needed)
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      
      // Ctrl+Enter - Save
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
      
      // Ctrl+N - New (clear for next lead)
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNew();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasUnsavedChanges]);

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedLead(null);
    setLookupMethod(null);
    setActiveSection('linkedin');
    setNoteContent('');
    setParsePreview(null);
    setFollowUpDate('');
    setEmail('');
    setPhone('');
    setNotesSummary(null);
    setHasUnsavedChanges(false);
    setShowUnsavedWarning(false);
    setSaveSuccess(null);
    setError(null);
    setShowNotesPreview(false);
  };

  const loadLeadById = async (leadId) => {
    // This would need a getLeadById call - for now use search results
    console.log('Loading lead by ID:', leadId);
  };

  const selectLead = async (lead) => {
    setSelectedLead(lead);
    setSearchResults([]);
    setSearchQuery(`${lead.firstName} ${lead.lastName}`);
    
    // Pre-fill contact fields
    setFollowUpDate(lead.followUpDate || '');
    setEmail(lead.email || '');
    setPhone(lead.phone || '');
    
    // Load notes summary
    try {
      const summary = await getLeadNotesSummary(lead.id);
      setNotesSummary(summary.summary);
    } catch (err) {
      console.error('Failed to load notes summary:', err);
    }
    
    // Focus note input
    setTimeout(() => noteInputRef.current?.focus(), 100);
  };

  // Handle timezone save
  const handleSaveTimezone = async () => {
    // Determine the actual timezone value to save
    const timezoneToSave = selectedTimezone === 'OTHER' ? customTimezone.trim() : selectedTimezone;
    
    if (!timezoneToSave) {
      setTimezoneError('Please select or enter a timezone');
      return;
    }
    
    setIsSavingTimezone(true);
    setTimezoneError(null);
    
    try {
      await updateClientTimezone(timezoneToSave);
      
      // Notify parent to update clientProfile
      if (onTimezoneUpdate) {
        onTimezoneUpdate(timezoneToSave);
      }
      
      // Hide the selector
      setShowTimezoneSelector(false);
      setSelectedTimezone('');
      setCustomTimezone('');
      
    } catch (err) {
      console.error('Failed to save timezone:', err);
      setTimezoneError(err.message || 'Failed to save timezone');
    } finally {
      setIsSavingTimezone(false);
    }
  };

  const handleSave = async () => {
    if (!selectedLead) {
      setError('Please select a lead first');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    
    try {
      const updates = {};
      
      // Add note content if provided
      if (noteContent.trim()) {
        updates.section = activeSection;
        updates.content = noteContent;
        updates.parseRaw = activeSection !== 'manual';
      }
      
      // Add contact updates if changed
      if (followUpDate !== (selectedLead.followUpDate || '')) {
        updates.followUpDate = followUpDate || null;
      }
      if (email !== (selectedLead.email || '')) {
        updates.email = email;
      }
      if (phone !== (selectedLead.phone || '')) {
        updates.phone = phone;
      }
      
      if (Object.keys(updates).length === 0) {
        setError('No changes to save');
        setIsSaving(false);
        return;
      }
      
      const result = await quickUpdateLead(selectedLead.id, updates);
      
      setSaveSuccess({
        leadName: `${selectedLead.firstName} ${selectedLead.lastName}`,
        updatedFields: result.updatedFields,
        parsing: result.parsing,
        noteUpdate: result.noteUpdate
      });
      
      // Update local state with saved values
      setSelectedLead(prev => ({
        ...prev,
        email: result.lead?.email || email,
        phone: result.lead?.phone || phone,
        followUpDate: result.lead?.followUpDate || followUpDate
      }));
      setNotesSummary(result.lead?.notesSummary);
      setNoteContent('');
      setHasUnsavedChanges(false);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(null), 3000);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNew = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true);
    } else {
      resetForm();
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true);
    } else {
      onClose();
    }
  };

  const confirmDiscard = () => {
    setShowUnsavedWarning(false);
    resetForm();
    if (showUnsavedWarning) {
      // If triggered by New, stay open and reset
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      // If triggered by close, close modal
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Quick Update</h2>
              {/* Show current timezone with edit link when configured */}
              {isValidTimezone(clientTimezone) && !showTimezoneSelector && (
                <p className="text-xs text-gray-500 mt-1">
                  Timezone: {clientTimezone}
                  <button
                    onClick={() => setShowTimezoneSelector(true)}
                    className="ml-2 text-blue-600 hover:text-blue-800 underline"
                  >
                    Edit
                  </button>
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-md hover:bg-gray-200"
              title="Close (Esc)"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Timezone Configuration/Edit Panel */}
          {(!isValidTimezone(clientTimezone) || showTimezoneSelector) && (
            <div className="mt-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
              {!showTimezoneSelector && !isValidTimezone(clientTimezone) ? (
                // Show friendly prompt with configure button
                <div className="flex items-start gap-3">
                  <svg className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      {clientTimezone ? `Update timezone` : 'Set your timezone'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {clientTimezone ? `Current: "${clientTimezone}" - click to update.` : 'Quick setup for accurate follow-up scheduling.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowTimezoneSelector(true)}
                    className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Set Up
                  </button>
                </div>
              ) : (
                // Show timezone selector
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">
                      Select Your Timezone
                    </label>
                    <button
                      onClick={() => {
                        setShowTimezoneSelector(false);
                        setSelectedTimezone('');
                        setTimezoneError(null);
                      }}
                      className="text-gray-500 hover:text-gray-700 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                  <select
                    value={selectedTimezone === 'OTHER' || (selectedTimezone && !TIMEZONE_OPTIONS.find(tz => tz.value === selectedTimezone)) ? 'OTHER' : selectedTimezone}
                    onChange={(e) => {
                      if (e.target.value === 'OTHER') {
                        setSelectedTimezone('OTHER');
                        setCustomTimezone('');
                      } else {
                        setSelectedTimezone(e.target.value);
                        setCustomTimezone('');
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Choose timezone...</option>
                    <optgroup label="Australia">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Australia').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Pacific">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Pacific').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Asia">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Asia').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Europe">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Europe').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Americas">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Americas').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <option value="OTHER">Other (enter manually)...</option>
                  </select>
                  
                  {/* Custom timezone input */}
                  {selectedTimezone === 'OTHER' && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={customTimezone}
                        onChange={(e) => setCustomTimezone(e.target.value)}
                        placeholder="e.g. Europe/Paris, America/Denver"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter an IANA timezone like "Europe/Paris" or "America/Denver"
                      </p>
                    </div>
                  )}
                  
                  {timezoneError && (
                    <p className="text-sm text-red-600">{timezoneError}</p>
                  )}
                  <button
                    onClick={handleSaveTimezone}
                    disabled={(!selectedTimezone || (selectedTimezone === 'OTHER' && !customTimezone.trim())) || isSavingTimezone}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isSavingTimezone ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        Saving...
                      </>
                    ) : (
                      'Save Timezone'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
          
          {/* Lead Search */}
          <div className="mt-4 relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Find Lead
            </label>
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Paste LinkedIn URL, email, or type name..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {isSearching && (
                <div className="absolute right-3 top-2.5">
                  <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              )}
            </div>
            
            {/* Search Results Dropdown */}
            {searchResults.length > 0 && !selectedLead && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searchResults.length > 1 && (
                  <div className="px-3 py-2 text-xs text-gray-500 border-b">
                    Found {searchResults.length} matches via {lookupMethod}
                  </div>
                )}
                {searchResults.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => selectLead(lead)}
                    className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                  >
                    <div className="font-medium text-gray-900">
                      {lead.firstName} {lead.lastName}
                    </div>
                    <div className="text-sm text-gray-500">
                      {lead.title && <span>{lead.title}</span>}
                      {lead.title && lead.company && <span> @ </span>}
                      {lead.company && <span>{lead.company}</span>}
                    </div>
                    {lead.aiScore && (
                      <div className="text-xs text-blue-600 mt-1">
                        Score: {lead.aiScore}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Main Content - Three Columns */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Column - Notes Input */}
          <div className="flex-1 min-w-0 p-6 overflow-y-auto border-r border-gray-200">
            {/* Selected Lead Bar */}
            {selectedLead && (
              <div className="mb-4 flex items-center justify-between bg-blue-50 px-4 py-3 rounded-lg">
                <div>
                  <span className="font-semibold text-blue-900 text-lg">
                    {selectedLead.firstName} {selectedLead.lastName}
                  </span>
                  {selectedLead.title && selectedLead.company && (
                    <span className="text-blue-700 text-sm ml-2">
                      {selectedLead.title} @ {selectedLead.company}
                    </span>
                  )}
                  {selectedLead.aiScore && (
                    <span className="text-blue-600 text-sm ml-2 font-medium">
                      Score: {selectedLead.aiScore}
                    </span>
                  )}
                </div>
                <button
                  onClick={resetForm}
                  className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 bg-blue-100 rounded hover:bg-blue-200 transition-colors"
                >
                  Change Lead
                </button>
              </div>
            )}
            
            {/* Source Tabs */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Source
              </label>
              <div className="flex gap-2">
                {SECTIONS.map((section) => (
                  <button
                    key={section.key}
                    onClick={() => setActiveSection(section.key)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === section.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {SECTIONS.find(s => s.key === activeSection)?.description}
              </p>
            </div>
            
            {/* Notes Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {activeSection === 'manual' ? 'Note (date auto-added)' : 'Paste Conversation'}
              </label>
              <textarea
                ref={noteInputRef}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={12}
                placeholder={activeSection === 'manual' 
                  ? 'Type your note here...' 
                  : 'Paste conversation here (raw or AIBlaze format)...'
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              />
            </div>
            
            {/* Parse Status */}
            {parsePreview && parsePreview.format !== 'manual' && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-green-800">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>
                    Detected: <strong>{parsePreview.detectedFormat}</strong>
                    {parsePreview.messageCount > 0 && (
                      <span> · {parsePreview.messageCount} messages</span>
                    )}
                  </span>
                </div>
              </div>
            )}
            
            {/* Replace Warning */}
            {noteContent.trim() && activeSection !== 'manual' && notesSummary?.[activeSection]?.hasContent && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="text-sm text-yellow-800">
                  ⚠️ This will replace {notesSummary[activeSection].lineCount} existing lines in {SECTIONS.find(s => s.key === activeSection)?.label}.
                </div>
              </div>
            )}
          </div>
          
          {/* Middle Column - Preview */}
          <div className="w-80 flex-shrink-0 p-6 overflow-y-auto border-r border-gray-200 bg-gray-50">
            <h3 className="font-medium text-gray-900 mb-3">
              {parsePreview?.formatted || noteContent.trim() ? 'Preview (how it will look)' : 'Preview'}
            </h3>
            
            {(parsePreview?.formatted || (activeSection === 'manual' && noteContent.trim())) ? (
              <div className="bg-white border border-gray-200 rounded-lg p-4 max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                  {parsePreview?.formatted || (activeSection === 'manual' ? `${new Date().toLocaleDateString('en-AU')} - ${noteContent}` : noteContent)}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-gray-400 italic">
                {noteContent.trim() 
                  ? 'Processing...'
                  : 'Paste content on the left to see how it will be formatted'
                }
              </div>
            )}
            
            {/* Current Notes Summary */}
            {selectedLead && notesSummary && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Current Notes</h4>
                <div className="space-y-2">
                  {Object.entries(notesSummary).map(([key, info]) => (
                    info.hasContent && (
                      <div key={key} className="bg-white border border-gray-200 rounded p-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-medium capitalize text-gray-700">{key}</span>
                          <span className="text-gray-500">{info.lineCount} lines</span>
                        </div>
                        {info.lastDate && (
                          <div className="text-xs text-gray-400 mt-1">
                            Last update: {info.lastDate}
                          </div>
                        )}
                      </div>
                    )
                  ))}
                  {!Object.values(notesSummary).some(s => s.hasContent) && (
                    <div className="text-sm text-gray-400 italic">No notes yet</div>
                  )}
                </div>
              </div>
            )}
            
            {/* Full Notes View Button */}
            {selectedLead?.notes && (
              <div className="mt-6">
                <button
                  onClick={() => setShowNotesPreview(true)}
                  className="w-full px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  View Full Notes
                </button>
              </div>
            )}
          </div>
          
          {/* Right Column - Details */}
          <div className="w-72 flex-shrink-0 p-6 overflow-y-auto">
            <h3 className="font-medium text-gray-900 mb-4">Details</h3>
            
            {/* Follow-up Date */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Follow-up Date
              </label>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 7);
                    setFollowUpDate(d.toISOString().split('T')[0]);
                  }}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  +7 days
                </button>
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 14);
                    setFollowUpDate(d.toISOString().split('T')[0]);
                  }}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  +14 days
                </button>
                {followUpDate && (
                  <button
                    onClick={() => setFollowUpDate('')}
                    className="px-3 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            
            {/* Email */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            
            {/* Phone */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0400 000 000"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            
            {/* Lead Info */}
            {selectedLead && (
              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-3">Lead Info</h4>
                <div className="space-y-2 text-sm">
                  {selectedLead.linkedinProfileUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">LinkedIn:</span>
                      <a 
                        href={selectedLead.linkedinProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate"
                      >
                        View Profile
                      </a>
                    </div>
                  )}
                  {selectedLead.company && (
                    <div>
                      <span className="text-gray-500">Company:</span>{' '}
                      <span className="text-gray-900">{selectedLead.company}</span>
                    </div>
                  )}
                  {selectedLead.title && (
                    <div>
                      <span className="text-gray-500">Title:</span>{' '}
                      <span className="text-gray-900">{selectedLead.title}</span>
                    </div>
                  )}
                  {selectedLead.status && (
                    <div>
                      <span className="text-gray-500">Status:</span>{' '}
                      <span className="text-gray-900">{selectedLead.status}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          {/* Error Message */}
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              {error}
            </div>
          )}
          
          {/* Success Message */}
          {saveSuccess && (
            <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
              ✓ Saved {saveSuccess.leadName}
              {saveSuccess.noteUpdate && (
                <span> · Updated {saveSuccess.noteUpdate.section} section</span>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Esc = Cancel · Ctrl+Enter = Save · Ctrl+N = New
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!selectedLead || isSaving}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  selectedLead && !isSaving
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleNew}
                className="px-4 py-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                New
              </button>
            </div>
          </div>
        </div>
        
        {/* Unsaved Changes Warning Modal */}
        {showUnsavedWarning && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Unsaved Changes
              </h3>
              <p className="text-gray-600 mb-4">
                You have unsaved changes. Are you sure you want to discard them?
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowUnsavedWarning(false)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Go Back & Save
                </button>
                <button
                  onClick={confirmDiscard}
                  className="px-4 py-2 text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                >
                  Discard & Continue
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Full Notes Popup */}
        {showNotesPreview && selectedLead?.notes && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-8">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
              {/* Popup Header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between rounded-t-lg">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Full Notes - {selectedLead.firstName} {selectedLead.lastName}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {cleanLinkedInNoise(selectedLead.notes).split('\n').filter(l => l.trim()).length} lines
                  </p>
                </div>
                <button
                  onClick={() => setShowNotesPreview(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-md hover:bg-gray-200"
                  title="Close"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Notes Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed">
                  {cleanLinkedInNoise(selectedLead.notes)}
                </pre>
              </div>
              
              {/* Popup Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowNotesPreview(false)}
                    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
