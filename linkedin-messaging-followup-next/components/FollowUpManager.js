"use client";
import React, { useState, useEffect, useRef } from 'react';
import { getFollowUps, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';

// Import icons using require to avoid Next.js issues
let CalendarDaysIcon, UserIcon, ExternalLinkIcon, ClockIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  CalendarDaysIcon = icons.CalendarDaysIcon;
  UserIcon = icons.UserIcon;
  ExternalLinkIcon = icons.ExternalLinkIcon;
  ClockIcon = icons.ClockIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

// Safe rendering helper
const safeRender = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  return value;
};

// Helper to format follow-up status
const getFollowUpStatus = (daysUntilFollowUp) => {
  if (daysUntilFollowUp < 0) {
    const daysOverdue = Math.abs(daysUntilFollowUp);
    return {
      text: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200'
    };
  } else if (daysUntilFollowUp === 0) {
    return {
      text: 'Due today',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200'
    };
  } else {
    return {
      text: `Due in ${daysUntilFollowUp} day${daysUntilFollowUp === 1 ? '' : 's'}`,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200'
    };
  }
};

// Helper to format date for display
const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return dateString;
  }
};

const FollowUpManager = () => {
  const [followUps, setFollowUps] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Load follow-ups on component mount
  useEffect(() => {
    loadFollowUps();
  }, []);

  // Auto-select first lead when follow-ups load
  useEffect(() => {
    if (followUps && followUps.length > 0 && !selectedLead) {
      handleLeadSelect(followUps[0]);
    }
  }, [followUps]);

  const loadFollowUps = async () => {
    setIsLoading(true);
    try {
      console.log('🗓️ Loading follow-ups');
      const results = await getFollowUps();
      setFollowUps(results || []);
      console.log(`🗓️ Loaded ${results?.length || 0} follow-ups`);
    } catch (error) {
      console.error('Failed to load follow-ups:', error);
      setMessage({ type: 'error', text: 'Failed to load follow-ups. Please refresh the page.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle lead selection - fetch full details
  const handleLeadSelect = async (lead) => {
    if (!lead || !lead.id) {
      console.error('Invalid lead selected:', lead);
      return;
    }
    
    setIsLoading(true);
    try {
      const fullLead = await getLeadById(lead.id);
      setSelectedLead(fullLead);
    } catch (error) {
      console.error('Failed to load lead details:', error);
      setMessage({ type: 'error', text: 'Failed to load lead details. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle lead update
  const handleLeadUpdate = async (updatedData) => {
    if (!selectedLead) return;

    setIsUpdating(true);
    try {
      const updated = await updateLead(selectedLead.id, updatedData);
      
      setSelectedLead(updated);
      setMessage({ type: 'success', text: 'Lead updated successfully!' });
      
      // Check if follow-up date was changed to future date or cleared
      const updatedDate = updated['Follow-Up Date'];
      const shouldRemoveFromList = !updatedDate || updatedDate === '' || 
        (updatedDate && new Date(updatedDate) > new Date());

      if (shouldRemoveFromList) {
        const currentIndex = followUps.findIndex(lead => 
          lead['Profile Key'] === (updated.id || updated['Profile Key'])
        );
        
        // Remove from list
        const newFollowUps = followUps.filter(lead => 
          lead['Profile Key'] !== (updated.id || updated['Profile Key'])
        );
        setFollowUps(newFollowUps);
        
        // Auto-advance to next lead
        if (newFollowUps.length > 0) {
          const nextIndex = Math.min(currentIndex, newFollowUps.length - 1);
          handleLeadSelect(newFollowUps[nextIndex]);
          setMessage({ type: 'success', text: 'Lead removed from follow-ups! Advanced to next lead.' });
        } else {
          setSelectedLead(null);
          setMessage({ type: 'success', text: 'Lead removed from follow-ups! No more leads due.' });
        }
      } else {
        // Update the lead in the follow-ups list
        setFollowUps(prevFollowUps => 
          prevFollowUps.map(lead => 
            lead['Profile Key'] === (updated.id || updated['Profile Key']) ? {
              ...lead,
              'First Name': updated['First Name'] || '',
              'Last Name': updated['Last Name'] || '',
              'Status': updated['Status'] || '',
              'Follow-Up Date': updated['Follow-Up Date'] || '',
              'Notes': updated['Notes'] || ''
            } : lead
          )
        );
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
    } catch (error) {
      console.error('Update error:', error);
      setMessage({ type: 'error', text: 'Failed to update lead. Please try again.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle lead deletion
  const handleLeadDelete = (deletedLead) => {
    if (!deletedLead) return;

    const currentIndex = followUps.findIndex(lead => 
      lead['Profile Key'] === (deletedLead.id || deletedLead['Profile Key'])
    );

    // Remove the lead from the follow-ups list
    const newFollowUps = followUps.filter(lead => 
      lead['Profile Key'] !== (deletedLead.id || deletedLead['Profile Key'])
    );
    setFollowUps(newFollowUps);
    
    // Auto-advance to next lead or clear selection
    if (newFollowUps.length > 0) {
      const nextIndex = Math.min(currentIndex, newFollowUps.length - 1);
      handleLeadSelect(newFollowUps[nextIndex]);
      setMessage({ 
        type: 'success', 
        text: `${deletedLead.firstName || ''} ${deletedLead.lastName || ''} deleted. Advanced to next lead.` 
      });
    } else {
      setSelectedLead(null);
      setMessage({ 
        type: 'success', 
        text: `${deletedLead.firstName || ''} ${deletedLead.lastName || ''} deleted. No more leads due.` 
      });
    }
    
    // Clear success message after 5 seconds
    setTimeout(() => {
      setMessage({ type: '', text: '' });
    }, 5000);
  };

  return (
    <div className="w-full flex flex-col lg:flex-row gap-6">
      {/* Message display */}
      {message && message.text && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {safeRender(message.text)}
        </div>
      )}
      
      <div className="lg:w-1/4 w-full">
        <div className="mb-4 flex items-center space-x-2">
          {CalendarDaysIcon && <CalendarDaysIcon className="h-6 w-6 text-blue-600" />}
          <h3 className="text-lg font-semibold text-gray-900">Follow-ups Due</h3>
          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
            {followUps.length}
          </span>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-h-[600px] overflow-y-auto">
          {isLoading && (!followUps || followUps.length === 0) ? (
            <div className="text-center py-6">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-gray-500 mt-3">Loading follow-ups...</p>
            </div>
          ) : (
            <>
              {followUps && Array.isArray(followUps) && followUps.map(lead => {
                if (!lead || !lead['Profile Key']) return null;
                
                const followUpStatus = getFollowUpStatus(lead.daysUntilFollowUp);
                
                return (
                  <div
                    key={lead['Profile Key']}
                    className={`p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${
                      selectedLead && (selectedLead.id || selectedLead['Profile Key']) === lead['Profile Key'] 
                        ? 'bg-blue-50 border-blue-200' 
                        : ''
                    }`}
                    onClick={() => handleLeadSelect(lead)}
                  >
                    <div className="flex items-center">
                      {UserIcon && <UserIcon className="h-5 w-5 mr-3 text-gray-400 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">
                          {safeRender(lead['First Name'])} {safeRender(lead['Last Name'])}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {safeRender(lead['Status'], 'No status')} • Score: {safeRender(lead['AI Score'], 'N/A')}
                        </div>
                        <div className="flex items-center mt-1">
                          {ClockIcon && <ClockIcon className="h-3 w-3 mr-1 text-gray-400" />}
                          <span className={`text-xs font-medium ${followUpStatus.color}`}>
                            {followUpStatus.text}
                          </span>
                          <span className="text-xs text-gray-400 ml-2">
                            ({formatDate(lead['Follow-Up Date'])})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!followUps || followUps.length === 0) && !isLoading && (
                <div className="p-6 text-center text-gray-500 italic">
                  <CalendarDaysIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-lg">No follow-ups due</p>
                  <p className="text-sm mt-1">Leads with follow-up dates today or earlier will appear here</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="lg:w-3/4 w-full">
        {selectedLead ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <div className="mb-6 pb-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {safeRender(selectedLead['First Name'])} {safeRender(selectedLead['Last Name'])}
                </h2>
                {selectedLead['LinkedIn Profile URL'] && ExternalLinkIcon && (
                  <a
                    href={selectedLead['LinkedIn Profile URL']}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                    title="Open LinkedIn Profile"
                  >
                    <ExternalLinkIcon className="h-6 w-6" />
                  </a>
                )}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Profile Key: {safeRender(selectedLead.id || selectedLead['Profile Key'])}
              </div>
              {selectedLead['Follow-Up Date'] && (
                <div className="mt-2">
                  <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                    getFollowUpStatus(selectedLead.daysUntilFollowUp).bgColor
                  } ${getFollowUpStatus(selectedLead.daysUntilFollowUp).color}`}>
                    {ClockIcon && <ClockIcon className="h-3 w-3 mr-1" />}
                    {getFollowUpStatus(selectedLead.daysUntilFollowUp).text}
                  </span>
                </div>
              )}
            </div>
            
            <LeadDetailForm
              lead={{
                ...selectedLead,
                // Map the fields to the expected format with safety
                id: safeRender(selectedLead.id || selectedLead['Profile Key']),
                profileKey: safeRender(selectedLead['Profile Key']),
                firstName: safeRender(selectedLead['First Name']),
                lastName: safeRender(selectedLead['Last Name']),
                linkedinProfileUrl: safeRender(selectedLead['LinkedIn Profile URL']),
                viewInSalesNavigator: safeRender(selectedLead['View In Sales Navigator']),
                email: safeRender(selectedLead['Email']),
                phone: safeRender(selectedLead['Phone']),
                ashWorkshopEmail: Boolean(selectedLead['ASH Workshop Email']),
                aiScore: selectedLead['AI Score'],
                postsRelevancePercentage: selectedLead['Posts Relevance Percentage'],
                source: safeRender(selectedLead['Source']),
                status: safeRender(selectedLead['Status']),
                priority: safeRender(selectedLead['Priority']),
                linkedinConnectionStatus: safeRender(selectedLead['LinkedIn Connection Status']),
                followUpDate: safeRender(selectedLead.followUpDate),
                notes: safeRender(selectedLead['Notes']),
                lastMessageDate: safeRender(selectedLead['Last Message Date']),
                daysUntilFollowUp: selectedLead.daysUntilFollowUp
              }}
              onUpdate={handleLeadUpdate}
              onDelete={handleLeadDelete}
              isUpdating={isUpdating}
            />
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <div className="text-center text-gray-400 py-16">
              {CalendarDaysIcon && <CalendarDaysIcon className="h-20 w-20 mx-auto mb-6 text-gray-300" />}
              <p className="text-xl text-gray-500">Select a lead to manage follow-up</p>
              <p className="text-sm text-gray-400 mt-2">Choose a lead from the list to view details and update follow-up status</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FollowUpManager;
