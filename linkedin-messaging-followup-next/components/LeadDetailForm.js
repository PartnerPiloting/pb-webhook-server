import React, { useState, useEffect } from 'react';

// Import icons using require to avoid Next.js issues
let CalendarIcon, StarIcon, ArrowTopRightOnSquareIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  CalendarIcon = icons.CalendarIcon;
  StarIcon = icons.StarIcon;
  ArrowTopRightOnSquareIcon = icons.ArrowTopRightOnSquareIcon;
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

const LeadDetailForm = ({ lead, onUpdate, isUpdating }) => {
  const [formData, setFormData] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [editingField, setEditingField] = useState(null); // Track which field is being edited

  // Initialize form data when lead changes
  useEffect(() => {
    if (lead) {
      setFormData({
        firstName: lead.firstName || '',
        lastName: lead.lastName || '',
        linkedinProfileUrl: lead.linkedinProfileUrl || '',
        viewInSalesNavigator: lead.viewInSalesNavigator || '',
        email: lead.email || '',
        notes: lead.notes || '',
        followUpDate: lead.followUpDate || '',
        source: lead.source || '',
        status: lead.status || '',
        priority: lead.priority || '',
        linkedinConnectionStatus: lead.linkedinConnectionStatus || ''
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

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (hasChanges) {
      onUpdate(formData);
      setHasChanges(false);
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
      'email', 'notes', 'followUpDate', 'followUpNotes', 'source', 
      'status', 'priority', 'linkedinConnectionStatus'
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
      {/* Follow-up Management - Top Priority Section */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 flex items-center">
          {CalendarIcon && <CalendarIcon className="h-5 w-5 mr-2" />}
          Follow-up Management
        </h4>
        
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Follow-up Date</label>
            <div className="flex-1 flex items-center space-x-2">
              <input
                type="date"
                value={formData.followUpDate || ''}
                onChange={(e) => handleChange('followUpDate', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              {formData.followUpDate && (
                <button
                  type="button"
                  onClick={() => handleChange('followUpDate', '')}
                  className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex-shrink-0"
                  title="Clear follow-up date"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 pt-2">
              Notes
            </label>
            <div className="flex-1">
              <textarea
                value={formData.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[180px] resize-y text-sm"
                rows={9}
                placeholder="Add manual notes here. LinkedIn conversations will be automatically captured and appended..."
              />
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
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">First Name *</label>
            <input
              type="text"
              value={formData.firstName || ''}
              onChange={(e) => handleChange('firstName', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              required
            />
          </div>
          
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Last Name *</label>
            <input
              type="text"
              value={formData.lastName || ''}
              onChange={(e) => handleChange('lastName', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              required
            />
          </div>

          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2 flex items-center">
              {ArrowTopRightOnSquareIcon && <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-1" />}
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
        </div>
      </div>

      {/* Status and Classification */}
      <div className="space-y-6">
        <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Status & Classification</h4>
        
        <div className="space-y-3">
          <div className="flex">
            <label className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Source</label>
            <select
              value={formData.source || ''}
              onChange={(e) => handleChange('source', e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select source...</option>
              {fieldConfig.selectOptions.source.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
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
              {lead.postsRelevancePercentage ? `${lead.postsRelevancePercentage}%` : 'No data'}
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

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-6 border-t border-gray-200">
        <div className="text-sm text-gray-500">
          {hasChanges ? 'You have unsaved changes' : 'All changes saved'}
        </div>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => {
              if (lead) {
                setFormData({
                  firstName: lead.firstName || '',
                  lastName: lead.lastName || '',
                  linkedinProfileUrl: lead.linkedinProfileUrl || '',
                  viewInSalesNavigator: lead.viewInSalesNavigator || '',
                  email: lead.email || '',
                  notes: lead.notes || '',
                  followUpDate: lead.followUpDate || '',
                  source: lead.source || '',
                  status: lead.status || '',
                  priority: lead.priority || '',
                  linkedinConnectionStatus: lead.linkedinConnectionStatus || ''
                });
                setHasChanges(false);
              }
            }}
            className="btn-secondary"
            disabled={!hasChanges || isUpdating}
          >
            Reset Changes
          </button>
          
          <button
            type="submit"
            className="btn-primary"
            disabled={!hasChanges || isUpdating}
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
    </form>
  );
};

export default LeadDetailForm;
