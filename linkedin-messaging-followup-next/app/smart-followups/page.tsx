'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Layout from '../../components/Layout';
import { getSmartFollowupQueue, acknowledgeAiDate, generateFollowupMessage, updateLead, getLeadById, snoozeSmartFollowup } from '../../services/api';
import { getCurrentClientId, getClientProfile, getCurrentClientProfile } from '../../utils/clientUtils';

/**
 * Smart Follow-ups Page v2 - Rebuilt based on Smart Follow-Up Decisions doc
 * 
 * Key changes from v1:
 * - Single queue (no tabs)
 * - Queue logic: waiting_on=User OR (waiting_on=Lead AND date due) OR (activity but no date)
 * - Priority: High/Medium/Low (AI-derived or inferred)
 * - Email to me flow (sends draft to user)
 * - Simplified, cleaner UI
 */

// ============================================
// TYPES
// ============================================

interface QueueItem {
  // From Smart FUP State
  id: string;               // Smart FUP State record ID
  leadId: string;           // Leads table record ID
  leadEmail: string;
  leadFirstName: string;
  leadLastName: string;
  leadLinkedin: string;
  fathomTranscripts?: string;
  generatedTime: string;
  // Dates
  userFupDate: string | null;
  aiSuggestedDate: string | null;
  aiDateReasoning: string | null;
  effectiveDate: string | null;
  daysOverdue: number;
  // AI-generated content
  story: string;
  priority: 'High' | 'Medium' | 'Low';
  waitingOn: 'User' | 'Lead' | 'None';
  suggestedMessage: string;
  recommendedChannel: 'LinkedIn' | 'Email' | 'None';
  // Additional display data (fetched separately if needed)
  firstName?: string;
  lastName?: string;
  notes?: string;
  company?: string;
  title?: string;
  status?: string;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Determine why this lead is showing in the queue
 */
const getShowReason = (item: QueueItem): string => {
  if (item.waitingOn === 'User') {
    return 'They replied - you owe a response';
  }
  if (item.aiSuggestedDate && (!item.userFupDate || item.aiSuggestedDate < item.userFupDate)) {
    return 'AI detected earlier follow-up needed';
  }
  return 'Follow-up date reached';
};

/**
 * Format a date for display
 */
const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

const formatDateLong = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Get display name (first + last) or fallback to email
 */
const getDisplayName = (item: QueueItem): string => {
  const name = [item.leadFirstName, item.leadLastName].filter(Boolean).join(' ').trim();
  return name || item.leadEmail || item.leadId;
};

// ============================================
// MAIN COMPONENT
// ============================================

function SmartFollowupsContent() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: string; text: string } | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [leadNotes, setLeadNotes] = useState<string>('');
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarDate, setCalendarDate] = useState('');
  const [currentFupDate, setCurrentFupDate] = useState<string | null>(null);
  const [draftFupDate, setDraftFupDate] = useState<string | null>(null);
  const [isSavingFup, setIsSavingFup] = useState(false);
  
  const chatInputRef = useRef<HTMLInputElement>(null);
  const hasUnsavedFupChanges = currentFupDate !== draftFupDate;
  
  // Resolve client ID from: utils cache, profile, URL params, or retry
  const getClientFromSources = () => {
    if (typeof window === 'undefined') return null;
    const fromUtils = getCurrentClientId() || getClientProfile()?.client?.clientId;
    if (fromUtils) return fromUtils;
    const params = new URLSearchParams(window.location.search);
    return params.get('client') || params.get('clientId') || params.get('testClient') || null;
  };
  
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(() => getClientFromSources());
  
  const refreshClient = async () => {
    try {
      await getCurrentClientProfile();
      setResolvedClientId(getClientFromSources());
    } catch (e) {
      console.error('Failed to refresh client:', e);
    }
  };
  
  useEffect(() => {
    const id = getClientFromSources();
    if (id) {
      setResolvedClientId(id);
      return;
    }
    // Retry - Layout init can lag
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const id2 = getClientFromSources();
      if (id2) {
        setResolvedClientId(id2);
        clearInterval(interval);
      } else if (attempts >= 15) {
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);
  
  const effectiveClientId = resolvedClientId;
  const isOwner = effectiveClientId?.toLowerCase() === 'guy-wilson';

  // Load on mount
  useEffect(() => {
    if (isOwner) {
      loadQueue();
    }
  }, [isOwner]);

  // Auto-refresh on tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isOwner) {
        loadQueue();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOwner]);

  const loadQueue = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getSmartFollowupQueue();
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to load queue');
      }
      
      // Queue is already sorted by backend (Priority, then effectiveDate)
      setQueue(response.queue || []);
    } catch (err) {
      console.error('Failed to load Smart Follow-up queue:', err);
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setIsLoading(false);
    }
  };

  const selectItem = async (item: QueueItem) => {
    setSelectedItem(item);
    setGeneratedMessage(item.suggestedMessage || '');
    setChatHistory([]);
    setActionMessage(null);
    setLeadNotes('');
    setNotesExpanded(false);
    setShowCalendar(false);
    setCalendarDate('');
    setCurrentFupDate(null);
    setDraftFupDate(null);
    try {
      const lead = await getLeadById(item.leadId);
      setLeadNotes(lead?.notes || lead?.['Notes'] || '');
      const fup = lead?.followUpDate || lead?.['Follow-Up Date'] || null;
      const fupStr = fup ? (typeof fup === 'string' ? fup.split('T')[0] : fup) : null;
      setCurrentFupDate(fupStr);
      setDraftFupDate(fupStr);
    } catch {
      setLeadNotes('');
    }
  };

  const handleSelectLead = (item: QueueItem) => {
    if (item.id === selectedItem?.id) return;
    if (hasUnsavedFupChanges && !window.confirm('You have unsaved changes to the follow-up date. Discard?')) {
      return;
    }
    selectItem(item);
  };

  /**
   * Acknowledge the AI-suggested date (clears it)
   */
  const handleAcknowledgeAiDate = async () => {
    if (!selectedItem || !selectedItem.aiSuggestedDate) return;
    
    try {
      await acknowledgeAiDate(selectedItem.leadId);
      setActionMessage({ type: 'success', text: 'AI date acknowledged and cleared' });
      
      // Update local state to reflect the change
      setSelectedItem(prev => prev ? { ...prev, aiSuggestedDate: null, aiDateReasoning: null } : null);
      
      // Refresh the queue
      loadQueue();
    } catch (err) {
      console.error('Failed to acknowledge AI date:', err);
      setActionMessage({ type: 'error', text: 'Failed to acknowledge AI date' });
    }
  };

  const handleGenerateMessage = async (refinement: string | null = null) => {
    if (!selectedItem) return;
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(selectedItem.leadId, {
        ...(refinement ? { refinement } : {}),
        context: {
          story: selectedItem.story,
          waitingOn: selectedItem.waitingOn,
          priority: selectedItem.priority,
          name: getDisplayName(selectedItem),
          notes: leadNotes,
          fathomTranscripts: selectedItem.fathomTranscripts
        }
      });
      setGeneratedMessage(result.message);
      
      if (refinement) {
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: refinement },
          { role: 'assistant', content: 'Updated the message based on your feedback.' }
        ]);
      }
    } catch (err) {
      console.error('Failed to generate message:', err);
      const firstName = selectedItem.firstName || 'there';
      const fallbackMessage = `Hi ${firstName},\n\nI wanted to follow up on our previous conversation. Would you have time for a quick chat this week?\n\nLooking forward to hearing from you.`;
      setGeneratedMessage(fallbackMessage);
      setChatHistory(prev => [
        ...prev,
        { role: 'assistant', content: '(AI unavailable - using template message. You can edit it manually.)' }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Email to me - sends draft to user (Decision 1)
   */
  const handleEmailToMe = async () => {
    if (!selectedItem || !generatedMessage) {
      setActionMessage({ type: 'error', text: 'Generate a message first.' });
      return;
    }
    
    setEmailSending(true);
    try {
      // TODO: Implement API call to send email draft to user
      // For now, show placeholder message
      setActionMessage({ 
        type: 'success', 
        text: `Email draft would be sent to you with message for ${selectedItem.firstName || 'lead'}. (Not yet implemented)` 
      });
    } catch (err) {
      console.error('Failed to send email:', err);
      setActionMessage({ type: 'error', text: 'Failed to send email draft.' });
    } finally {
      setEmailSending(false);
    }
  };

  const handleCeaseFollowup = async () => {
    if (!selectedItem) return;
    
    try {
      await updateLead(selectedItem.leadId, { 
        'Follow-Up Date': null,
        'Cease FUP': 'Yes'
      });
      
      setActionMessage({ type: 'success', text: 'No follow-up. Lead removed from queue.' });
      moveToNextItem();
      loadQueue();
    } catch (err) {
      console.error('Failed to cease follow-up:', err);
      setActionMessage({ type: 'error', text: 'Failed to update lead.' });
    }
  };

  const updateDraftFup = (days: number) => {
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + days);
    setDraftFupDate(newDate.toISOString().split('T')[0]);
  };

  const applyCalendarDate = () => {
    if (calendarDate) {
      setDraftFupDate(calendarDate);
      setShowCalendar(false);
      setCalendarDate('');
    }
  };

  const handleSaveFupDate = async () => {
    if (!selectedItem || !draftFupDate || draftFupDate === currentFupDate) return;
    
    setIsSavingFup(true);
    try {
      await snoozeSmartFollowup(selectedItem.leadId, draftFupDate);
      setCurrentFupDate(draftFupDate);
      setActionMessage({ type: 'success', text: `Follow-up date saved: ${formatDateLong(draftFupDate)}` });
      await loadQueue();
      const today = new Date().toISOString().split('T')[0];
      if (draftFupDate > today) {
        moveToNextItem();
      }
    } catch (err) {
      console.error('Failed to save follow-up date:', err);
      setActionMessage({ type: 'error', text: 'Failed to update follow-up date.' });
    } finally {
      setIsSavingFup(false);
    }
  };

  const moveToNextItem = () => {
    if (!selectedItem) return;
    const currentIndex = queue.findIndex(q => q.id === selectedItem.id);
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      selectItem(queue[currentIndex + 1]);
    } else if (currentIndex < 0 && queue.length > 0) {
      selectItem(queue[0]);
    } else {
      setSelectedItem(null);
    }
  };

  const handleSkipToNext = () => {
    if (hasUnsavedFupChanges && !window.confirm('You have unsaved changes to the follow-up date. Discard?')) {
      return;
    }
    moveToNextItem();
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating || !selectedItem) return;
    
    const input = chatInput.trim();
    setChatInput('');
    
    // Handle special commands
    if (input.toLowerCase().includes('set follow-up') || input.toLowerCase().includes('set followup')) {
      handleSetFollowupFromChat(input);
      return;
    }
    if (input.toLowerCase().includes('list nudge')) {
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: input },
        { role: 'assistant', content: 'Nudges feature coming soon. This will list available nudges from your library.' }
      ]);
      return;
    }
    
    // Free-form Q&A - send to AI with full lead context
    setChatHistory(prev => [...prev, { role: 'user', content: input }]);
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(selectedItem.leadId, {
        query: input,
        context: {
          story: selectedItem.story,
          notes: leadNotes,
          fathomTranscripts: selectedItem.fathomTranscripts,
          name: getDisplayName(selectedItem),
          suggestedMessage: generatedMessage || selectedItem.suggestedMessage || ''
        }
      });
      const answer = (result as { answer?: string }).answer || (result as { message?: string }).message || 'No response.';
      const isRefinedMessage = (result as { isRefinedMessage?: boolean }).isRefinedMessage;
      setChatHistory(prev => [...prev, { role: 'assistant', content: answer }]);
      if (isRefinedMessage && answer) {
        setGeneratedMessage(answer);
      }
    } catch (err) {
      console.error('Chat Q&A error:', err);
      setChatHistory(prev => [
        ...prev,
        { role: 'assistant', content: `Failed to get answer: ${err instanceof Error ? err.message : 'Unknown error'}` }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSetFollowupFromChat = async (message: string) => {
    if (!selectedItem) return;
    
    const dateMatch = message.match(/(\d+)\s*(day|week|month)s?/i);
    if (dateMatch) {
      const amount = parseInt(dateMatch[1]);
      const unit = dateMatch[2].toLowerCase();
      const date = new Date();
      
      if (unit === 'day') date.setDate(date.getDate() + amount);
      else if (unit === 'week') date.setDate(date.getDate() + (amount * 7));
      else if (unit === 'month') date.setMonth(date.getMonth() + amount);
      
      const formattedDate = date.toISOString().split('T')[0];
      
      try {
        await updateLead(selectedItem.leadId, { 'Follow-Up Date': formattedDate });
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Done! Follow-up date set to ${formattedDate}` }
        ]);
        loadQueue();
      } catch (err) {
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        ]);
      }
    } else {
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: 'Try "set follow-up to 2 weeks" or "set follow-up to 1 month"' }
      ]);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(generatedMessage);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getPriorityBadge = (priority: 'High' | 'Medium' | 'Low') => {
    switch (priority) {
      case 'High':
        return { text: 'High', bgColor: 'bg-red-100', textColor: 'text-red-700' };
      case 'Medium':
        return { text: 'Medium', bgColor: 'bg-amber-100', textColor: 'text-amber-700' };
      case 'Low':
        return { text: 'Low', bgColor: 'bg-gray-100', textColor: 'text-gray-600' };
    }
  };

  // Access control
  if (!effectiveClientId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500 mb-4">Checking access...</p>
            <p className="text-sm text-gray-400 mb-4">Ensure you logged in with your portal link (contains ?token=...)</p>
            <button
              onClick={refreshClient}
              className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg"
            >
              Retry
            </button>
          </div>
        </div>
      </Layout>
    );
  }
  if (!isOwner) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-500">This feature is only available to the account owner.</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-gray-900">🎯 Smart Follow-ups</h1>
            <span className="text-sm text-gray-500">
              {queue.length} lead{queue.length !== 1 ? 's' : ''} need attention
            </span>
          </div>
          
          <button
            onClick={loadQueue}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? '...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Content */}
        <div className="flex h-full" style={{ height: 'calc(100% - 65px)' }}>
          {/* Left panel - Lead list (narrow: widest name + padding) */}
          <div className="w-52 shrink-0 border-r border-gray-200 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : error ? (
              <div className="p-4 text-red-600">{error}</div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <div className="text-4xl mb-3">🎉</div>
                <p className="font-medium">All caught up!</p>
                <p className="text-sm mt-1">No follow-ups need attention right now.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {queue.map((item, index) => {
                  const badge = getPriorityBadge(item.priority);
                  const showReason = getShowReason(item);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectLead(item)}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedItem?.id === item.id
                          ? 'bg-blue-50 border-l-4 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
                        <h3 className="font-medium text-gray-900 truncate text-sm">
                          {getDisplayName(item)}
                        </h3>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.bgColor} ${badge.textColor}`}>
                          {badge.text}
                        </span>
                        {item.waitingOn === 'User' && (
                          <span className="text-xs text-orange-600 font-medium">💬 They replied</span>
                        )}
                        {item.aiSuggestedDate && (
                          <span className="text-xs text-purple-600 font-medium">🤖 AI: {formatDate(item.aiSuggestedDate)}</span>
                        )}
                        {item.daysOverdue > 0 && (
                          <span className="text-xs text-gray-500">{item.daysOverdue}d overdue</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{showReason}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel - Lead details & actions */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedItem ? (
              <>
                {/* Lead header - compact: name, story/status, snooze in one row */}
                <div className="px-4 py-3 border-b border-gray-200 bg-white">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {getDisplayName(selectedItem)}
                    </h2>
                    <span className="text-sm text-gray-500">
                      Channel: {selectedItem.recommendedChannel}
                    </span>
                    <span className={`text-sm font-medium ${selectedItem.waitingOn === 'User' ? 'text-orange-600' : 'text-blue-600'}`}>
                      {selectedItem.waitingOn === 'User' 
                        ? '💬 They replied' 
                        : selectedItem.waitingOn === 'Lead'
                        ? '⏳ Waiting on them'
                        : '📋 Follow-up due'}
                    </span>
                    <span className="text-xs font-medium">{hasUnsavedFupChanges ? 'FUP date (unsaved):' : 'Current FUP:'} {draftFupDate ? formatDateLong(draftFupDate) : 'Not set'}</span>
                    {selectedItem.aiSuggestedDate && (
                      <span className="text-xs text-purple-600">AI: {formatDate(selectedItem.aiSuggestedDate)}</span>
                    )}
                    <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                      <span className="text-xs text-gray-500">Set FUP:</span>
                      <button onClick={() => updateDraftFup(7)} className="px-2 py-0.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded">+1w</button>
                      <button onClick={() => updateDraftFup(14)} className="px-2 py-0.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded">+2w</button>
                      <button onClick={() => updateDraftFup(30)} className="px-2 py-0.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded">+1m</button>
                      {showCalendar ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="date"
                            value={calendarDate}
                            min={new Date().toISOString().split('T')[0]}
                            onChange={(e) => setCalendarDate(e.target.value)}
                            className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
                          />
                          <button onClick={applyCalendarDate} className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded">Set</button>
                          <button onClick={() => { setShowCalendar(false); setCalendarDate(''); }} className="text-gray-500 hover:text-gray-700 text-xs">✕</button>
                        </span>
                      ) : (
                        <button onClick={() => setShowCalendar(true)} className="px-2 py-0.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded" title="Pick a date">📅</button>
                      )}
                      {hasUnsavedFupChanges && (
                        <button onClick={handleSaveFupDate} disabled={isSavingFup} className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded ml-1 disabled:opacity-50">Save</button>
                      )}
                      <button onClick={handleCeaseFollowup} className="px-2 py-0.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded ml-1">⏹ No follow-up</button>
                    </div>
                    {selectedItem.leadLinkedin && (
                      <a
                        href={selectedItem.leadLinkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        🔗 LinkedIn
                      </a>
                    )}
                  </div>
                  {actionMessage && (
                    <div className={`mt-2 text-sm px-3 py-1.5 rounded-lg ${
                      actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {actionMessage.text}
                    </div>
                  )}
                </div>

                {/* Main content: Chat (big) + Story, Suggested Message below */}
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Chat - main feature: big window + input (takes most vertical space) */}
                  <div className="flex-[2] flex flex-col min-h-0 border-b border-gray-200">
                    <div className="flex-1 min-h-[200px] overflow-y-auto p-4 space-y-2 bg-gray-50/50">
                      {chatHistory.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4">
                          Ask anything about this lead – e.g. &quot;What did we discuss last time?&quot;, &quot;Prepare talking points for this call&quot;, &quot;Any follow-up Zoom booked?&quot;
                        </p>
                      ) : (
                        chatHistory.map((msg, i) => (
                          <div key={i} className={`text-sm p-3 rounded-lg max-w-[85%] ${msg.role === 'user' ? 'bg-blue-100 text-blue-800 ml-auto' : 'bg-white border border-gray-200 text-gray-800'}`}>
                            {msg.content}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="p-3 border-t border-gray-200 bg-white shrink-0">
                      <form onSubmit={handleChatSubmit} className="flex gap-2">
                        <input
                          ref={chatInputRef}
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Ask anything, e.g. 'What did we discuss?' or 'set follow-up to 2 weeks'..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                          disabled={isGenerating}
                        />
                        <button
                          type="submit"
                          disabled={isGenerating || !chatInput.trim()}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                        >
                          Send
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Scrollable: Story, AI Date, Suggested Message */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                    <div className="bg-blue-50 rounded-lg border border-blue-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setNotesExpanded(prev => !prev)}
                        className="w-full px-4 py-2 flex items-center justify-between hover:bg-blue-100/50 transition-colors"
                      >
                        <h3 className="font-medium text-blue-900 text-sm">📖 Story so far &amp; notes</h3>
                        <span className="text-blue-600 text-xs">{notesExpanded ? '▼' : '▶'}</span>
                      </button>
                      {notesExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-blue-200/50 pt-3">
                          <div>
                            <h4 className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-1">Story so far</h4>
                            <p className="text-sm text-blue-800">{selectedItem.story || 'No story generated yet.'}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-1">Full notes</h4>
                            <div className="text-sm text-blue-800 whitespace-pre-wrap bg-white/60 rounded p-3 max-h-48 overflow-y-auto">
                              {leadNotes || 'No notes.'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {selectedItem.aiSuggestedDate && (
                      <div className="bg-purple-50 rounded-lg border border-purple-200 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-medium text-purple-900 text-sm">🤖 AI Suggested Date: {formatDate(selectedItem.aiSuggestedDate)}</h3>
                            {selectedItem.aiDateReasoning && (
                              <p className="text-xs text-purple-700 mt-1">{selectedItem.aiDateReasoning}</p>
                            )}
                          </div>
                          <button
                            onClick={handleAcknowledgeAiDate}
                            className="px-2 py-1 text-xs font-medium text-purple-600 bg-white border border-purple-300 hover:bg-purple-100 rounded shrink-0"
                          >
                            ✓ Acknowledge
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="bg-gray-50 rounded-lg border border-gray-200">
                      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                        <h3 className="font-medium text-gray-900 text-sm">✨ Suggested Message</h3>
                        {!generatedMessage && (
                          <button
                            onClick={() => handleGenerateMessage()}
                            disabled={isGenerating}
                            className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50"
                          >
                            {isGenerating ? '...' : 'Generate'}
                          </button>
                        )}
                      </div>
                      <div className="p-4">
                        {isGenerating && !generatedMessage ? (
                          <div className="flex items-center justify-center h-16">
                            <div className="flex items-center gap-2 text-gray-500 text-sm">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                              <span>Generating...</span>
                            </div>
                          </div>
                        ) : generatedMessage ? (
                          <>
                            <div className="bg-white rounded-lg p-3 border border-gray-200 whitespace-pre-wrap text-gray-800 text-sm">
                              {generatedMessage}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                onClick={handleCopyMessage}
                                className={`px-2 py-1 text-xs font-medium rounded ${copySuccess ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                              >
                                {copySuccess ? '✓ Copied!' : '📋 Copy'}
                              </button>
                              <button
                                onClick={handleEmailToMe}
                                disabled={emailSending}
                                className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded disabled:opacity-50"
                              >
                                {emailSending ? '...' : '📧 Email to me'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500 italic py-2">
                            Click &quot;Generate&quot; for a suggested LinkedIn message (optional)
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={handleSkipToNext}
                        disabled={queue.findIndex(q => q.id === selectedItem.id) >= queue.length - 1}
                        className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                      >
                        Skip to next →
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <div className="text-5xl mb-4">👈</div>
                  <p className="text-lg">Select a lead to get started</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function SmartFollowupsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading Smart Follow-ups...</div>
      </div>
    }>
      <SmartFollowupsContent />
    </Suspense>
  );
}
