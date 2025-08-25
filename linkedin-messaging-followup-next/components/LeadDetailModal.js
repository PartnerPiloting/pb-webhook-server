import React, { useState, useEffect } from 'react';
import LeadDetailForm from './LeadDetailForm';

const LeadDetailModal = ({ 
  lead, 
  isOpen, 
  onClose, 
  onUpdate, 
  onDelete, 
  isUpdating = false 
}) => {
  const [isMounted, setIsMounted] = useState(false);

  // Fix hydration issues by only rendering on client side
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscapeKey = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen && isMounted) {
      document.addEventListener('keydown', handleEscapeKey);
      document.body.style.overflow = 'hidden'; // Prevent background scroll
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, isMounted]);

  // Debug logging
  console.log('🔍 LeadDetailModal render:', { isOpen, hasLead: !!lead, leadId: lead?.id, isMounted });
  
  // Don't render anything if not mounted, not open, or no lead
  if (!isMounted || !isOpen || !lead) return null;

  // Safe render function
  const safeRender = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-y-auto bg-white"
      style={{ zIndex: 9999 }}
    >
      {/* Full Screen Modal */}
      <div className="min-h-full w-full">
        <div className="w-full h-full">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 sticky top-0 bg-white shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {safeRender(lead['First Name'])} {safeRender(lead['Last Name'])}
                </h2>
                <div className="text-sm text-gray-500 mt-1">
                  Profile Key: {safeRender(lead.id || lead['Profile Key'])}
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {/* LinkedIn Profile Link */}
                {lead['LinkedIn Profile URL'] && (
                  <a
                    href={lead['LinkedIn Profile URL']}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
                  >
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                      <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                    </svg>
                    LinkedIn
                  </a>
                )}
                
                {/* Close Button */}
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-md hover:bg-gray-100"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          {/* Content */}
          <div className="px-6 py-6 h-full">
            <LeadDetailForm
              lead={{
                id: lead.id || lead['Profile Key'],
                profileKey: lead['Profile Key'] || lead.id,
                firstName: safeRender(lead.firstName || lead['First Name']),
                lastName: safeRender(lead.lastName || lead['Last Name']),
                linkedinProfileUrl: safeRender(lead.linkedinProfileUrl || lead['LinkedIn Profile URL']),
                viewInSalesNavigator: safeRender(lead.viewInSalesNavigator || lead['View In Sales Navigator']),
                status: safeRender(lead.status || lead['Status']),
                priority: safeRender(lead.priority || lead['Priority']),
                linkedinConnectionStatus: safeRender(lead.linkedinConnectionStatus || lead['LinkedIn Connection Status']),
                followUpDate: safeRender(lead.followUpDate || lead['Follow-Up Date']),
                notes: safeRender(lead.notes || lead['Notes']),
                lastMessageDate: safeRender(lead.lastMessageDate || lead['Last Message Date']),
                postsRelevancePercentage: lead.postsRelevancePercentage || lead['Posts Relevance Percentage'],
                searchTerms: safeRender(lead.searchTerms || lead['Search Terms']),
                searchTokensCanonical: safeRender(lead.searchTokensCanonical || lead['Search Tokens (canonical)']),
                source: safeRender(lead.source || lead['Source']),
                // Contact fields (previously omitted -> caused blank email/phone in form when using modal)
                email: safeRender(lead.email || lead['Email']),
                phone: safeRender(lead.phone || lead['Phone']),
                ashWorkshopEmail: Boolean(lead.ashWorkshopEmail || lead['ASH Workshop Email']),
                // AI-related fields using actual API field names
                aiScore: lead.aiScore || lead['AI Score'],
                aiProfileAssessment: lead.aiProfileAssessment || lead['AI Profile Assessment'],
                aiAttributeBreakdown: lead.aiAttributeBreakdown || lead['AI Attribute Breakdown'],
                // Additional fields from API
                headline: safeRender(lead.headline || lead.jobTitle),
                companyName: safeRender(lead.companyName),
                about: safeRender(lead.about),
                // NOTE: removed duplicate source override that could blank out fallback value
                viewInSalesNavigator: safeRender(lead.viewInSalesNavigator)
              }}
              onUpdate={onUpdate}
              onDelete={onDelete}
              isUpdating={isUpdating}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeadDetailModal;
