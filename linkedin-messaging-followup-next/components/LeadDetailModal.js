import React, { useState, useEffect } from 'react';
import HelpButton from './HelpButton';
import LeadDetailForm from './LeadDetailForm';
import { generateSmartFollowupStory, getUpcomingMeetingWithLead } from '../services/api';

const LeadDetailModal = ({ 
  lead, 
  isOpen, 
  onClose, 
  onUpdate, 
  onDelete, 
  isUpdating = false 
}) => {
  const [isMounted, setIsMounted] = useState(false);
  const [storySoFar, setStorySoFar] = useState(null);
  const [storyGenerating, setStoryGenerating] = useState(false);
  const [storyError, setStoryError] = useState(null);
  const [upcomingMeeting, setUpcomingMeeting] = useState(null);
  const [upcomingMeetingLoading, setUpcomingMeetingLoading] = useState(false);
  const [upcomingMeetingError, setUpcomingMeetingError] = useState(null);

  // Fix hydration issues by only rendering on client side
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Reset story and meeting state when modal closes or lead changes
  useEffect(() => {
    if (!isOpen || !lead) {
      setStorySoFar(null);
      setStoryError(null);
      setUpcomingMeeting(null);
      setUpcomingMeetingError(null);
    }
  }, [isOpen, lead?.id]);

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

  // Treat "[AI Unavailable]..." fallback as "AI failed" - don't show raw technical message
  const isAiUnavailableFallback = (s) =>
    s && typeof s === 'string' && s.trim().toUpperCase().includes('[AI UNAVAILABLE]');
  const hasRealStory = storySoFar && storySoFar.trim() && !isAiUnavailableFallback(storySoFar);

  const notes = (lead?.notes || lead?.['Notes'] || '').trim();
  const hasNotes = notes.length > 0;

  const handleGenerateStory = async () => {
    if (!hasNotes) {
      setStoryError('There are no notes for this lead.');
      return;
    }
    const leadId = lead?.id || lead?.['Profile Key'];
    if (!leadId) return;

    setStoryError(null);
    setStoryGenerating(true);
    try {
      const result = await generateSmartFollowupStory(leadId);
      if (result.story) {
        setStorySoFar(result.story);
      } else {
        setStoryError(result.error === 'no_notes' || result.noNotes
          ? 'There are no notes for this lead.'
          : (result.error || 'Failed to generate story'));
      }
    } catch (err) {
      setStoryError(err.message || 'Failed to generate story');
    } finally {
      setStoryGenerating(false);
    }
  };

  const leadEmail = (lead?.email || lead?.['Email'] || '').trim();
  const hasEmail = leadEmail.length > 0;

  const handleCheckUpcomingMeeting = async () => {
    if (!hasEmail) {
      setUpcomingMeetingError('No email for this lead — cannot check calendar.');
      return;
    }
    setUpcomingMeetingError(null);
    setUpcomingMeeting(null);
    setUpcomingMeetingLoading(true);
    try {
      const result = await getUpcomingMeetingWithLead(leadEmail);
      if (result?.meeting) {
        setUpcomingMeeting({ summary: result.meeting.summary, displayDate: result.meeting.displayDate });
        setUpcomingMeetingError(null);
      } else {
        setUpcomingMeeting(null);
        setUpcomingMeetingError(result?.error ? `Error: ${result.error}` : 'no_meeting');
      }
    } catch (err) {
      setUpcomingMeeting(null);
      setUpcomingMeetingError(err.message || 'Failed to check calendar.');
    } finally {
      setUpcomingMeetingLoading(false);
    }
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
                {/* Contextual Help for Lead Detail */}
                <HelpButton area="lead_search_and_update_detail" title="Help for Lead Detail" />
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

          {/* Story so far - generated on demand */}
          <div className="px-6 pt-4 pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-medium text-blue-900 flex items-center gap-1.5">
                <span aria-hidden>📖</span> Story so far
              </h3>
              <button
                type="button"
                onClick={handleGenerateStory}
                disabled={storyGenerating}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {storyGenerating ? 'Generating…' : 'Generate story so far'}
              </button>
            </div>
            {storyError ? (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 border border-amber-200">
                {storyError}
              </p>
            ) : hasRealStory ? (
              <div className="text-sm text-gray-700 bg-blue-50/50 rounded-md px-3 py-2 border border-blue-100">
                {storySoFar}
              </div>
            ) : isAiUnavailableFallback(storySoFar) ? (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 border border-amber-200">
                Story generation failed — try again or run Rebuild in Smart Follow-ups.
              </p>
            ) : !storyGenerating ? (
              <p className="text-sm text-gray-500 italic">
                Click &quot;Generate story so far&quot; to create a summary from this lead&apos;s notes.
              </p>
            ) : null}
          </div>

          {/* Upcoming meeting - check calendar (may be slow) */}
          <div className="px-6 pt-4 pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-medium text-blue-900 flex items-center gap-1.5">
                <span aria-hidden>📅</span> Upcoming meeting
              </h3>
              <button
                type="button"
                onClick={handleCheckUpcomingMeeting}
                disabled={!hasEmail || upcomingMeetingLoading}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {upcomingMeetingLoading ? 'Checking…' : 'Check calendar'}
              </button>
            </div>
            {!hasEmail ? (
              <p className="text-sm text-gray-500 italic">Add an email to this lead to check your calendar.</p>
            ) : upcomingMeeting ? (
              <div className="text-sm text-green-900 bg-green-50 rounded-md px-3 py-2 border border-green-200">
                {upcomingMeeting.summary} – {upcomingMeeting.displayDate}
              </div>
            ) : upcomingMeetingError ? (
              <p className={`text-sm rounded-md px-3 py-2 border ${upcomingMeetingError === 'no_meeting' ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                {upcomingMeetingError === 'no_meeting' ? 'No upcoming meeting found in the next 90 days.' : upcomingMeetingError}
              </p>
            ) : !upcomingMeetingLoading ? (
              <p className="text-sm text-gray-500 italic">
                Click &quot;Check calendar&quot; to see if a meeting is booked (checks next 90 days).
              </p>
            ) : null}
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
                ceaseFup: lead.ceaseFup || lead['Cease FUP'] || '',
                notes: safeRender(lead.notes || lead['Notes']),
                lastMessageDate: safeRender(lead.lastMessageDate || lead['Last Message Date']),
                postsRelevancePercentage: lead.postsRelevancePercentage || lead['Posts Relevance Percentage'],
                searchTerms: safeRender(lead.searchTerms || lead['Search Terms']),
                searchTokensCanonical: safeRender(lead.searchTokensCanonical || lead['Search Tokens (canonical)']),
                source: safeRender(lead.source || lead['Source']),
                // Contact fields (previously omitted -> caused blank email/phone in form when using modal)
                email: safeRender(lead.email || lead['Email']),
                phone: safeRender(lead.phone || lead['Phone']),
                location: safeRender(lead.location || lead['Location']),
                rawProfileData: lead.rawProfileData || lead['Raw Profile Data'],
                
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
