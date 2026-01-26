import React, { useState, useEffect, useCallback } from 'react';
import SearchTermsField from './SearchTermsField';
import CollapsibleNotes from './CollapsibleNotes';
import { deleteLead } from '../services/api';
import { buildAuthUrl } from '../utils/clientUtils';

// Import icons using require to avoid Next.js issues
let CalendarIcon, StarIcon, ArrowTopRightOnSquareIcon, TrashIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  CalendarIcon = icons.CalendarIcon;
  StarIcon = icons.StarIcon;
  ArrowTopRightOnSquareIcon = icons.ArrowTopRightOnSquareIcon;
  TrashIcon = icons.TrashIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

// Simple date formatter to avoid date-fns issues
const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // Return original if invalid
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return dateString;
  }
};

// Function to detect and convert URLs to clickable links
const renderTextWithLinks = (text) => {
  if (!text) return null;
  
  // URL regex pattern
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);
  
  return parts.map((part, index) => {
    if (part.match(urlPattern)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

// Function to convert date to ISO format for HTML date input
const convertToISODate = (dateString) => {
  if (!dateString) return '';
  
  // If already in ISO format (YYYY-MM-DD), return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // Try to parse the date
  let date = new Date(dateString);
  
  // If invalid, try MM/DD/YYYY format
  if (isNaN(date.getTime()) && dateString.includes('/')) {
    const parts = dateString.split('/');
    if (parts.length === 3) {
      // Assuming MM/DD/YYYY format
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      date = new Date(year, month - 1, day); // month is 0-indexed in JS
    }
  }
  
  // Check if date is valid
  if (isNaN(date.getTime())) {
    return '';
  }
  
  // Convert to YYYY-MM-DD format
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

const LeadDetailForm = ({ lead, onUpdate, isUpdating, onDelete }) => {
  const [formData, setFormData] = useState({});
  const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
  const [hasChanges, setHasChanges] = useState(false);
  const [editingField, setEditingField] = useState(null); // Track which field is being edited
  const [isEditingNotes, setIsEditingNotes] = useState(false); // Track notes editing state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); // Track delete confirmation dialog
  const [isDeleting, setIsDeleting] = useState(false); // Track delete operation

  // Initialize form data when lead changes
  useEffect(() => {
    if (lead) {
      if (isDev) { try { console.debug('[LeadDetailForm] init lead source variants', { source: lead.source, Source: lead['Source'] }); } catch {} }
      // Normalize source (trim & collapse whitespace)
      const normalizedSource = (lead.source || lead['Source'] || '')
        .toString()
        .trim()
        .replace(/\s+/g, ' ');

      setFormData({
        firstName: lead.firstName || '',
        lastName: lead.lastName || '',
        linkedinProfileUrl: lead.linkedinProfileUrl || '',
        viewInSalesNavigator: lead.viewInSalesNavigator || '',
        email: lead.email || '',
  phone: lead.phone || '',
        location: lead.location || '',
        notes: lead.notes || '',
        followUpDate: convertToISODate(lead.followUpDate),
        source: normalizedSource,
        status: lead.status || '',
  priority: lead.priority || '',
  linkedinConnectionStatus: lead.linkedinConnectionStatus || '',
  searchTerms: lead.searchTerms || lead['Search Terms'] || '',
  searchTokensCanonical: lead.searchTokensCanonical || lead['Search Tokens (canonical)'] || ''
      });
      setHasChanges(false);
    }
  }, [lead]);

  // Handle form field changes
  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);
  };

  // Memoize the search terms change handler to prevent infinite re-renders
  const handleSearchTermsChange = useCallback((termsString, canonicalCsv) => {
    if (isDev) { try { console.debug('[LeadDetailForm] onTermsChange', { termsString, canonicalCsv }); } catch {} }
    setFormData(prev => ({
      ...prev,
      searchTerms: termsString,
      searchTokensCanonical: canonicalCsv
    }));
    setHasChanges(true);
  }, [isDev]);

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (hasChanges) {
  if (isDev) { try { console.debug('[LeadDetailForm] submitting update', formData); } catch {} }
      onUpdate(formData);
      setHasChanges(false);
    }
  };

  // Handle delete operation
  const handleDelete = async () => {
    if (!lead || !lead.id) return;
    
    setIsDeleting(true);
    try {
      await deleteLead(lead.id);
      setShowDeleteConfirm(false);
      
      // Notify parent component that lead was deleted
      if (onDelete) {
        onDelete(lead);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert(error.message || 'Failed to delete lead. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Return null if no lead is provided
  if (!lead) {
    return null;
  }

  // Form field configurations based on master field list
  const fieldConfig = {
    editable: [
      'firstName', 'lastName', 'linkedinProfileUrl', 'viewInSalesNavigator', 
  'email', 'phone', 'location', 'notes', 'source', 
  'status', 'priority', 'linkedinConnectionStatus', 'searchTerms'
    ],
    readonly: ['profileKey', 'aiScore', 'postsRelevancePercentage', 'lastMessageDate'],
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Action Buttons - Moved to top */}
      <div className="flex justify-between items-center pb-4 border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-gray-500">
            {hasChanges ? 'You have unsaved changes' : 'All changes saved'}
          </div>
          
          {/* Delete Button - Separated on left side */}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            disabled={isUpdating || isDeleting}
          >
            {TrashIcon && <TrashIcon className="h-4 w-4 mr-1" />}
            Delete Lead
          </button>
        </div>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => {
              if (lead) {
                const normalizedSource = (lead.source || lead['Source'] || '')
                  .toString()
                  .trim()
                  .replace(/\s+/g, ' ');
                // Helper to get location with raw fallback
                const getLocation = () => {
                  let loc = lead.location || lead['Location'] || '';
                  if (loc) return loc;
                  const rawData = lead['Raw Profile Data'] || lead.rawProfileData;
                  if (rawData) {
                    try {
                      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                      loc = parsed.location_name || parsed.location || '';
                    } catch (e) { /* ignore */ }
                  }
                  return loc;
                };
                setFormData({
                  firstName: lead.firstName || '',
                  lastName: lead.lastName || '',
                  linkedinProfileUrl: lead.linkedinProfileUrl || '',
                  viewInSalesNavigator: lead.viewInSalesNavigator || '',
                  email: lead.email || '',
                  phone: lead.phone || '',
                  location: getLocation(),
                  notes: lead.notes || '',
                  followUpDate: convertToISODate(lead.followUpDate),
                  source: normalizedSource,
                  status: lead.status || '',
                  priority: lead.priority || '',
                  linkedinConnectionStatus: lead.linkedinConnectionStatus || ''
                });
                setHasChanges(false);
              }
            }}
            className="btn-secondary"
            disabled={!hasChanges || isUpdating || isDeleting}
          >
            Reset Changes
          </button>
          
          <button
            type="submit"
            className="btn-primary"
            disabled={!hasChanges || isUpdating || isDeleting}
          >
            {isUpdating ? (
              <span className="inline-flex items-center">
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                Updating...
              </span>
            ) : (
              'Update Lead'
            )}
          </button>
        </div>
      </div>

      {/* Follow-up Date Section */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center">
          📅 Follow-up Date
        </h4>
        
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 pt-2">
              Follow-up Date
            </label>
            <div className="flex-1">
              <div className="flex gap-2">
                <input
                  type="date"
                  value={formData.followUpDate || ''}
                  onChange={(e) => handleChange('followUpDate', e.target.value)}
                  className="w-48 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => handleChange('followUpDate', '')}
                  className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                  title="Clear follow-up date"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center">
          📝 Notes
        </h4>
        
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 pt-2">
              Notes
            </label>
            <div className="flex-1">
              {isEditingNotes ? (
                <>
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[180px] resize-y text-sm"
                    rows={9}
                    placeholder="Add manual notes here. LinkedIn conversations will be automatically captured and appended..."
                    autoFocus
                    data-text-blaze="enabled"
                    data-tb-allow="true"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsEditingNotes(false)}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Done Editing
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-gray-500">
                      Click section headers to expand. Click Edit to modify.
                    </p>
                    <div className="flex gap-2">
                      <a
                        href={buildAuthUrl(`/quick-update?linkedinUrl=${encodeURIComponent(lead?.linkedinProfileUrl || '')}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 inline-flex items-center gap-1"
                      >
                        + Add Note
                      </a>
                      <a
                        href={buildAuthUrl(`/calendar-booking?linkedinUrl=${encodeURIComponent(lead?.linkedinProfileUrl || '')}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 inline-flex items-center gap-1"
                      >
                        Book Meeting
                      </a>
                      <button
                        type="button"
                        onClick={() => setIsEditingNotes(true)}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        Edit Notes
                      </button>
                    </div>
                  </div>
                  <div className="w-full border border-gray-300 rounded-md bg-gray-50 min-h-[180px] max-h-[400px] overflow-hidden">
                    {formData.notes ? (
                      <CollapsibleNotes 
                        notes={formData.notes} 
                        maxHeight={380}
                        defaultExpanded={false}
                        showLineNumbers={true}
                      />
                    ) : (
                      <div 
                        className="p-3 text-gray-400 italic cursor-pointer hover:bg-gray-100"
                        onClick={() => setIsEditingNotes(true)}
                      >
                        Click to add notes...
                      </div>
                    )}
                  </div>
                </>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Chrome extension automatically captures LinkedIn conversations with timestamps.
                Manual notes are preserved separately.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Basic Information */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Basic Information</h4>
        
        <div className="space-y-3">
          {/* First Name and Last Name on same line */}
          <div className="flex space-x-4">
            <div className="flex flex-1">
              <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">First Name</label>
              <input
                type="text"
                value={formData.firstName || ''}
                onChange={(e) => handleChange('firstName', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Enter first name"
              />
            </div>
            <div className="flex flex-1">
              <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Last Name</label>
              <input
                type="text"
                value={formData.lastName || ''}
                onChange={(e) => handleChange('lastName', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Enter last name"
              />
            </div>
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
              LinkedIn Profile URL *
            </label>
            <div className="flex-1">
              {editingField === 'linkedinProfileUrl' ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="url"
                    value={formData.linkedinProfileUrl || ''}
                    onChange={(e) => handleChange('linkedinProfileUrl', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="https://www.linkedin.com/in/username"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setEditingField(null)}
                    className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        linkedinProfileUrl: lead.linkedinProfileUrl || ''
                      }));
                      setEditingField(null);
                    }}
                    className="px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-md bg-white">
                  {formData.linkedinProfileUrl ? (
                    <a
                      href={formData.linkedinProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline break-all flex-1"
                    >
                      {formData.linkedinProfileUrl}
                    </a>
                  ) : (
                    <span className="text-gray-400 italic flex-1">No LinkedIn URL</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingField('linkedinProfileUrl')}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex-shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">View In Sales Navigator</label>
            <div className="flex-1">
              {editingField === 'viewInSalesNavigator' ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="url"
                    value={formData.viewInSalesNavigator || ''}
                    onChange={(e) => handleChange('viewInSalesNavigator', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="https://www.linkedin.com/sales/..."
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setEditingField(null)}
                    className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        viewInSalesNavigator: lead.viewInSalesNavigator || ''
                      }));
                      setEditingField(null);
                    }}
                    className="px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-md bg-white">
                  {formData.viewInSalesNavigator ? (
                    <a
                      href={formData.viewInSalesNavigator}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline break-all flex-1"
                    >
                      {formData.viewInSalesNavigator}
                    </a>
                  ) : (
                    <span className="text-gray-400 italic flex-1">No Sales Navigator URL</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingField('viewInSalesNavigator')}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex-shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Email</label>
            <input
              type="email"
              value={formData.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="email@example.com"
            />
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Phone</label>
            <input
              type="text"
              value={formData.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Enter phone number"
              autoComplete="off"
              inputMode="text"
            />
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Location</label>
            <input
              type="text"
              value={formData.location || ''}
              onChange={(e) => handleChange('location', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="City, Country (e.g., Sydney, Australia)"
            />
          </div>

          
        </div>
      </div>

      {/* Status and Classification */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Status & Classification</h4>
        
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Source</label>
            {(() => {
              // Merge in current value if it's not part of predefined options
              let sourceOptions = fieldConfig.selectOptions.source.slice();
              const current = (formData.source || '').trim();
              if (current && !sourceOptions.includes(current)) {
                sourceOptions = [...sourceOptions, current];
              }
              return (
                <select
                  value={formData.source || ''}
                  onChange={(e) => handleChange('source', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">Select source...</option>
                  {sourceOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              );
            })()}
          </div>
          
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Status</label>
            <select
              value={formData.status || ''}
              onChange={(e) => handleChange('status', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select status...</option>
              {fieldConfig.selectOptions.status.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Priority</label>
            <select
              value={formData.priority || ''}
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
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">LinkedIn Connection</label>
            <select
              value={formData.linkedinConnectionStatus || ''}
              onChange={(e) => handleChange('linkedinConnectionStatus', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select status...</option>
              {fieldConfig.selectOptions.linkedinConnectionStatus.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          {/* Search Terms (chips) */}
          <div className="flex items-start">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Search Terms</label>
            <div className="flex-1">
              <SearchTermsField
                initialTerms={formData.searchTerms || formData.searchTokensCanonical || ''}
                onTermsChange={handleSearchTermsChange}
                disabled={isUpdating}
                showBooleanHelp={false}
                placeholder="Type terms and press Enter or comma to tag this lead..."
              />
              {/* Helper note removed per UX feedback */}
            </div>
          </div>
        </div>
      </div>

      {/* Scores Section */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center">
          {StarIcon && <StarIcon className="h-5 w-5 mr-2" />}
          Scores
        </h4>
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Profile Score</label>
            <div className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 text-sm">
              {lead.aiScore !== null && lead.aiScore !== undefined ? lead.aiScore : 'Not scored'}
            </div>
          </div>
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Top Post's Score</label>
            <div className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 text-sm">
              {lead.postsRelevancePercentage ? `${Math.round(lead.postsRelevancePercentage)}%` : 'No data'}
            </div>
          </div>
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">AI Attribute Breakdown</label>
            <div className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 text-sm max-h-40 overflow-y-auto">
              {lead.aiAttributeBreakdown || lead['AI Attribute Breakdown'] ? (
                <div className="whitespace-pre-wrap text-xs">{lead.aiAttributeBreakdown || lead['AI Attribute Breakdown']}</div>
              ) : (
                'No breakdown available'
              )}
            </div>
          </div>
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">AI Profile Assessment</label>
            <div className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 text-sm max-h-40 overflow-y-auto">
              {lead.aiProfileAssessment || lead['AI Profile Assessment'] ? (
                <div className="whitespace-pre-wrap text-xs">{lead.aiProfileAssessment || lead['AI Profile Assessment']}</div>
              ) : (
                'No assessment available'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Message History Preview */}
      {lead && lead.lastMessageDate && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h5 className="text-sm font-medium text-blue-900 mb-2">Recent Activity</h5>
          <p className="text-sm text-blue-700">
            Last message: {formatDate(lead.lastMessageDate)}
          </p>
          <p className="text-xs text-blue-600 mt-1">
            Full message history is managed by the Chrome extension
          </p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md mx-auto p-6">
            <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
              {TrashIcon && <TrashIcon className="h-6 w-6 text-red-600" />}
            </div>
            
            <h3 className="text-lg font-medium text-gray-900 text-center mb-2">
              Delete Lead
            </h3>
            
            <p className="text-sm text-gray-500 text-center mb-6">
              Are you sure you want to delete <strong>{lead?.firstName} {lead?.lastName}</strong>? 
              This action cannot be undone and will permanently remove all data for this lead.
            </p>
            
            <div className="flex space-x-3 justify-center">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isDeleting}
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <span className="inline-flex items-center">
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Deleting...
                  </span>
                ) : (
                  'Delete Lead'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};

export default LeadDetailForm;
