import React, { useState, useEffect } from 'react';
import { CalendarIcon, StarIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const LeadDetailForm = ({ lead, onUpdate, isUpdating }) => {
  const [formData, setFormData] = useState({});
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form data when lead changes
  useEffect(() => {
    if (lead) {
      setFormData({
        firstName: lead.firstName || lead['First Name'] || '',
        lastName: lead.lastName || lead['Last Name'] || '',
        linkedinProfileUrl: lead.linkedinProfileUrl || lead['LinkedIn Profile URL'] || '',
        viewInSalesNavigator: lead.viewInSalesNavigator || lead['View In Sales Navigator'] || '',
        email: lead.email || lead['Email'] || '',
        notes: lead.notes || lead['Notes'] || '',
        followUpDate: lead.followUpDate || lead['Follow-Up Date'] || '',
        followUpNotes: lead.followUpNotes || lead['Follow-Up Notes'] || '',
        source: lead.source || lead['Source'] || '',
        status: lead.status || lead['Status'] || '',
        priority: lead.priority || lead['Priority'] || '',
        linkedinConnectionStatus: lead.linkedinConnectionStatus || lead['LinkedIn Connection Status'] || ''
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
      {/* Read-only Fields Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
        <div>
          <label className="field-label">Profile Key</label>
          <input
            type="text"
            value={lead.profileKey || lead['Profile Key'] || 'Auto-generated'}
            readOnly
            className="form-field"
          />
        </div>
        <div>
          <label className="field-label flex items-center">
            <StarIcon className="h-4 w-4 mr-1" />
            AI Score
          </label>
          <input
            type="number"
            value={lead.aiScore || lead['AI Score'] || ''}
            readOnly
            className="form-field"
            placeholder="Not scored"
          />
        </div>
        <div>
          <label className="field-label">Posts Relevance %</label>
          <input
            type="text"
            value={lead.postsRelevancePercentage ? `${lead.postsRelevancePercentage}%` : ''}
            readOnly
            className="form-field"
            placeholder="No data"
          />
        </div>
      </div>

      {/* Basic Information */}
      <div className="space-y-4">
        <h4 className="text-lg font-medium text-gray-900">Basic Information</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label">First Name *</label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              className="form-field"
              required
            />
          </div>
          <div>
            <label className="field-label">Last Name *</label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              className="form-field"
              required
            />
          </div>
        </div>

        <div>
          <label className="field-label flex items-center">
            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-1" />
            LinkedIn Profile URL *
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="url"
              value={formData.linkedinProfileUrl}
              onChange={(e) => handleChange('linkedinProfileUrl', e.target.value)}
              className="form-field flex-1"
              placeholder="https://www.linkedin.com/in/username"
              required
            />
            {formData.linkedinProfileUrl && (
              <a
                href={formData.linkedinProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-2 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                title="Open LinkedIn Profile"
              >
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        <div>
          <label className="field-label">View In Sales Navigator</label>
          <div className="flex items-center space-x-2">
            <input
              type="url"
              value={formData.viewInSalesNavigator}
              onChange={(e) => handleChange('viewInSalesNavigator', e.target.value)}
              className="form-field flex-1"
              placeholder="https://www.linkedin.com/sales/..."
            />
            {formData.viewInSalesNavigator && (
              <a
                href={formData.viewInSalesNavigator}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-2 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                title="Open Sales Navigator"
              >
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        <div>
          <label className="field-label">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className="form-field"
            placeholder="email@example.com"
          />
        </div>
      </div>

      {/* Status and Classification */}
      <div className="space-y-4">
        <h4 className="text-lg font-medium text-gray-900">Status & Classification</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="field-label">Source</label>
            <select
              value={formData.source}
              onChange={(e) => handleChange('source', e.target.value)}
              className="form-field"
            >
              <option value="">Select source...</option>
              {fieldConfig.selectOptions.source.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="field-label">Status</label>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="form-field"
            >
              <option value="">Select status...</option>
              {fieldConfig.selectOptions.status.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="field-label">Priority</label>
            <select
              value={formData.priority}
              onChange={(e) => handleChange('priority', e.target.value)}
              className="form-field"
            >
              <option value="">Select priority...</option>
              {fieldConfig.selectOptions.priority.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="field-label">LinkedIn Connection</label>
            <select
              value={formData.linkedinConnectionStatus}
              onChange={(e) => handleChange('linkedinConnectionStatus', e.target.value)}
              className="form-field"
            >
              <option value="">Select status...</option>
              {fieldConfig.selectOptions.linkedinConnectionStatus.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Follow-up Section */}
      <div className="space-y-4">
        <h4 className="text-lg font-medium text-gray-900 flex items-center">
          <CalendarIcon className="h-5 w-5 mr-2" />
          Follow-up Management
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Follow-up Date</label>
            <input
              type="date"
              value={formData.followUpDate}
              onChange={(e) => handleChange('followUpDate', e.target.value)}
              className="form-field"
            />
          </div>
          <div>
            <label className="field-label">Follow-up Notes</label>
            <input
              type="text"
              value={formData.followUpNotes}
              onChange={(e) => handleChange('followUpNotes', e.target.value)}
              className="form-field"
              placeholder="Context for next interaction..."
            />
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="space-y-4">
        <h4 className="text-lg font-medium text-gray-900">Notes & Conversations</h4>
        <div>
          <label className="field-label">
            Notes (Manual + Auto-captured conversations)
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            className="form-textarea"
            rows={6}
            placeholder="Add manual notes here. LinkedIn conversations will be automatically captured and appended..."
          />
          <p className="text-xs text-gray-500 mt-1">
            Chrome extension automatically captures LinkedIn conversations with timestamps.
            Manual notes are preserved separately.
          </p>
        </div>
      </div>

      {/* Message History Preview */}
      {lead.lastMessageDate && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h5 className="text-sm font-medium text-blue-900 mb-2">Recent Activity</h5>
          <p className="text-sm text-blue-700">
            Last message: {format(new Date(lead.lastMessageDate), 'MMM d, yyyy h:mm a')}
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
              setFormData({
                firstName: lead.firstName || lead['First Name'] || '',
                lastName: lead.lastName || lead['Last Name'] || '',
                linkedinProfileUrl: lead.linkedinProfileUrl || lead['LinkedIn Profile URL'] || '',
                viewInSalesNavigator: lead.viewInSalesNavigator || lead['View In Sales Navigator'] || '',
                email: lead.email || lead['Email'] || '',
                notes: lead.notes || lead['Notes'] || '',
                followUpDate: lead.followUpDate || lead['Follow-Up Date'] || '',
                followUpNotes: lead.followUpNotes || lead['Follow-Up Notes'] || '',
                source: lead.source || lead['Source'] || '',
                status: lead.status || lead['Status'] || '',
                priority: lead.priority || lead['Priority'] || '',
                linkedinConnectionStatus: lead.linkedinConnectionStatus || lead['LinkedIn Connection Status'] || ''
              });
              setHasChanges(false);
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
