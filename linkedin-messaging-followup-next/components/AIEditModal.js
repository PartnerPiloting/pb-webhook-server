"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';

const AIEditModal = ({ isOpen, onClose, attribute, onSave }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState({});
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Field definitions - same as original broken modal
  const fields = [
    {
      key: 'heading',
      label: 'Attribute Name',
      type: 'text',
      placeholder: 'Enter attribute name',
      description: 'The display name shown in the scoring interface'
    },
    {
      key: 'maxPoints',
      label: 'Max Points',
      type: 'number',
      placeholder: '15',
      description: 'Maximum points this attribute can award'
    },
    // Only show Bonus Points field for positive attributes
    ...(attribute?.category === 'Positive' ? [{
      key: 'bonusPoints',
      label: 'Bonus Points',
      type: 'toggle',
      description: 'Bonus points contribute 25% to scoring denominator instead of 100%.\nUse for nice-to-have qualities that shouldn\'t heavily impact overall scores.',
      icon: '✨'
    }] : []),
    {
      key: 'instructions',
      label: 'Instructions for AI Scoring',
      type: 'textarea',
      placeholder: 'Enter scoring instructions with point ranges...',
      description: 'Core rubric content sent to AI for scoring (most important field)',
      rows: 6
    },
    {
      key: 'minToQualify',
      label: 'Min to Qualify',
      type: 'number',
      placeholder: '0',
      description: 'Minimum points required to qualify for scoring'
    },
    {
      key: 'signals',
      label: 'Detection Keywords',
      type: 'textarea',
      placeholder: 'AI, machine learning, programming, developer...',
      description: 'Keywords that help AI identify when this attribute applies',
      rows: 3
    },
    {
      key: 'examples',
      label: 'Examples',
      type: 'textarea',
      placeholder: 'Example scenarios with point values...',
      description: 'Concrete scoring scenarios that help AI understand nuances',
      rows: 4
    },
    {
      key: 'active',
      label: 'Status',
      type: 'select',
      options: [
        { value: true, label: 'Active' },
        { value: false, label: 'Inactive' }
      ],
      description: 'Whether this attribute is used in scoring'
    }
  ];

  // Initialize field values when attribute changes
  useEffect(() => {
    if (attribute) {
      console.log('AIEditModal: Setting field values for attribute:', attribute);
      setFieldValues({
        heading: (attribute.heading && attribute.heading !== 'null') ? String(attribute.heading) : '',
        maxPoints: (attribute.maxPoints && attribute.maxPoints !== 'null') ? String(attribute.maxPoints) : '',
        bonusPoints: !!attribute.bonusPoints, // Convert to boolean, default false
        instructions: (attribute.instructions && attribute.instructions !== 'null') ? String(attribute.instructions) : '',
        minToQualify: (attribute.minToQualify && attribute.minToQualify !== 'null') ? String(attribute.minToQualify) : '',
        signals: (attribute.signals && attribute.signals !== 'null') ? String(attribute.signals) : '',
        examples: (attribute.examples && attribute.examples !== 'null') ? String(attribute.examples) : '',
        active: attribute.active !== false
      });
      
      // Initialize chat history for each field
      const initialChatHistory = {};
      fields.forEach(field => {
        initialChatHistory[field.key] = [];
      });
      setChatHistory(initialChatHistory);
    }
  }, [attribute]);

  const handleFieldChange = (fieldKey, value) => {
    console.log('AIEditModal: Field change:', fieldKey, 'value:', value, 'type:', typeof value);
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  };

  const handleOpenFieldAI = (fieldKey) => {
    console.log('AIEditModal: Opening AI help for field:', fieldKey);
    setActiveFieldHelper(fieldKey);
    setAiInput('');
    setError(null);
    
    // Get current field value
    const currentValue = fieldValues[fieldKey];
    const hasValue = currentValue && currentValue.trim() !== '' && currentValue !== 'null';
    
    // Create automatic initial message based on field type and state
    let initialMessage;
    
    if (fieldKey === 'heading') {
      if (hasValue) {
        initialMessage = `Current Name: ${currentValue}\n\nWould you like to make a change?`;
      } else {
        initialMessage = "Currently we have no name for this attribute - tell me what you are thinking and I'll give you some ideas to play with.";
      }
    } else if (fieldKey === 'maxPoints') {
      initialMessage = `Max Points determines how important this attribute is compared to others in your scoring system. Higher numbers = more important.

Current Max Points: ${currentValue || '0'}

To change this number, type the new value into the field above. If you need an explanation of how max points works, ask below.`;
    } else if (fieldKey === 'minToQualify') {
      initialMessage = `Profiles with points for this attribute less than your specified minimum will automatically score zero overall.

Current Min to Qualify: ${currentValue || '0'}

To change this number, type the new value into the field above. If you need an explanation of how min to qualify works, ask below.`;
    } else if (fieldKey === 'bonusPoints') {
      const isBonus = currentValue === true;
      initialMessage = `Bonus Points help you reward candidates for great qualities without making them mandatory for high scores.

CURRENT SETTING: ${isBonus ? 'Bonus Points (25% weight)' : 'Standard Points (100% weight)'}

HOW IT WORKS:
• Standard points: Full weight in scoring calculations (100% of denominator)
• Bonus points: Reduced weight in scoring calculations (25% of denominator)

WHEN TO USE BONUS POINTS:
✅ Nice-to-have skills that give candidates an edge
✅ Impressive achievements that aren't core requirements  
✅ Qualities you want to reward but not require

WHEN TO USE STANDARD POINTS:
✅ Core job requirements and essential skills
✅ Must-have qualifications for the role
✅ Critical attributes that heavily influence hiring decisions

To change this setting, simply check or uncheck the box above. Would you like guidance on whether this attribute should be bonus or standard points?`;
    } else if (fieldKey === 'instructions') {
      const hasInstructions = currentValue && currentValue.trim() && currentValue !== 'null';
      
      initialMessage = `I'll help you create scoring instructions for ${attribute.heading || 'this attribute'}.

${hasInstructions ? 'Current instructions are shown above.' : 'No instructions are currently set.'}

Just tell me what you're looking for in candidates and I'll create the scoring breakdown for you.

Examples:
• "I want people with AI experience"  
• "Looking for startup founders"
• "Need someone with Python skills"`;
    } else {
      // Default message for other fields
      if (hasValue) {
        initialMessage = `Current Value: ${currentValue}\n\nWould you like to make a change?`;
      } else {
        initialMessage = "This field is currently empty. Tell me what you'd like to set and I'll help you configure it.";
      }
    }
    
    // Initialize chat history with automatic initial message
    const initialChatHistory = [{
      type: 'assistant',
      message: initialMessage,
      timestamp: new Date().toLocaleTimeString()
    }];
    
    setChatHistory(prev => ({
      ...prev,
      [fieldKey]: initialChatHistory
    }));
  };

  const handleAIHelp = async () => {
    if (!aiInput.trim() || !activeFieldHelper) return;
    
    console.log('AIEditModal: Sending AI help request:', aiInput);
    setIsGenerating(true);
    setError(null);
    
    // Add user message to chat history
    const userMessage = {
      type: 'user',
      message: aiInput,
      timestamp: new Date().toLocaleTimeString()
    };
    
    setChatHistory(prev => ({
      ...prev,
      [activeFieldHelper]: [
        ...(prev[activeFieldHelper] || []),
        userMessage
      ]
    }));
    
    try {
      console.log('AIEditModal: Making real API call...');
      // Strip /api/linkedin suffix like other API calls do
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
      const apiUrl = `${baseUrl}/api/attributes/${attribute.id}/ai-field-help`;
      console.log('API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fieldKey: activeFieldHelper,
          userRequest: aiInput,
          currentValue: fieldValues[activeFieldHelper],
          currentAttribute: fieldValues
        }),
      });
      
      console.log('AIEditModal: Response status:', response.status);
      console.log('AIEditModal: Response ok:', response.ok);
      
      // Check if response is ok before trying to parse JSON
      if (!response.ok) {
        const errorText = await response.text();
        console.log('AIEditModal: Error response text:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      console.log('AIEditModal: API response:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get AI help');
      }
      
      // Add AI response to chat history - with defensive string conversion
      const aiResponse = {
        type: 'ai',
        message: String(result.suggestion || 'No suggestion provided'),
        timestamp: new Date().toLocaleTimeString(),
        suggestedValue: result.suggestedValue // Store the suggested value but don't auto-apply
      };
      
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...(prev[activeFieldHelper] || []),
          aiResponse
        ]
      }));
      
      // Remove automatic field updating - let user choose
      // if (result.suggestedValue !== undefined) {
      //   handleFieldChange(activeFieldHelper, String(result.suggestedValue));
      // }
      
      setAiInput('');
      
    } catch (err) {
      console.error('AIEditModal: Error getting AI help:', err);
      
      // Add error message to chat history
      const errorMessage = {
        type: 'error',
        message: `❌ Failed to get AI help: ${err.message}`,
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...(prev[activeFieldHelper] || []),
          errorMessage
        ]
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // New function to apply AI suggestions
  const handleApplySuggestion = (fieldKey, suggestedValue) => {
    handleFieldChange(fieldKey, String(suggestedValue));
    
    // Add confirmation message to chat
    const confirmationMessage = {
      type: 'system',
      message: '✅ Applied suggestion to field',
      timestamp: new Date().toLocaleTimeString()
    };
    
    setChatHistory(prev => ({
      ...prev,
      [fieldKey]: [
        ...(prev[fieldKey] || []),
        confirmationMessage
      ]
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      
      // Convert fields to proper types
      const updatedData = {
        ...fieldValues,
        maxPoints: fieldValues.maxPoints ? Number(fieldValues.maxPoints) : null,
        minToQualify: fieldValues.minToQualify ? Number(fieldValues.minToQualify) : null
      };
      
      console.log('AIEditModal: Saving data:', updatedData);
      
      if (onSave) {
        await onSave(attribute.id, updatedData);
      }
      
      onClose();
      
    } catch (err) {
      console.error('AIEditModal: Save error:', err);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-6 border w-full max-w-4xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Edit Attribute: {String(attribute?.heading || 'Unnamed')}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        
        <div className="space-y-6">
          {fields.map(field => (
            <div key={field.key} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>
                  <p className="text-xs text-gray-500">{field.description}</p>
                </div>
                <button
                  onClick={() => handleOpenFieldAI(field.key)}
                  className="flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  <SparklesIcon className="h-3 w-3 mr-1" />
                  AI Help
                </button>
              </div>
              
              {field.type === 'text' && (
                <input
                  type="text"
                  value={fieldValues[field.key] || ''}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              
              {field.type === 'number' && (
                <input
                  type="number"
                  value={fieldValues[field.key] || ''}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              
              {field.type === 'textarea' && (
                <textarea
                  value={fieldValues[field.key] || ''}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={field.rows || 3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              
              {field.type === 'select' && (
                <select
                  value={fieldValues[field.key]}
                  onChange={(e) => handleFieldChange(field.key, e.target.value === 'true')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {field.options.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              
              {field.type === 'toggle' && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      {field.icon && <span className="text-lg">{field.icon}</span>}
                      <span className="text-sm font-medium text-gray-900">Scoring Weight</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`text-sm font-medium ${!fieldValues[field.key] ? 'text-blue-600' : 'text-gray-500'}`}>
                        Standard
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFieldChange(field.key, !fieldValues[field.key])}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          fieldValues[field.key] ? 'bg-green-600' : 'bg-blue-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            fieldValues[field.key] ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span className={`text-sm font-medium ${fieldValues[field.key] ? 'text-green-600' : 'text-gray-500'}`}>
                        Bonus
                      </span>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-900 mb-1">
                      {fieldValues[field.key] ? 'Bonus Points (25% weight)' : 'Standard Points (100% weight)'}
                    </p>
                    <p className="text-xs text-gray-600">
                      {fieldValues[field.key] 
                        ? 'This attribute contributes 25% to the scoring denominator - ideal for nice-to-have qualities'
                        : 'This attribute contributes 100% to the scoring denominator - ideal for core requirements'
                      }
                    </p>
                  </div>
                </div>
              )}

              {field.type === 'checkbox' && (
                <div className="flex items-start space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id={`checkbox-${field.key}`}
                      checked={fieldValues[field.key] || false}
                      onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor={`checkbox-${field.key}`} className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                      {field.icon && <span className="mr-1">{field.icon}</span>}
                      {fieldValues[field.key] ? 'Bonus Points (25% weight)' : 'Standard Points (100% weight)'}
                    </label>
                    <p className="text-xs text-gray-600 mt-1">
                      {fieldValues[field.key] 
                        ? 'This attribute will contribute 25% to the scoring denominator - ideal for nice-to-have qualities'
                        : 'This attribute will contribute 100% to the scoring denominator - ideal for core requirements'
                      }
                    </p>
                  </div>
                </div>
              )}
              
              {/* AI Chat for this field */}
              {activeFieldHelper === field.key && (
                <div className="mt-3 p-3 bg-white border rounded">
                  <h4 className="text-sm font-medium mb-2">AI Assistant for {field.label}</h4>
                  
                  {/* Chat history - Show only suggested values, not AI explanations */}
                  {chatHistory[field.key] && chatHistory[field.key].length > 0 && (
                    <div className="mb-3 space-y-2">
                      {chatHistory[field.key].map((message, index) => (
                        <div key={index}>
                          {/* Show user messages */}
                          {message.type === 'user' && (
                            <div className="text-xs p-2 rounded bg-blue-100 mb-2">
                              <span className="font-medium">You:</span> {String(message.message)}
                              <span className="text-gray-500 ml-2">{message.timestamp}</span>
                            </div>
                          )}
                          
                          {/* Show AI assistant messages (initial helpful messages) */}
                          {message.type === 'assistant' && (
                            <div className="text-xs p-3 rounded bg-green-100 border border-green-200 mb-2">
                              <div className="text-green-700 font-medium mb-1">🤖 AI Assistant:</div>
                              <div className="text-green-800 whitespace-pre-line">{String(message.message)}</div>
                              <span className="text-green-600 text-xs mt-1 block">{message.timestamp}</span>
                            </div>
                          )}
                          
                          {/* Show error messages */}
                          {message.type === 'error' && (
                            <div className="text-xs p-2 rounded bg-red-100 mb-2">
                              <span className="font-medium">Error:</span> {String(message.message)}
                              <span className="text-gray-500 ml-2">{message.timestamp}</span>
                            </div>
                          )}
                          
                          {/* Show system messages */}
                          {message.type === 'system' && (
                            <div className="text-xs p-2 rounded bg-gray-100 mb-2">
                              <span className="font-medium">System:</span> {String(message.message)}
                              <span className="text-gray-500 ml-2">{message.timestamp}</span>
                            </div>
                          )}
                          
                          {/* Show AI conversational responses */}
                          {message.type === 'ai' && (
                            <div className="text-xs p-3 rounded bg-blue-100 border border-blue-200 mb-2">
                              <div className="text-blue-700 font-medium mb-1">🤖 AI:</div>
                              <div className="text-blue-800 whitespace-pre-line">{String(message.message)}</div>
                              <span className="text-blue-600 text-xs mt-1 block">{message.timestamp}</span>
                              
                              {/* Show suggested value if present */}
                              {message.suggestedValue !== undefined && message.suggestedValue !== null && (
                                <div className="border border-green-300 rounded p-3 bg-green-50 mt-2">
                                  <div className="text-xs text-green-700 font-medium mb-1">✨ AI Suggestion:</div>
                                  <div className="bg-white p-3 rounded text-xs font-mono h-40 overflow-y-auto mb-2 whitespace-pre-wrap border border-green-200">
                                    {String(message.suggestedValue)}
                                  </div>
                                  <button
                                    onClick={() => handleApplySuggestion(field.key, message.suggestedValue)}
                                    className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                  >
                                    Apply to Field
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* AI input */}
                  <div className="flex space-x-2">
                    <textarea
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                      placeholder={`Ask AI about ${field.label.toLowerCase()}...`}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={5}
                      onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleAIHelp()}
                    />
                    <button
                      onClick={handleAIHelp}
                      disabled={isGenerating || !aiInput.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      {isGenerating ? 'Thinking...' : 'Ask AI'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        
        {/* Bottom buttons */}
        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIEditModal;
