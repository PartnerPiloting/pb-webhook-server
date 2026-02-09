'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Layout from '../../components/Layout';
import { getFollowUps, generateFollowupMessage, updateLead } from '../../services/api';
import { getCurrentClientId } from '../../utils/clientUtils';

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

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  linkedinProfileUrl: string;
  email: string;
  followUpDate: string;
  notes: string;
  linkedinMessages: string;
  aiScore: string | number;
  status: string;
  company: string;
  title: string;
  // Derived fields
  waitingOn: 'User' | 'Lead' | 'None';
  priority: 'High' | 'Medium' | 'Low';
  daysOverdue: number;
  daysSinceLastMessage: number | null;
  story: string;
  showReason: string;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Parse notes to determine who sent the last message
 */
const parseWaitingOn = (notes: string, leadFirstName: string): { waitingOn: 'User' | 'Lead' | 'None'; daysSinceLastMessage: number | null } => {
  if (!notes) return { waitingOn: 'None', daysSinceLastMessage: null };
  
  const linkedinSection = notes.match(/=== LINKEDIN MESSAGES ===[\s\S]*?(?====|$)/i);
  const textToParse = linkedinSection ? linkedinSection[0] : notes;
  
  // Match message format: DD-MM-YY H:MM AM/PM - Sender Name - Message
  const messagePattern = /(\d{1,2}-\d{1,2}-\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*([^-]+)\s*-/gi;
  const matches = [...textToParse.matchAll(messagePattern)];
  
  if (matches.length === 0) return { waitingOn: 'None', daysSinceLastMessage: null };
  
  const today = new Date();
  let latestDate: Date | null = null;
  let latestSender = '';
  
  for (const match of matches) {
    const [, dateStr, , sender] = match;
    const dateParts = dateStr.split('-');
    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]) - 1;
      let year = parseInt(dateParts[2]);
      if (year < 100) year += 2000;
      
      const msgDate = new Date(year, month, day);
      if (msgDate > today) continue;
      
      if (!latestDate || msgDate > latestDate) {
        latestDate = msgDate;
        latestSender = sender.trim();
      }
    }
  }
  
  if (!latestDate) return { waitingOn: 'None', daysSinceLastMessage: null };
  
  const daysSinceLastMessage = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Check if user sent the last message
  const userSentLast = latestSender.toLowerCase().includes('guy') || 
                       latestSender.toLowerCase().includes('wilson') ||
                       !latestSender.toLowerCase().includes(leadFirstName.toLowerCase());
  
  return {
    waitingOn: userSentLast ? 'Lead' : 'User',
    daysSinceLastMessage
  };
};

/**
 * Determine priority based on conversation state
 * Priority order (per Decision 9):
 * - Highest: waiting_on=User (they replied, you owe response)
 * - High: Had meeting then silence / Agreed to meet then went quiet
 * - Medium: You reached out, generic silence
 * - Low: Cold lead, no real engagement
 */
const determinePriority = (
  waitingOn: 'User' | 'Lead' | 'None',
  daysSinceLastMessage: number | null,
  daysOverdue: number,
  notes: string
): 'High' | 'Medium' | 'Low' => {
  // Highest priority: They replied, you need to respond
  if (waitingOn === 'User') {
    return 'High';
  }
  
  // Check for engagement signals in notes
  const notesLower = notes.toLowerCase();
  const hasMetOrAgreed = notesLower.includes('meeting') || 
                         notesLower.includes('zoom') || 
                         notesLower.includes('call') ||
                         notesLower.includes('agreed') ||
                         notesLower.includes('catch up');
  
  if (waitingOn === 'Lead') {
    // They went quiet after engagement
    if (hasMetOrAgreed && daysSinceLastMessage !== null && daysSinceLastMessage >= 7) {
      return 'High';
    }
    // Generic silence after your message
    if (daysSinceLastMessage !== null && daysSinceLastMessage >= 14) {
      return 'Medium';
    }
    return 'Medium';
  }
  
  // No active thread
  if (daysOverdue > 14) {
    return 'Medium';
  }
  
  return 'Low';
};

/**
 * Generate a brief story from notes (placeholder until AI cache is populated)
 */
const generateStory = (notes: string, waitingOn: 'User' | 'Lead' | 'None', daysSinceLastMessage: number | null): string => {
  if (!notes) return 'No conversation history yet.';
  
  const lines = notes.split('\n').filter(l => l.trim());
  const lastFewLines = lines.slice(-3).join(' ').substring(0, 150);
  
  if (waitingOn === 'User') {
    return `They replied ${daysSinceLastMessage ?? '?'} days ago - you owe a response. ${lastFewLines}...`;
  }
  if (waitingOn === 'Lead') {
    return `You messaged ${daysSinceLastMessage ?? '?'} days ago - waiting on them. ${lastFewLines}...`;
  }
  return `Last activity: ${lastFewLines}...`;
};

/**
 * Determine why this lead is showing in the queue
 */
const getShowReason = (
  waitingOn: 'User' | 'Lead' | 'None',
  followUpDate: string,
  daysSinceLastMessage: number | null
): string => {
  const today = new Date();
  const fupDate = followUpDate ? new Date(followUpDate) : null;
  const isOverdue = fupDate && fupDate <= today;
  
  if (waitingOn === 'User') {
    return 'They replied - you owe a response';
  }
  if (waitingOn === 'Lead' && isOverdue) {
    return 'Follow-up date reached';
  }
  if (!followUpDate && daysSinceLastMessage !== null) {
    return 'Recent activity but no follow-up date set';
  }
  return 'Due for follow-up';
};

// ============================================
// MAIN COMPONENT
// ============================================

function SmartFollowupsContent() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: string; text: string } | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  
  const chatInputRef = useRef<HTMLInputElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  
  const isOwner = getCurrentClientId() === 'Guy-Wilson';

  // Auto-scroll to analysis
  useEffect(() => {
    if (analysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [analysis]);

  // Load on mount
  useEffect(() => {
    if (isOwner) {
      loadFollowups();
    }
  }, [isOwner]);

  // Auto-refresh on tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isOwner) {
        loadFollowups();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOwner]);

  const loadFollowups = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rawLeads = await getFollowUps();
      const today = new Date();
      
      const enrichedLeads: Lead[] = rawLeads.map((lead: Record<string, unknown>) => {
        const firstName = String(lead['First Name'] || lead.firstName || '');
        const notes = String(lead['Notes'] || lead.notes || '');
        const followUpDate = String(lead['Follow-Up Date'] || lead.followUpDate || '');
        
        // Determine waiting_on from notes
        const { waitingOn, daysSinceLastMessage } = parseWaitingOn(notes, firstName);
        
        // Calculate days overdue
        let daysOverdue = 0;
        if (followUpDate) {
          const fupDate = new Date(followUpDate);
          daysOverdue = Math.max(0, Math.floor((today.getTime() - fupDate.getTime()) / (1000 * 60 * 60 * 24)));
        }
        
        // Determine priority
        const priority = determinePriority(waitingOn, daysSinceLastMessage, daysOverdue, notes);
        
        // Generate story (placeholder)
        const story = generateStory(notes, waitingOn, daysSinceLastMessage);
        
        // Why is this lead showing?
        const showReason = getShowReason(waitingOn, followUpDate, daysSinceLastMessage);
        
        return {
          id: String(lead['Profile Key'] || lead.id || ''),
          firstName,
          lastName: String(lead['Last Name'] || lead.lastName || ''),
          linkedinProfileUrl: String(lead['LinkedIn Profile URL'] || lead.linkedinProfileUrl || ''),
          email: String(lead['Email'] || lead.email || ''),
          followUpDate,
          notes,
          linkedinMessages: String(lead['LinkedIn Messages'] || lead.linkedinMessages || ''),
          aiScore: lead['AI Score'] || lead.aiScore || '',
          status: String(lead['Status'] || lead.status || ''),
          company: String(lead['Company Name'] || lead.company || ''),
          title: String(lead['Job Title'] || lead.title || ''),
          waitingOn,
          priority,
          daysOverdue,
          daysSinceLastMessage,
          story,
          showReason
        };
      });
      
      // Filter: Show leads that meet our criteria (Decision 8)
      const filtered = enrichedLeads.filter(lead => {
        // 1. waiting_on = User - show regardless of date
        if (lead.waitingOn === 'User') return true;
        
        // 2. waiting_on = Lead AND Follow-Up Date <= today
        if (lead.waitingOn === 'Lead' && lead.followUpDate) {
          const fupDate = new Date(lead.followUpDate);
          if (fupDate <= today) return true;
        }
        
        // 3. Recent activity but no Follow-Up Date
        if (!lead.followUpDate && lead.daysSinceLastMessage !== null && lead.daysSinceLastMessage <= 30) {
          return true;
        }
        
        // 4. Has a follow-up date that's due
        if (lead.followUpDate) {
          const fupDate = new Date(lead.followUpDate);
          if (fupDate <= today) return true;
        }
        
        return false;
      });
      
      // Sort by priority (High first), then by days overdue
      const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
      filtered.sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return b.daysOverdue - a.daysOverdue;
      });
      
      setLeads(filtered);
    } catch (err) {
      console.error('Failed to load follow-ups:', err);
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setIsLoading(false);
    }
  };

  const selectLead = (lead: Lead) => {
    setSelectedLead(lead);
    setGeneratedMessage('');
    setChatHistory([]);
    setAnalysis(null);
    setActionMessage(null);
  };

  const handleGenerateMessage = async (refinement: string | null = null) => {
    if (!selectedLead) return;
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(selectedLead.id, {
        ...(refinement ? { refinement } : {}),
        context: {
          notes: selectedLead.notes,
          linkedinMessages: selectedLead.linkedinMessages,
          score: selectedLead.aiScore,
          status: selectedLead.status,
          name: `${selectedLead.firstName} ${selectedLead.lastName}`.trim()
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
      const firstName = selectedLead.firstName || 'there';
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

  const handleAnalyzeLead = async () => {
    if (!selectedLead) return;
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(selectedLead.id, {
        analyzeOnly: true,
        context: {
          notes: selectedLead.notes,
          linkedinMessages: selectedLead.linkedinMessages,
          score: selectedLead.aiScore,
          status: selectedLead.status,
          name: `${selectedLead.firstName} ${selectedLead.lastName}`.trim(),
          followUpDate: selectedLead.followUpDate
        }
      });
      setAnalysis(result.analysis);
    } catch (err) {
      console.error('Failed to analyze lead:', err);
      setAnalysis(`Unable to analyze automatically.\n\n• Priority: ${selectedLead.priority}\n• Waiting on: ${selectedLead.waitingOn}\n• Days overdue: ${selectedLead.daysOverdue}\n• Reason showing: ${selectedLead.showReason}`);
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Email to me - sends draft to user (Decision 1)
   */
  const handleEmailToMe = async () => {
    if (!selectedLead || !generatedMessage) {
      setActionMessage({ type: 'error', text: 'Generate a message first.' });
      return;
    }
    
    setEmailSending(true);
    try {
      // TODO: Implement API call to send email draft to user
      // For now, show placeholder message
      setActionMessage({ 
        type: 'success', 
        text: `Email draft would be sent to you with message for ${selectedLead.firstName}. (Not yet implemented)` 
      });
    } catch (err) {
      console.error('Failed to send email:', err);
      setActionMessage({ type: 'error', text: 'Failed to send email draft.' });
    } finally {
      setEmailSending(false);
    }
  };

  const handleCeaseFollowup = async () => {
    if (!selectedLead) return;
    
    try {
      const existingNotes = selectedLead.notes || '';
      const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
      const ceaseNote = `\n\n## MANUAL\n#moving-on - Ceased follow-up\n[${dateStr}]`;
      
      await updateLead(selectedLead.id, { 
        'Follow-Up Date': null,
        'Cease FUP': 'Yes',
        'Notes': existingNotes + ceaseNote
      });
      
      setActionMessage({ type: 'success', text: 'Follow-up ceased. Lead removed from queue.' });
      moveToNextLead();
      loadFollowups();
    } catch (err) {
      console.error('Failed to cease follow-up:', err);
      setActionMessage({ type: 'error', text: 'Failed to update lead.' });
    }
  };

  const handleSnooze = async (days: number) => {
    if (!selectedLead) return;
    
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + days);
    const formattedDate = newDate.toISOString().split('T')[0];
    
    try {
      await updateLead(selectedLead.id, { 'Follow-Up Date': formattedDate });
      
      const label = days >= 7 ? `${Math.round(days / 7)} week${days >= 14 ? 's' : ''}` : `${days} days`;
      setActionMessage({ type: 'success', text: `Snoozed for ${label} (${formattedDate})` });
      moveToNextLead();
      loadFollowups();
    } catch (err) {
      console.error('Failed to snooze:', err);
      setActionMessage({ type: 'error', text: 'Failed to update follow-up date.' });
    }
  };

  const moveToNextLead = () => {
    if (!selectedLead) return;
    const currentIndex = leads.findIndex(l => l.id === selectedLead.id);
    if (currentIndex < leads.length - 1) {
      selectLead(leads[currentIndex + 1]);
    } else {
      setSelectedLead(null);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;
    
    const input = chatInput.trim();
    setChatInput('');
    
    // Handle special commands
    if (input.toLowerCase().includes('set follow-up') || input.toLowerCase().includes('set followup')) {
      handleSetFollowupFromChat(input);
      return;
    }
    if (input.toLowerCase().includes('add note')) {
      handleAddNoteFromChat(input);
      return;
    }
    if (input.toLowerCase().includes('list nudge')) {
      // Placeholder for nudges feature
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: input },
        { role: 'assistant', content: 'Nudges feature coming soon. This will list available nudges from your library.' }
      ]);
      return;
    }
    
    await handleGenerateMessage(input);
  };

  const handleSetFollowupFromChat = async (message: string) => {
    if (!selectedLead) return;
    
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
        await updateLead(selectedLead.id, { 'Follow-Up Date': formattedDate });
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Done! Follow-up date set to ${formattedDate}` }
        ]);
        loadFollowups();
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

  const handleAddNoteFromChat = async (message: string) => {
    if (!selectedLead) return;
    
    const noteContent = message.replace(/add\s*(a\s*)?note:?\s*/i, '').trim();
    if (noteContent) {
      try {
        const existingNotes = selectedLead.notes || '';
        const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
        const newNote = `\n\n## MANUAL\n${noteContent}\n[${dateStr}]`;
        
        await updateLead(selectedLead.id, { 'Notes': existingNotes + newNote });
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: 'Note added.' }
        ]);
        setSelectedLead(prev => prev ? { ...prev, notes: existingNotes + newNote } : null);
      } catch (err) {
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        ]);
      }
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
              {leads.length} lead{leads.length !== 1 ? 's' : ''} need attention
            </span>
          </div>
          
          <button
            onClick={loadFollowups}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? '...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Content */}
        <div className="flex h-full" style={{ height: 'calc(100% - 65px)' }}>
          {/* Left panel - Lead list */}
          <div className="w-1/4 border-r border-gray-200 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : error ? (
              <div className="p-4 text-red-600">{error}</div>
            ) : leads.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <div className="text-4xl mb-3">🎉</div>
                <p className="font-medium">All caught up!</p>
                <p className="text-sm mt-1">No follow-ups need attention right now.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {leads.map((lead, index) => {
                  const badge = getPriorityBadge(lead.priority);
                  return (
                    <div
                      key={lead.id}
                      onClick={() => selectLead(lead)}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedLead?.id === lead.id
                          ? 'bg-blue-50 border-l-4 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
                        <h3 className="font-medium text-gray-900 truncate text-sm">
                          {lead.firstName} {lead.lastName}
                        </h3>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.bgColor} ${badge.textColor}`}>
                          {badge.text}
                        </span>
                        {lead.waitingOn === 'User' && (
                          <span className="text-xs text-orange-600 font-medium">💬 They replied</span>
                        )}
                        {lead.daysOverdue > 0 && (
                          <span className="text-xs text-gray-500">{lead.daysOverdue}d overdue</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{lead.showReason}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel - Lead details & actions */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedLead ? (
              <>
                {/* Lead header */}
                <div className="p-4 border-b border-gray-200 bg-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {selectedLead.firstName} {selectedLead.lastName}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {selectedLead.status}
                        {selectedLead.company && ` • ${selectedLead.company}`}
                        {selectedLead.title && ` • ${selectedLead.title}`}
                      </p>
                      <p className="text-sm mt-1">
                        <span className={`font-medium ${selectedLead.waitingOn === 'User' ? 'text-orange-600' : 'text-blue-600'}`}>
                          {selectedLead.waitingOn === 'User' 
                            ? '💬 They replied - you owe a response' 
                            : selectedLead.waitingOn === 'Lead'
                            ? '⏳ Waiting on them'
                            : '📋 Follow-up due'}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedLead.linkedinProfileUrl && (
                        <a
                          href={selectedLead.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          🔗 LinkedIn
                        </a>
                      )}
                      <button
                        onClick={handleAnalyzeLead}
                        disabled={isGenerating}
                        className="px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        🤖 Analyze
                      </button>
                    </div>
                  </div>
                  
                  {/* Action message */}
                  {actionMessage && (
                    <div className={`mt-2 text-sm px-3 py-1.5 rounded-lg ${
                      actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {actionMessage.text}
                    </div>
                  )}
                  
                  {/* Action buttons */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 font-medium">Snooze:</span>
                    <button onClick={() => handleSnooze(7)} className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">+1 week</button>
                    <button onClick={() => handleSnooze(14)} className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">+2 weeks</button>
                    <button onClick={() => handleSnooze(30)} className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">+1 month</button>
                    <div className="border-l border-gray-300 h-4 mx-2"></div>
                    <button
                      onClick={handleCeaseFollowup}
                      className="px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md"
                    >
                      ⏹️ Cease
                    </button>
                  </div>
                </div>

                {/* Main content area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* AI Story / Context */}
                  <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                    <h3 className="font-medium text-blue-900 mb-2">📖 Story so far</h3>
                    <p className="text-sm text-blue-800">{selectedLead.story}</p>
                  </div>
                  
                  {/* Notes section */}
                  <div className="bg-amber-50 rounded-lg border border-amber-200">
                    <div className="px-4 py-2 border-b border-amber-200 flex items-center justify-between">
                      <h3 className="font-medium text-amber-900">📝 Notes</h3>
                      <span className="text-xs text-amber-600">
                        {selectedLead.notes ? `${selectedLead.notes.split('\n').filter(l => l.trim()).length} lines` : 'No notes'}
                      </span>
                    </div>
                    <div className="p-4 max-h-48 overflow-y-auto">
                      {selectedLead.notes ? (
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{selectedLead.notes}</pre>
                      ) : (
                        <p className="text-sm text-gray-500 italic">No notes yet</p>
                      )}
                    </div>
                  </div>

                  {/* AI Analysis */}
                  {analysis && (
                    <div ref={analysisRef} className="bg-purple-50 rounded-lg border border-purple-200">
                      <div className="px-4 py-2 border-b border-purple-200">
                        <h3 className="font-medium text-purple-900">🤖 AI Analysis</h3>
                      </div>
                      <div className="p-4">
                        <div className="text-sm text-purple-800 whitespace-pre-wrap">{analysis}</div>
                      </div>
                    </div>
                  )}

                  {/* Message generation */}
                  <div className="bg-gray-50 rounded-lg border border-gray-200">
                    <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">💬 Suggested Message</h3>
                      {!generatedMessage && (
                        <button
                          onClick={() => handleGenerateMessage()}
                          disabled={isGenerating}
                          className="px-3 py-1 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50"
                        >
                          {isGenerating ? 'Generating...' : '✨ Generate'}
                        </button>
                      )}
                    </div>
                    <div className="p-4">
                      {isGenerating && !generatedMessage ? (
                        <div className="flex items-center justify-center h-20">
                          <div className="flex items-center gap-2 text-gray-500">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                            <span>Generating...</span>
                          </div>
                        </div>
                      ) : generatedMessage ? (
                        <>
                          <div className="bg-white rounded-lg p-4 border border-gray-200 whitespace-pre-wrap text-gray-800">
                            {generatedMessage}
                          </div>
                          
                          {chatHistory.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {chatHistory.map((msg, i) => (
                                <div key={i} className={`text-sm p-2 rounded-lg ${msg.role === 'user' ? 'bg-blue-100 text-blue-800 ml-8' : 'bg-gray-100 text-gray-800 mr-8'}`}>
                                  {msg.content}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {/* Message actions */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={handleCopyMessage}
                              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${copySuccess ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                            >
                              {copySuccess ? '✓ Copied!' : '📋 Copy'}
                            </button>
                            <button
                              onClick={handleEmailToMe}
                              disabled={emailSending}
                              className="px-3 py-1.5 text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg disabled:opacity-50"
                            >
                              {emailSending ? 'Sending...' : '📧 Email to me'}
                            </button>
                            <button
                              onClick={() => handleGenerateMessage()}
                              disabled={isGenerating}
                              className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                            >
                              🔄 Regenerate
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 italic text-center py-4">
                          Click "Generate" to create a suggested message
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chat input */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <form onSubmit={handleChatSubmit} className="flex gap-2">
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Refine message, 'set follow-up to 2 weeks', 'add note: xyz', 'list nudges'..."
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
                  
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={moveToNextLead}
                      disabled={leads.findIndex(l => l.id === selectedLead.id) >= leads.length - 1}
                      className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                    >
                      Skip to next →
                    </button>
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
