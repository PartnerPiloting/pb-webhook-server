'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Layout from '../../components/Layout';
import { getFollowUps, generateFollowupMessage, updateLead, detectLeadTags } from '../../services/api';
import { getCurrentClientId } from '../../utils/clientUtils';

/**
 * Smart Follow-ups Page - AI-powered follow-up prioritization and message generation
 * 
 * Full page view (not modal) for better workspace.
 * Uses existing getFollowUps() API and calculates priority scores client-side.
 */

// Parse LinkedIn messages to find last contact date and who sent it
const parseLastMessageInfo = (notes: string, leadFirstName: string) => {
  if (!notes) return { lastMessageDate: null, userSentLast: false, daysSinceLastMessage: null };
  
  // Only parse from the LinkedIn Messages section to avoid matching other dates
  const linkedinSection = notes.match(/=== LINKEDIN MESSAGES ===[\s\S]*?(?====|$)/i);
  const textToParse = linkedinSection ? linkedinSection[0] : notes;
  
  // Match message format: DD-MM-YY H:MM AM/PM - Sender Name - Message
  // or: DD-MM-YY HH:MM AM/PM - Sender Name - Message  
  const messagePattern = /(\d{1,2}-\d{1,2}-\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*([^-]+)\s*-/gi;
  const matches = [...textToParse.matchAll(messagePattern)];
  
  if (matches.length === 0) return { lastMessageDate: null, userSentLast: false, daysSinceLastMessage: null };
  
  const today = new Date();
  
  // Find the most recent PAST message by parsing all dates
  let latestDate: Date | null = null;
  let latestSender = '';
  
  for (const match of matches) {
    const [, dateStr, , sender] = match;
    // Parse DD-MM-YY format
    const dateParts = dateStr.split('-');
    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]) - 1; // JS months are 0-indexed
      let year = parseInt(dateParts[2]);
      if (year < 100) year += 2000;
      
      const msgDate = new Date(year, month, day);
      
      // Skip future dates (messages can't be from the future)
      if (msgDate > today) continue;
      
      if (!latestDate || msgDate > latestDate) {
        latestDate = msgDate;
        latestSender = sender.trim();
      }
    }
  }
  
  if (!latestDate) return { lastMessageDate: null, userSentLast: false, daysSinceLastMessage: null };
  
  // Check if user (Guy Wilson or similar) sent the last message
  const userSentLast = latestSender.toLowerCase().includes('guy') || 
                       latestSender.toLowerCase().includes('wilson') ||
                       !latestSender.toLowerCase().includes(leadFirstName.toLowerCase());
  
  const daysSinceLastMessage = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
  
  return { lastMessageDate: latestDate, userSentLast, daysSinceLastMessage };
};

// Calculate priority score for a lead
const calculatePriorityScore = (lead) => {
  const today = new Date();
  let priorityScore = 0;
  
  const aiScore = parseFloat(String(lead['AI Score'] || lead.aiScore || '0')) || 0;
  priorityScore += Math.min(40, aiScore * 0.4);
  
  const status = lead['Status'] || lead.status || '';
  if (status === 'In Process') priorityScore += 20;
  else if (status === 'On The Radar') priorityScore += 5;
  else if (status === 'Engaged') priorityScore += 25;
  
  const notes = lead['Notes'] || lead.notes || '';
  const firstName = lead['First Name'] || lead.firstName || '';
  
  // Parse actual conversation to find last contact
  const { lastMessageDate: parsedLastMsg, userSentLast, daysSinceLastMessage } = parseLastMessageInfo(notes, firstName);
  
  // Use parsed date if available, otherwise fall back to field
  const lastMessageDate = parsedLastMsg || (lead['Last Message Date'] || lead.lastMessageDate ? new Date(lead['Last Message Date'] || lead.lastMessageDate) : null);
  const actualDaysSinceContact = daysSinceLastMessage ?? (lastMessageDate ? Math.floor((today.getTime() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24)) : null);
  
  // Recency scoring
  if (actualDaysSinceContact !== null) {
    if (actualDaysSinceContact <= 7) priorityScore += 15;
    else if (actualDaysSinceContact <= 14) priorityScore += 10;
    else if (actualDaysSinceContact <= 30) priorityScore += 5;
  }
  
  // Who sent last message affects priority
  // If user sent last, they're waiting for response - lower urgency to act
  // If lead sent last, user needs to respond - higher urgency
  if (userSentLast) {
    priorityScore -= 10; // Waiting for their response
  } else if (daysSinceLastMessage !== null && !userSentLast) {
    priorityScore += 15; // They messaged, need to respond!
  }
  
  const hasPromisedTag = notes.toLowerCase().includes('#promised');
  
  // Calculate overdue based on Follow-Up Date, but consider actual last contact
  const followUpDate = lead['Follow-Up Date'] || lead.followUpDate;
  let daysOverdue = 0;
  let effectiveOverdue = 0; // For display - considers actual conversation
  
  if (followUpDate) {
    const fupDate = new Date(followUpDate);
    daysOverdue = Math.max(0, Math.floor((today.getTime() - fupDate.getTime()) / (1000 * 60 * 60 * 24)));
    
    // If there's been recent conversation AFTER the follow-up date, reduce effective overdue
    if (parsedLastMsg && parsedLastMsg > fupDate) {
      // Last contact was after follow-up date, so "overdue" is really since last contact
      effectiveOverdue = daysSinceLastMessage || 0;
    } else {
      effectiveOverdue = daysOverdue;
    }
    
    // Overdue logic - leads with automated tags are handled by cron job
    // Other overdue leads get penalized if stale
    if (effectiveOverdue > 14) {
      // Only penalize if actually stale (no recent contact)
      priorityScore -= Math.min(20, effectiveOverdue * 2);
    }
  }
  
  // Tag-based scoring
  // Automated tags (#promised, #agreed-to-meet, #no-show) get LOWER priority
  // because the cron job will handle these automatically via email drafts
  const hasAgreedToMeet = notes.toLowerCase().includes('#agreed-to-meet');
  const hasNoShow = notes.includes('#no-show');
  
  if (hasPromisedTag || hasAgreedToMeet || hasNoShow) {
    // These are handled by automation - push to bottom of list
    priorityScore -= 50;
  }
  
  // Other tags still affect priority normally
  if (notes.toLowerCase().includes('#warm-response')) priorityScore += 20;
  if (notes.includes('#hot')) priorityScore += 15;
  if (notes.includes('#cancelled')) priorityScore += 10;
  if (notes.toLowerCase().includes('#rescheduled')) priorityScore += 5;
  if (notes.includes('#cold')) priorityScore -= 15;
  if (notes.includes('#moving-on')) priorityScore -= 30;
  
  return { 
    priorityScore: Math.round(priorityScore), 
    daysOverdue,
    effectiveOverdue,
    daysSinceLastMessage,
    userSentLast
  };
};

const extractTags = (notes) => {
  if (!notes) return [];
  const tagMatch = notes.match(/#[\w-]+/g);
  return tagMatch || [];
};

const isAwaitingResponse = (lead) => {
  const notes = lead['Notes'] || lead.notes || '';
  const sentMatch = notes.match(/📤 Sent.*?\| (\d{1,2}-\w{3}-\d{2,4})/);
  if (!sentMatch) return false;
  
  try {
    const parts = sentMatch[1].match(/(\d{1,2})-(\w{3})-(\d{2,4})/);
    if (!parts) return false;
    
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const day = parseInt(parts[1]);
    const month = months[parts[2]] ?? 0;
    let year = parseInt(parts[3]);
    if (year < 100) year += 2000;
    
    const sentDate = new Date(year, month, day);
    const today = new Date();
    const daysSinceSent = Math.floor((today.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSinceSent > 14 || daysSinceSent < 0) return false;
    
    const lastMsgDate = lead['Last Message Date'] || lead.lastMessageDate;
    if (lastMsgDate) {
      const lastMsg = new Date(lastMsgDate);
      if (lastMsg.getTime() > sentDate.getTime()) return false;
    }
    
    return { daysSinceSent };
  } catch (e) {
    return false;
  }
};

function SmartFollowupsContent() {
  const [activeTab, setActiveTab] = useState('top-picks');
  const [leads, setLeads] = useState([]);
  const [awaitingLeads, setAwaitingLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [isBatchTagging, setIsBatchTagging] = useState(false);
  const [batchTagResult, setBatchTagResult] = useState(null);
  const [tagProgress, setTagProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  
  const chatInputRef = useRef(null);
  const analysisRef = useRef(null);
  
  // Auto-scroll to analysis when it appears
  useEffect(() => {
    if (analysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [analysis]);

  // Check if owner
  const isOwner = getCurrentClientId() === 'Guy-Wilson';

  useEffect(() => {
    if (isOwner) {
      loadFollowups();
    }
  }, [isOwner]);

  // Auto-refresh when tab becomes visible (returning from LinkedIn or Quick Update)
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
      
      const enrichedLeads = rawLeads.map((lead) => {
        const { priorityScore, daysOverdue, effectiveOverdue, daysSinceLastMessage, userSentLast } = calculatePriorityScore(lead);
        const awaiting = isAwaitingResponse(lead);
        return {
          id: lead['Profile Key'] || lead.id || '',
          firstName: lead['First Name'] || lead.firstName || '',
          lastName: lead['Last Name'] || lead.lastName || '',
          linkedinProfileUrl: lead['LinkedIn Profile URL'] || lead.linkedinProfileUrl || '',
          followUpDate: lead['Follow-Up Date'] || lead.followUpDate || '',
          aiScore: lead['AI Score'] || lead.aiScore,
          status: lead['Status'] || lead.status || '',
          lastMessageDate: lead['Last Message Date'] || lead.lastMessageDate || '',
          notes: lead['Notes'] || lead.notes || '',
          linkedinMessages: lead['LinkedIn Messages'] || lead.linkedinMessages || '',
          email: lead['Email'] || lead.email || '',
          company: lead['Company Name'] || lead.company || '',
          title: lead['Job Title'] || lead.title || '',
          priorityScore,
          daysOverdue,
          effectiveOverdue: effectiveOverdue || daysOverdue,
          daysSinceLastMessage,
          userSentLast,
          isAwaiting: !!awaiting || userSentLast, // Also mark as awaiting if user sent last message
          daysSinceSent: awaiting ? awaiting.daysSinceSent : (userSentLast ? daysSinceLastMessage : null)
        };
      });
      
      const awaiting = enrichedLeads.filter(l => l.isAwaiting);
      const topPicks = enrichedLeads.filter(l => !l.isAwaiting);
      
      topPicks.sort((a, b) => b.priorityScore - a.priorityScore);
      awaiting.sort((a, b) => (b.daysSinceSent ?? 0) - (a.daysSinceSent ?? 0));
      
      setLeads(topPicks); // Show all leads, no limit
      setAwaitingLeads(awaiting);
    } catch (err) {
      console.error('Failed to load follow-ups:', err);
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setIsLoading(false);
    }
  };

  // Select lead WITHOUT auto-generating message
  const selectLead = (lead) => {
    setSelectedLead(lead);
    setGeneratedMessage('');
    setChatHistory([]);
    setAnalysis(null);
    setActionMessage(null);
  };

  // Generate message on demand
  const handleGenerateMessage = async (refinement = null) => {
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
          name: `${selectedLead.firstName} ${selectedLead.lastName}`.trim(),
          tags: extractTags(selectedLead.notes)
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
          followUpDate: selectedLead.followUpDate,
          lastMessageDate: selectedLead.lastMessageDate,
          tags: extractTags(selectedLead.notes)
        }
      });
      setAnalysis(result.analysis);
    } catch (err) {
      console.error('Failed to analyze lead:', err);
      const lastContactInfo = selectedLead.daysSinceLastMessage !== null 
        ? `${selectedLead.daysSinceLastMessage} days ago (${selectedLead.userSentLast ? 'you sent last - awaiting response' : 'they sent last - you should respond'})`
        : 'Unknown';
      setAnalysis(`Unable to analyze automatically. Here's what I can see:\n\n• AI Score: ${selectedLead.aiScore || 'N/A'}\n• Status: ${selectedLead.status}\n• Last contact: ${lastContactInfo}\n• Follow-up was due: ${selectedLead.effectiveOverdue || 0} days ago\n• Tags: ${extractTags(selectedLead.notes).join(', ') || 'None'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Cease follow-up - clear Follow-Up Date
  const handleCeaseFollowup = async () => {
    if (!selectedLead) return;
    
    try {
      const existingNotes = selectedLead.notes || '';
      const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
      const ceaseNote = `\n\n## MANUAL\n#moving-on - Ceased follow-up\n[${dateStr}]`;
      
      await updateLead(selectedLead.id, { 
        'Follow-Up Date': null,
        'Notes': existingNotes + ceaseNote
      });
      
      setActionMessage({ type: 'success', text: 'Follow-up ceased. Lead removed from queue.' });
      
      // Move to next lead
      const currentList = activeTab === 'top-picks' ? leads : awaitingLeads;
      const currentIndex = currentList.findIndex(l => l.id === selectedLead.id);
      if (currentIndex < currentList.length - 1) {
        selectLead(currentList[currentIndex + 1]);
      } else {
        setSelectedLead(null);
      }
      
      loadFollowups();
    } catch (err) {
      console.error('Failed to cease follow-up:', err);
      setActionMessage({ type: 'error', text: 'Failed to update lead.' });
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;
    
    const input = chatInput.trim();
    setChatInput('');
    
    if (input.toLowerCase().includes('set follow-up') || input.toLowerCase().includes('set followup')) {
      handleSetFollowupFromChat(input);
      return;
    }
    
    if (input.toLowerCase().includes('add note') || input.toLowerCase().includes('add a note')) {
      handleAddNoteFromChat(input);
      return;
    }
    
    await handleGenerateMessage(input);
  };

  const handleSetFollowupFromChat = async (message) => {
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
          { role: 'assistant', content: `Failed to update: ${err instanceof Error ? err.message : 'Unknown error'}` }
        ]);
      }
    } else {
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: `Try "set follow-up to 2 weeks" or "set follow-up to 1 month"` }
      ]);
    }
  };

  const handleAddNoteFromChat = async (message) => {
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
          { role: 'assistant', content: `Note added.` }
        ]);
        // Refresh the selected lead's notes
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

  // Quick reschedule - push follow-up date forward and move to next lead
  const handleQuickReschedule = async (days: number) => {
    if (!selectedLead) return;
    
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + days);
    const formattedDate = newDate.toISOString().split('T')[0];
    
    try {
      await updateLead(selectedLead.id, { 'Follow-Up Date': formattedDate });
      
      const weeksOrDays = days >= 7 ? `${Math.round(days / 7)} week${days >= 14 ? 's' : ''}` : `${days} days`;
      setActionMessage({ type: 'success', text: `Rescheduled to ${formattedDate} (+${weeksOrDays})` });
      
      // Move to next lead
      const currentList = activeTab === 'top-picks' ? leads : awaitingLeads;
      const currentIndex = currentList.findIndex(l => l.id === selectedLead.id);
      if (currentIndex < currentList.length - 1) {
        selectLead(currentList[currentIndex + 1]);
      } else {
        setSelectedLead(null);
      }
      
      loadFollowups();
    } catch (err) {
      console.error('Failed to reschedule:', err);
      setActionMessage({ type: 'error', text: 'Failed to update follow-up date.' });
    }
  };

  const getPriorityLabel = (lead) => {
    if (lead.priorityScore >= 80) return { text: 'Hot', color: 'text-red-600 bg-red-50' };
    if (lead.priorityScore >= 60) return { text: 'Warm', color: 'text-orange-600 bg-orange-50' };
    return { text: 'Normal', color: 'text-gray-600 bg-gray-50' };
  };

  // Batch tag leads using frontend loop with progress
  const handleBatchTag = async (dryRun = false) => {
    // Get all leads from both tabs
    const allLeads = [...leads, ...awaitingLeads];
    
    if (allLeads.length === 0) {
      setBatchTagResult({ error: 'No leads to process' });
      return;
    }
    
    setIsBatchTagging(true);
    setBatchTagResult(null);
    setTagProgress({ current: 0, total: allLeads.length, name: '' });
    
    const results = {
      processed: 0,
      tagged: 0,
      skipped: 0,
      errors: 0,
      tagCounts: {} as Record<string, number>,
      details: [] as Array<{ name: string; status: string; tags?: string[]; error?: string }>
    };
    
    try {
      for (let i = 0; i < allLeads.length; i++) {
        const lead = allLeads[i];
        const leadName = `${lead.firstName} ${lead.lastName}`.trim();
        
        // Update progress
        setTagProgress({ current: i + 1, total: allLeads.length, name: leadName });
        
        // Check if lead already has tags
        const existingTags = extractTags(lead.notes || '');
        if (existingTags.length > 0) {
          results.skipped++;
          results.details.push({ name: leadName, status: 'skipped' });
          continue;
        }
        
        try {
          // Call detect-tags endpoint
          const tagResult = await detectLeadTags({
            notes: lead.notes || '',
            linkedinMessages: lead.linkedinMessages || '',
            emailContent: '',
            leadName
          });
          
          if (tagResult.suggestedTags && tagResult.suggestedTags.length > 0) {
            if (!dryRun) {
              // Apply tags by updating the lead
              const currentNotes = lead.notes || '';
              const tagsLine = `Tags: ${tagResult.suggestedTags.join(' ')}`;
              const updatedNotes = currentNotes.startsWith('Tags:') 
                ? currentNotes.replace(/^Tags:.*$/m, tagsLine)
                : `${tagsLine}\n\n${currentNotes}`;
              
              await updateLead(lead.id, { notes: updatedNotes });
            }
            
            results.tagged++;
            tagResult.suggestedTags.forEach((tag: string) => {
              results.tagCounts[tag] = (results.tagCounts[tag] || 0) + 1;
            });
            results.details.push({ name: leadName, status: 'tagged', tags: tagResult.suggestedTags });
          } else {
            results.skipped++;
            results.details.push({ name: leadName, status: 'no-tags' });
          }
          
          results.processed++;
          
        } catch (err) {
          console.error(`Error tagging ${leadName}:`, err);
          results.errors++;
          results.details.push({ name: leadName, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
        }
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      setBatchTagResult({
        success: true,
        dryRun,
        summary: {
          totalLeads: allLeads.length,
          processed: results.processed,
          tagged: results.tagged,
          skipped: results.skipped,
          errors: results.errors,
          tagCounts: results.tagCounts
        },
        details: results.details
      });
      
      // Refresh the list if we actually tagged leads
      if (!dryRun && results.tagged > 0) {
        loadFollowups();
      }
      
    } catch (err) {
      console.error('Batch tag error:', err);
      setBatchTagResult({ error: err instanceof Error ? err.message : 'Batch tagging failed' });
    } finally {
      setIsBatchTagging(false);
      setTagProgress(null);
    }
  };

  const getTagBadges = (notes) => {
    const tags = extractTags(notes);
    const badgeMap: Record<string, { text: string; color: string }> = {
      '#warm-response': { text: 'Warm', color: 'bg-green-100 text-green-700' },
      '#promised': { text: 'Promised', color: 'bg-purple-100 text-purple-700' },
      '#agreed-to-meet': { text: 'Agreed to Meet', color: 'bg-blue-100 text-blue-700' },
      '#no-show': { text: 'No-show', color: 'bg-red-100 text-red-700' },
      '#cancelled': { text: 'Cancelled', color: 'bg-yellow-100 text-yellow-700' },
      '#rescheduled': { text: 'Rescheduled', color: 'bg-blue-100 text-blue-700' },
      '#hot': { text: 'Hot', color: 'bg-red-100 text-red-700' },
      '#cold': { text: 'Cold', color: 'bg-gray-100 text-gray-700' },
      '#moving-on': { text: 'Moving on', color: 'bg-gray-100 text-gray-700' },
      '#draft-pending': { text: 'Draft Sent', color: 'bg-yellow-100 text-yellow-700' }
    };
    
    return tags
      .filter(tag => badgeMap[tag.toLowerCase()])
      .map(tag => badgeMap[tag.toLowerCase()]);
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
            
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('top-picks')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'top-picks'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Top Picks {leads.length > 0 && `(${leads.length})`}
              </button>
              <button
                onClick={() => setActiveTab('awaiting')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'awaiting'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Awaiting Response {awaitingLeads.length > 0 && `(${awaitingLeads.length})`}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBatchTag(true)}
              disabled={isBatchTagging}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
              title="Preview what tags would be applied (no changes made)"
            >
              {isBatchTagging && tagProgress ? `⏳ ${tagProgress.current}/${tagProgress.total}` : '👁️ Preview Tags'}
            </button>
            <button
              onClick={() => handleBatchTag(false)}
              disabled={isBatchTagging}
              className="px-3 py-1.5 text-sm font-medium text-purple-600 hover:text-purple-900 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
              title="Apply AI tags to all leads with follow-up dates"
            >
              {isBatchTagging && tagProgress ? `⏳ ${tagProgress.current}/${tagProgress.total}` : '🏷️ Apply Tags'}
            </button>
            <button
              onClick={loadFollowups}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              🔄 Refresh
            </button>
          </div>
        </div>
        
        {/* Progress Banner */}
        {tagProgress && (
          <div className="px-6 py-3 border-b bg-blue-50 border-blue-200">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
              <span className="text-blue-700">
                Processing {tagProgress.current} of {tagProgress.total}: <span className="font-medium">{tagProgress.name}</span>
              </span>
            </div>
          </div>
        )}
        
        {/* Batch Tag Result Banner */}
        {batchTagResult && (
          <div className={`px-6 py-3 border-b ${batchTagResult.error ? 'bg-red-50 border-red-200' : batchTagResult.dryRun ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                {batchTagResult.error ? (
                  <span className="text-red-700">❌ {batchTagResult.error}</span>
                ) : (
                  <div className={batchTagResult.dryRun ? 'text-blue-700' : 'text-green-700'}>
                    <span className="font-medium">
                      {batchTagResult.dryRun ? '👁️ Preview (no changes made)' : '✅ Tags applied!'}
                    </span>
                    <span className="ml-2">
                      {batchTagResult.summary?.tagged} would be tagged, {batchTagResult.summary?.skipped} skipped
                      {batchTagResult.summary?.errors > 0 && `, ${batchTagResult.summary?.errors} errors`}
                    </span>
                    {batchTagResult.summary?.tagCounts && Object.keys(batchTagResult.summary.tagCounts).length > 0 && (
                      <span className="ml-2 text-sm">
                        ({Object.entries(batchTagResult.summary.tagCounts).map(([tag, count]) => `${tag}: ${count}`).join(', ')})
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button 
                onClick={() => setBatchTagResult(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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
            ) : (
              <div className="divide-y divide-gray-100">
                {(activeTab === 'top-picks' ? leads : awaitingLeads).map((lead, index) => (
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
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${getPriorityLabel(lead).color}`}>
                        {getPriorityLabel(lead).text}
                      </span>
                      <span className="text-xs text-gray-500">
                        {lead.aiScore || 'N/A'}
                      </span>
                      {/* Show last contact info - more useful than raw overdue */}
                      {lead.daysSinceLastMessage !== null && (
                        <span className={`text-xs ${lead.userSentLast ? 'text-blue-600' : 'text-orange-600'}`}>
                          {lead.userSentLast ? '⏳' : '💬'} {lead.daysSinceLastMessage}d
                        </span>
                      )}
                      {lead.effectiveOverdue > 7 && !lead.userSentLast && (
                        <span className="text-xs text-red-600">
                          overdue
                        </span>
                      )}
                    </div>
                    {getTagBadges(lead.notes).length > 0 && (
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {getTagBadges(lead.notes).map((badge, i) => (
                          <span key={i} className={`text-xs px-1 py-0.5 rounded ${badge.color}`}>
                            {badge.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                
                {(activeTab === 'top-picks' ? leads : awaitingLeads).length === 0 && (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    {activeTab === 'top-picks' 
                      ? 'No follow-ups due. Nice work!' 
                      : 'No messages awaiting response.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel - Lead details & actions */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedLead ? (
              <>
                {/* Lead header with actions */}
                <div className="p-4 border-b border-gray-200 bg-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {selectedLead.firstName} {selectedLead.lastName}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {selectedLead.status} • Score: {selectedLead.aiScore || 'N/A'}
                        {selectedLead.company && ` • ${selectedLead.company}`}
                        {selectedLead.daysSinceLastMessage !== null && (
                          <span className={`ml-2 ${selectedLead.userSentLast ? 'text-blue-600' : 'text-orange-600'}`}>
                            ({selectedLead.userSentLast 
                              ? `⏳ You sent ${selectedLead.daysSinceLastMessage}d ago` 
                              : `💬 They replied ${selectedLead.daysSinceLastMessage}d ago`})
                          </span>
                        )}
                        {selectedLead.effectiveOverdue > 7 && !selectedLead.userSentLast && (
                          <span className="text-red-600 ml-1">- needs response!</span>
                        )}
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
                      <button
                        onClick={handleCeaseFollowup}
                        className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        title="Remove from follow-up queue"
                      >
                        ⏹️ Cease Follow-up
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
                  
                  {/* Quick reschedule buttons */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 font-medium">Quick reschedule:</span>
                    <button
                      onClick={() => handleQuickReschedule(7)}
                      className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                    >
                      +1 week
                    </button>
                    <button
                      onClick={() => handleQuickReschedule(14)}
                      className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                    >
                      +2 weeks
                    </button>
                    <button
                      onClick={() => handleQuickReschedule(30)}
                      className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                    >
                      +1 month
                    </button>
                    <input
                      type="date"
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      onChange={(e) => {
                        if (e.target.value) {
                          const selectedDate = new Date(e.target.value);
                          const today = new Date();
                          const diffDays = Math.ceil((selectedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                          if (diffDays > 0) {
                            handleQuickReschedule(diffDays);
                          }
                          e.target.value = ''; // Reset the picker
                        }
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      title="Pick a specific date"
                    />
                  </div>
                </div>

                {/* Main content area - scrollable */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Notes section - always visible */}
                  <div className="bg-amber-50 rounded-lg border border-amber-200">
                    <div className="px-4 py-2 border-b border-amber-200 flex items-center justify-between">
                      <h3 className="font-medium text-amber-900">📝 Notes</h3>
                      <span className="text-xs text-amber-600">
                        {selectedLead.notes ? `${selectedLead.notes.split('\n').filter(l => l.trim()).length} lines` : 'No notes'}
                      </span>
                    </div>
                    <div className="p-4 max-h-64 overflow-y-auto">
                      {selectedLead.notes ? (
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{selectedLead.notes}</pre>
                      ) : (
                        <p className="text-sm text-gray-500 italic">No notes yet</p>
                      )}
                    </div>
                  </div>

                  {/* AI Analysis - if generated */}
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

                  {/* Message generation section */}
                  <div className="bg-gray-50 rounded-lg border border-gray-200">
                    <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">💬 Suggested Message</h3>
                      {!generatedMessage && (
                        <button
                          onClick={() => handleGenerateMessage()}
                          disabled={isGenerating}
                          className="px-3 py-1 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isGenerating ? 'Generating...' : '✨ Generate Message'}
                        </button>
                      )}
                    </div>
                    <div className="p-4">
                      {isGenerating && !generatedMessage ? (
                        <div className="flex items-center justify-center h-24">
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
                          
                          {/* Chat history */}
                          {chatHistory.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {chatHistory.map((msg, i) => (
                                <div
                                  key={i}
                                  className={`text-sm p-2 rounded-lg ${
                                    msg.role === 'user'
                                      ? 'bg-blue-100 text-blue-800 ml-8'
                                      : 'bg-gray-100 text-gray-800 mr-8'
                                  }`}
                                >
                                  {msg.content}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {/* Message actions */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={handleCopyMessage}
                              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                copySuccess
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {copySuccess ? '✓ Copied!' : '📋 Copy'}
                            </button>
                            <button
                              onClick={() => handleGenerateMessage()}
                              disabled={isGenerating}
                              className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                              🔄 Regenerate
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 italic text-center py-4">
                          Review the notes above, then click "Generate Message" when ready
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chat input - fixed at bottom */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <form onSubmit={handleChatSubmit} className="flex gap-2">
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Refine message, 'set follow-up to 2 weeks', 'add note: xyz'..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      disabled={isGenerating}
                    />
                    <button
                      type="submit"
                      disabled={isGenerating || !chatInput.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      Send
                    </button>
                  </form>
                  
                  {/* Skip button */}
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => {
                        const currentList = activeTab === 'top-picks' ? leads : awaitingLeads;
                        const nextIndex = currentList.findIndex(l => l.id === selectedLead.id) + 1;
                        if (nextIndex < currentList.length) {
                          selectLead(currentList[nextIndex]);
                        }
                      }}
                      disabled={(activeTab === 'top-picks' ? leads : awaitingLeads).findIndex(l => l.id === selectedLead.id) >= (activeTab === 'top-picks' ? leads : awaitingLeads).length - 1}
                      className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
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

// Wrap in Suspense because Layout uses useSearchParams
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
