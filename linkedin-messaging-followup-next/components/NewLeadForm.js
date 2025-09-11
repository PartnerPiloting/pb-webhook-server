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

const NewLeadForm = ({ onLeadCreated }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    linkedinProfileUrl: '',
    viewInSalesNavigator: '',
    email: '',
    phone: '',
    ashWorkshopEmail: false,
    notes: '',
    followUpDate: '',
    source: 'Follow-Up Personally', // Default value
    status: 'On The Radar', // Default value
    priority: '',
    linkedinConnectionStatus: ''
  });
  
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showLinkedInHelper, setShowLinkedInHelper] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState({ isChecking: false, duplicates: [] });

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
      
      // Search for leads - we'll get all results and filter them locally
      const results = await searchLeads(formData.linkedinProfileUrl, 'all');
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
  };

  // Validate required fields
  const validateForm = () => {
    const requiredFields = [
      { field: 'firstName', label: 'First Name' },
      { field: 'lastName', label: 'Last Name' },
      { field: 'source', label: 'Source' },
      { field: 'status', label: 'Status' }
    ];

    for (const { field, label } of requiredFields) {
      if (!formData[field] || formData[field].trim() === '') {
        setMessage({ 
          type: 'error', 
          text: `${label} is required` 
        });
        return false;
      }
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

    console.log('No duplicates found, proceeding with creation');
    setIsCreating(true);
    setMessage({ type: '', text: '' });

    try {
      // Prepare data for creation
      const createData = { ...formData };
      
      // Show helper message if LinkedIn URL will be auto-generated
      if (!createData.linkedinProfileUrl || createData.linkedinProfileUrl.trim() === '') {
        setShowLinkedInHelper(true);
      }

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
        ashWorkshopEmail: false,
        notes: '',
        followUpDate: '',
        source: 'Follow-Up Personally', // Keep default
        status: 'On The Radar', // Keep default
        priority: '',
        linkedinConnectionStatus: ''
      });
      
      setShowLinkedInHelper(false);
      
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
      setShowLinkedInHelper(false);
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
      ashWorkshopEmail: false,
      notes: '',
      followUpDate: '',
      source: 'Follow-Up Personally',
      status: 'On The Radar',
      priority: '',
      linkedinConnectionStatus: ''
    });
    setMessage({ type: '', text: '' });
    setShowLinkedInHelper(false);
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

      {/* LinkedIn URL helper message */}
      {showLinkedInHelper && (
        <div className="mb-6 p-4 rounded-lg bg-blue-100 text-blue-800">
          <p className="text-sm">
            💡 Since no LinkedIn URL was provided, a placeholder was automatically generated. 
            You can update this later when the LinkedIn profile becomes known.
          </p>
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
        
        {/* Basic Information - Required Fields First */}
        <div className="space-y-6">
          <h4 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Basic Information
          </h4>
          
          <div className="space-y-3">
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

            <div className="flex">
              <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0 py-2">
                LinkedIn Profile URL
              </label>
              <div className="flex-1">
                <input
                  type="url"
                  value={formData.linkedinProfileUrl}
                  onChange={(e) => handleChange('linkedinProfileUrl', e.target.value)}
                  onBlur={checkForDuplicates}
                  onPaste={(e) => {
                    // Trigger duplicate check after paste event processes
                    setTimeout(() => checkForDuplicates(), 100);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="https://www.linkedin.com/in/username (optional)"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to auto-generate placeholder. Can be updated later.
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
                ASH Workshop Email
              </label>
              <div className="flex-1 flex items-center py-2">
                <input
                  type="checkbox"
                  checked={formData.ashWorkshopEmail}
                  onChange={(e) => handleChange('ashWorkshopEmail', e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-600">
                  Add to workshop invite list
                </span>
              </div>
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
                  onChange={(e) => handleChange('followUpDate', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank for no follow-up
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