'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getSmartFollowups, generateFollowupMessage, updateLead } from '../services/api';
import { getCurrentClientId } from '../utils/clientUtils';

/**
 * SmartFollowupsModal - AI-powered follow-up prioritization and message generation
 * 
 * Features:
 * - Prioritized list of follow-ups based on AI Score, Status, Recency
 * - AI-generated personalized messages for each lead
 * - Chat-based message refinement
 * - Copy to clipboard for LinkedIn
 * - Mark as sent tracking
 * - Owner-only feature
 */

const SmartFollowupsModal = ({ isOpen, onClose }) => {
  // State
  const [activeTab, setActiveTab] = useState('top-picks'); // 'top-picks' | 'awaiting'
  const [leads, setLeads] = useState([]);
  const [awaitingLeads, setAwaitingLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [analysisMode, setAnalysisMode] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  
  const modalRef = useRef(null);
  const chatInputRef = useRef(null);

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadFollowups();
    } else {
      // Reset state when modal closes
      setSelectedLead(null);
      setGeneratedMessage('');
      setChatHistory([]);
      setChatInput('');
      setAnalysisMode(false);
      setAnalysis(null);
    }
  }, [isOpen]);

  // Load prioritized follow-ups
  const loadFollowups = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSmartFollowups();
      setLeads(data.topPicks || []);
      setAwaitingLeads(data.awaiting || []);
    } catch (err) {
      console.error('Failed to load smart follow-ups:', err);
      setError(err.message || 'Failed to load follow-ups');
    } finally {
      setIsLoading(false);
    }
  };

  // Generate message for a lead
  const handleGenerateMessage = async (lead, refinement = null) => {
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(lead.id, {
        refinement,
        context: {
          notes: lead.notes,
          linkedinMessages: lead.linkedinMessages,
          score: lead.aiScore,
          status: lead.status,
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          tags: extractTags(lead.notes)
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
      setError('Failed to generate message');
    } finally {
      setIsGenerating(false);
    }
  };

  // Analyze a lead
  const handleAnalyzeLead = async (lead) => {
    setAnalysisMode(true);
    setIsGenerating(true);
    try {
      const result = await generateFollowupMessage(lead.id, {
        analyzeOnly: true,
        context: {
          notes: lead.notes,
          linkedinMessages: lead.linkedinMessages,
          score: lead.aiScore,
          status: lead.status,
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          followUpDate: lead.followUpDate,
          lastMessageDate: lead.lastMessageDate,
          tags: extractTags(lead.notes)
        }
      });
      setAnalysis(result.analysis);
    } catch (err) {
      console.error('Failed to analyze lead:', err);
      setError('Failed to analyze lead');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle chat refinement
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;
    
    const refinement = chatInput.trim();
    setChatInput('');
    
    // Check for action commands
    if (refinement.toLowerCase().includes('set follow-up') || refinement.toLowerCase().includes('set followup')) {
      handleSetFollowupFromChat(refinement);
      return;
    }
    
    if (refinement.toLowerCase().includes('add note') || refinement.toLowerCase().includes('add a note')) {
      handleAddNoteFromChat(refinement);
      return;
    }
    
    // Otherwise, refine the message
    await handleGenerateMessage(selectedLead, refinement);
  };

  // Extract date from chat message and set follow-up
  const handleSetFollowupFromChat = async (message) => {
    // Simple date extraction - could be enhanced
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
        // Refresh the list
        loadFollowups();
      } catch (err) {
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Failed to update follow-up date: ${err.message}` }
        ]);
      }
    } else {
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: `I couldn't understand the date. Try "set follow-up to 2 weeks" or "set follow-up to 1 month"` }
      ]);
    }
  };

  // Add note from chat
  const handleAddNoteFromChat = async (message) => {
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
          { role: 'assistant', content: `Note added successfully.` }
        ]);
      } catch (err) {
        setChatHistory(prev => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: `Failed to add note: ${err.message}` }
        ]);
      }
    }
  };

  // Copy message to clipboard
  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(generatedMessage);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Mark as sent - adds tracking note
  const handleMarkSent = async () => {
    if (!selectedLead) return;
    
    try {
      const existingNotes = selectedLead.notes || '';
      const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
      const sentNote = `\n\n📤 Sent follow-up via LinkedIn | ${dateStr}`;
      
      await updateLead(selectedLead.id, { 'Notes': existingNotes + sentNote });
      
      // Move to next lead
      const currentIndex = leads.findIndex(l => l.id === selectedLead.id);
      if (currentIndex < leads.length - 1) {
        selectLead(leads[currentIndex + 1]);
      } else {
        setSelectedLead(null);
        setGeneratedMessage('');
      }
      
      // Refresh list
      loadFollowups();
    } catch (err) {
      console.error('Failed to mark as sent:', err);
      setError('Failed to mark as sent');
    }
  };

  // Select a lead and generate message
  const selectLead = (lead) => {
    setSelectedLead(lead);
    setGeneratedMessage('');
    setChatHistory([]);
    setAnalysisMode(false);
    setAnalysis(null);
    handleGenerateMessage(lead);
  };

  // Extract tags from notes
  const extractTags = (notes) => {
    if (!notes) return [];
    const tagMatch = notes.match(/#[\w-]+/g);
    return tagMatch || [];
  };

  // Calculate priority score for display
  const getPriorityLabel = (lead) => {
    if (lead.priorityScore >= 80) return { text: 'Hot', color: 'text-red-600 bg-red-50' };
    if (lead.priorityScore >= 60) return { text: 'Warm', color: 'text-orange-600 bg-orange-50' };
    return { text: 'Normal', color: 'text-gray-600 bg-gray-50' };
  };

  // Get tag badges
  const getTagBadges = (notes) => {
    const tags = extractTags(notes);
    const badgeMap = {
      '#no-show': { text: 'No-show', color: 'bg-red-100 text-red-700' },
      '#cancelled': { text: 'Cancelled', color: 'bg-yellow-100 text-yellow-700' },
      '#rescheduled': { text: 'Rescheduled', color: 'bg-blue-100 text-blue-700' },
      '#hot': { text: 'Hot', color: 'bg-red-100 text-red-700' },
      '#cold': { text: 'Cold', color: 'bg-gray-100 text-gray-700' },
      '#moving-on': { text: 'Moving on', color: 'bg-gray-100 text-gray-700' }
    };
    
    return tags
      .filter(tag => badgeMap[tag.toLowerCase()])
      .map(tag => badgeMap[tag.toLowerCase()]);
  };

  // Handle escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div 
          ref={modalRef}
          className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold text-gray-900">🎯 Smart Follow-ups</h2>
              
              {/* Tabs */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('top-picks')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeTab === 'top-picks'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Top Picks {leads.length > 0 && `(${leads.length})`}
                </button>
                <button
                  onClick={() => setActiveTab('awaiting')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeTab === 'awaiting'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Awaiting Response {awaitingLeads.length > 0 && `(${awaitingLeads.length})`}
                </button>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Left panel - Lead list */}
            <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
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
                      className={`p-4 cursor-pointer transition-colors ${
                        selectedLead?.id === lead.id
                          ? 'bg-blue-50 border-l-4 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                            <h3 className="font-medium text-gray-900 truncate">
                              {lead.firstName} {lead.lastName}
                            </h3>
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getPriorityLabel(lead).color}`}>
                              {getPriorityLabel(lead).text}
                            </span>
                            <span className="text-xs text-gray-500">
                              Score: {lead.aiScore || 'N/A'}
                            </span>
                            {lead.daysOverdue > 0 && (
                              <span className="text-xs text-red-600">
                                {lead.daysOverdue}d overdue
                              </span>
                            )}
                          </div>
                          {/* Tag badges */}
                          {getTagBadges(lead.notes).length > 0 && (
                            <div className="mt-1 flex gap-1 flex-wrap">
                              {getTagBadges(lead.notes).map((badge, i) => (
                                <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${badge.color}`}>
                                  {badge.text}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-1">
                            {lead.status} • Last: {lead.lastMessageDate || 'Unknown'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {(activeTab === 'top-picks' ? leads : awaitingLeads).length === 0 && (
                    <div className="p-8 text-center text-gray-500">
                      {activeTab === 'top-picks' 
                        ? 'No follow-ups due. Nice work!' 
                        : 'No messages awaiting response.'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right panel - Message generation */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedLead ? (
                <>
                  {/* Lead header */}
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium text-gray-900">
                          {selectedLead.firstName} {selectedLead.lastName}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {selectedLead.status} • Score: {selectedLead.aiScore || 'N/A'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAnalyzeLead(selectedLead)}
                        className="px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                      >
                        🤖 Analyze
                      </button>
                    </div>
                  </div>

                  {/* Analysis view */}
                  {analysisMode && analysis && (
                    <div className="p-4 bg-purple-50 border-b border-purple-100">
                      <h4 className="font-medium text-purple-900 mb-2">🤖 AI Analysis</h4>
                      <div className="text-sm text-purple-800 whitespace-pre-wrap">{analysis}</div>
                    </div>
                  )}

                  {/* Generated message */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Suggested Message
                      </label>
                      {isGenerating ? (
                        <div className="flex items-center justify-center h-32 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 text-gray-500">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                            <span>Generating message...</span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-lg p-4 min-h-[120px] whitespace-pre-wrap text-gray-800">
                          {generatedMessage || 'Click a lead to generate a message...'}
                        </div>
                      )}
                    </div>

                    {/* Chat history */}
                    {chatHistory.length > 0 && (
                      <div className="mb-4 space-y-2">
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
                  </div>

                  {/* Chat input */}
                  <div className="p-4 border-t border-gray-200 bg-white">
                    <form onSubmit={handleChatSubmit} className="flex gap-2">
                      <input
                        ref={chatInputRef}
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Refine: 'make it shorter', 'more casual', 'set follow-up to 2 weeks'..."
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
                    
                    {/* Quick actions */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={handleCopyMessage}
                        disabled={!generatedMessage || isGenerating}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          copySuccess
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {copySuccess ? '✓ Copied!' : '📋 Copy to LinkedIn'}
                      </button>
                      <button
                        onClick={handleMarkSent}
                        disabled={!generatedMessage || isGenerating}
                        className="px-3 py-1.5 text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ✓ Mark Sent
                      </button>
                      <button
                        onClick={() => handleGenerateMessage(selectedLead)}
                        disabled={isGenerating}
                        className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        🔄 Regenerate
                      </button>
                      <button
                        onClick={() => {
                          const nextIndex = leads.findIndex(l => l.id === selectedLead.id) + 1;
                          if (nextIndex < leads.length) {
                            selectLead(leads[nextIndex]);
                          }
                        }}
                        disabled={leads.findIndex(l => l.id === selectedLead.id) >= leads.length - 1}
                        className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Skip →
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-4xl mb-4">👈</div>
                    <p>Select a lead to get started</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmartFollowupsModal;
