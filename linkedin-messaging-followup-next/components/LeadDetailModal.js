import React, { useState, useEffect } from 'react';
import HelpButton from './HelpButton';
import LeadDetailForm from './LeadDetailForm';
import { generateSmartFollowupStory, getUpcomingMeetingWithLead } from '../services/api';
import KrispTranscriptsPanel from './KrispTranscriptsPanel';

const LeadDetailModal = ({ 
  lead, 
  isOpen, 
  onClose, 
  onUpdate, 
  onDelete, 
  isUpdating = false 
}) => {
  const [isMounted, setIsMounted] = useState(false);
  const [brief, setBrief] = useState(null);
  const [storyGenerating, setStoryGenerating] = useState(false);
  const [storyError, setStoryError] = useState(null);
  const [upcomingMeeting, setUpcomingMeeting] = useState(null);
  const [upcomingMeetingLoading, setUpcomingMeetingLoading] = useState(false);
  const [upcomingMeetingError, setUpcomingMeetingError] = useState(null);
  // Fix hydration issues by only rendering on client side
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Reset brief and meeting state when modal closes or lead changes
  useEffect(() => {
    if (!isOpen || !lead) {
      setBrief(null);
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
  const hasRealBrief = brief?.story && brief.story.trim() && !isAiUnavailableFallback(brief.story);

  // Render bullet text with each line on its own row.
  // AI sometimes separates bullets with \n, sometimes just runs them inline with •.
  // We handle both: split on \n first, then fall back to splitting on • if still one block.
  const renderLines = (text) => {
    if (!text) return null;
    let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Fallback: if no newlines but multiple bullets exist, split on the bullet char
    if (lines.length <= 1 && text.includes('•')) {
      lines = text
        .split('•')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => `• ${l}`);
    }
    if (lines.length <= 1) return <p className="text-sm text-gray-800 leading-relaxed">{text}</p>;
    return (
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-gray-800 leading-relaxed">{line}</p>
        ))}
      </div>
    );
  };

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
    setBrief(null);
    setStoryGenerating(true);

    // Auto-check calendar at the same time if we have an email
    if (hasEmail && !upcomingMeeting) {
      setUpcomingMeetingLoading(true);
      setUpcomingMeetingError(null);
      getUpcomingMeetingWithLead(leadEmail).then(result => {
        if (result?.meeting) {
          setUpcomingMeeting({ summary: result.meeting.summary, displayDate: result.meeting.displayDate });
        }
      }).catch(() => {}).finally(() => setUpcomingMeetingLoading(false));
    }

    try {
      const result = await generateSmartFollowupStory(leadId);
      if (result.story) {
        setBrief(result);
      } else {
        setStoryError(result.error === 'no_notes' || result.noNotes
          ? 'There are no notes for this lead.'
          : (result.error || 'Failed to generate brief'));
      }
    } catch (err) {
      setStoryError(err.message || 'Failed to generate brief');
    } finally {
      setStoryGenerating(false);
    }
  };

  const leadEmail = (lead?.email || lead?.['Email'] || '').trim();
  const hasEmail = leadEmail.length > 0;

  const scrollToKrisp = () => {
    document.getElementById('lead-detail-krisp-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
                <button
                  type="button"
                  onClick={scrollToKrisp}
                  className="mt-2 text-xs font-medium text-violet-700 hover:text-violet-900 hover:underline"
                >
                  Krisp transcripts ↓
                </button>
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

          {/* Content - Pre-meeting brief, Upcoming meeting, then form */}
          <div className="px-6 py-6 space-y-6">
            {/* Pre-Meeting Brief */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b border-gray-200 pb-2">
                <h4 className="text-lg font-semibold text-gray-900">📋 Pre-Meeting Brief</h4>
                <button
                  type="button"
                  onClick={handleGenerateStory}
                  disabled={storyGenerating}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {storyGenerating ? 'Generating…' : hasRealBrief ? 'Regenerate' : 'Generate brief'}
                </button>
                {hasRealBrief && brief?.hasFathomTranscript && (
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    ✓ Includes Fathom transcript
                  </span>
                )}
                {hasRealBrief && !brief?.hasFathomTranscript && (
                  <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                    Notes only — no Fathom transcript found
                  </span>
                )}
              </div>

              {/* Meeting banner — shown as soon as a meeting is detected */}
              {(upcomingMeeting || upcomingMeetingLoading) && (
                <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${upcomingMeetingLoading ? 'bg-gray-50 border-gray-200' : 'bg-emerald-50 border-emerald-300'}`}>
                  <span className="text-lg">📅</span>
                  {upcomingMeetingLoading ? (
                    <span className="text-sm text-gray-500">Checking calendar…</span>
                  ) : (
                    <div>
                      <span className="text-sm font-semibold text-emerald-800">Meeting booked: </span>
                      <span className="text-sm text-emerald-900">{upcomingMeeting.summary} — {upcomingMeeting.displayDate}</span>
                    </div>
                  )}
                </div>
              )}

              {storyError ? (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 border border-amber-200">
                  {storyError}
                </p>
              ) : isAiUnavailableFallback(brief?.story) ? (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 border border-amber-200">
                  Brief generation failed — please try again.
                </p>
              ) : hasRealBrief ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Story so far */}
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 md:col-span-2">
                    <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">📖 Story so far</div>
                    <p className="text-sm text-gray-800 leading-relaxed">{brief.story}</p>
                  </div>

                  {/* Penny drops */}
                  {brief.pennyDrops && (
                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4">
                      <div className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2">💡 Penny drop moments</div>
                      {renderLines(brief.pennyDrops)}
                    </div>
                  )}

                  {/* Push on */}
                  {brief.pushOn && (
                    <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
                      <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">🎯 What to push on</div>
                      {renderLines(brief.pushOn)}
                    </div>
                  )}

                  {/* Links sent */}
                  {brief.linksSent && (
                    <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
                      <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">🔗 Links already sent</div>
                      {renderLines(brief.linksSent)}
                    </div>
                  )}

                  {/* Pre-call reminder */}
                  {brief.preCallReminder && (
                    <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                      <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">☀️ Send the morning before</div>
                      <p className="text-sm text-gray-800 leading-relaxed">{brief.preCallReminder}</p>
                    </div>
                  )}

                  {/* Meeting opener */}
                  {brief.meetingOpener && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                      <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">🎤 How to open the meeting</div>
                      <p className="text-sm text-gray-800 leading-relaxed italic">&ldquo;{brief.meetingOpener}&rdquo;</p>
                    </div>
                  )}

                  {/* Suggested follow-up message */}
                  {brief.suggestedMessage && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 md:col-span-2">
                      <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">✉️ Suggested post-meeting message</div>
                      <p className="text-sm text-gray-800 leading-relaxed italic">&ldquo;{brief.suggestedMessage}&rdquo;</p>
                    </div>
                  )}
                </div>
              ) : !storyGenerating ? (
                <p className="text-sm text-gray-500 italic">
                  Click &quot;Generate brief&quot; to get a pre-meeting summary — includes your Fathom transcript if one exists.
                </p>
              ) : null}
            </div>

            <KrispTranscriptsPanel
              leadId={lead.id || lead['Profile Key']}
              wrapperId="lead-detail-krisp-panel"
            />

            {/* Upcoming meeting — manual check (auto-runs when brief is generated) */}
            {!upcomingMeeting && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">📅 No meeting detected yet.</span>
                <button
                  type="button"
                  onClick={handleCheckUpcomingMeeting}
                  disabled={!hasEmail || upcomingMeetingLoading}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {upcomingMeetingLoading ? 'Checking…' : 'Check calendar'}
                </button>
                {!hasEmail && (
                  <span className="text-xs text-gray-400">(add an email to this lead first)</span>
                )}
                {upcomingMeetingError && upcomingMeetingError !== 'no_meeting' && (
                  <span className="text-xs text-amber-700">{upcomingMeetingError}</span>
                )}
              </div>
            )}

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
