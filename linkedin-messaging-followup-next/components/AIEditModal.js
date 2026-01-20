"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from '../utils/clientUtils';

const AIEditModal = ({ isOpen, onClose, attribute, onSave }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState({});
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Completely separate field definitions for profile vs post scoring
  const isPostAttribute = attribute?.isPostAttribute === true;
  
  // Profile Scoring Fields - Complex scoring system with bonuses, qualifications, etc.
  const profileFields = [
    {
      key: 'heading',
      label: 'Attribute Name',
      type: 'text',
      placeholder: 'Enter attribute name',
      description: 'The display name shown in the profile scoring interface'
    },
    {
      key: 'maxPoints',
      label: 'Max Points',
      type: 'number',
      placeholder: '15',
      description: 'Maximum points this attribute can award'
    },
    // Only show Bonus Points field for positive profile attributes
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
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' }
      ],
      description: 'Whether this attribute is used in profile scoring'
    }
  ];

  // Post Scoring Fields - Rich fields matching Airtable structure
  const postFields = [
    {
      key: 'heading',
      label: 'Criterion Name',
      type: 'text',
      placeholder: 'Enter criterion name',
      description: 'The display name shown in the post scoring interface'
    },
    {
      key: 'maxPoints',
      label: 'Max Points',
      type: 'number',
      placeholder: '20',
      description: 'Maximum points this criterion can award'
    },
    {
      key: 'scoringType',
      label: 'Scoring Type',
      type: 'select',
      options: [
        { value: 'Scale', label: 'Scale - AI assigns 0 to Max Score based on degree of match' },
        { value: 'Fixed Penalty', label: 'Fixed Penalty - All-or-nothing negative score application' },
        { value: 'Fixed Bonus', label: 'Fixed Bonus - All-or-nothing positive score application' }
      ],
      description: 'How the AI should apply scoring for this criterion'
    },
    {
      key: 'instructions',
      label: 'Scoring Instructions',
      type: 'textarea',
      placeholder: 'Enter detailed scoring rubric and guidelines...',
      description: 'Core rubric content sent to AI for post scoring (most important field)',
      rows: 6
    },
    {
      key: 'positiveIndicators',
      label: 'Keywords/Positive Indicators',
      type: 'textarea',
      placeholder: 'startup, innovation, growth, technology, leadership...',
      description: 'Keywords and phrases that should increase the score for this criterion',
      rows: 4
    },
    {
      key: 'negativeIndicators',
      label: 'Keywords/Negative Indicators',
      type: 'textarea',
      placeholder: 'spam, off-topic, irrelevant, promotional...',
      description: 'Keywords and phrases that should decrease the score for this criterion',
      rows: 4
    },
    {
      key: 'highScoreExample',
      label: 'High Score Example',
      type: 'textarea',
      placeholder: 'Example of a post that would score high on this criterion...',
      description: 'Concrete example of content that exemplifies a high score',
      rows: 4
    },
    {
      key: 'lowScoreExample',
      label: 'Low Score Example',
      type: 'textarea',
      placeholder: 'Example of a post that would score low on this criterion...',
      description: 'Concrete example of content that exemplifies a low score',
      rows: 4
    },
    {
      key: 'active',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' }
      ],
      description: 'Whether this criterion is used in post scoring'
    }
  ];

  // Use the appropriate field set based on attribute type
  const fields = isPostAttribute ? postFields : profileFields;

  // Initialize field values when attribute changes
  useEffect(() => {
    if (attribute) {
      console.log('AIEditModal: Setting field values for attribute:', attribute);
      
      if (attribute.isPostAttribute) {
        // Post Scoring Criteria - using rich Airtable fields
        setFieldValues({
          heading: (attribute.heading && attribute.heading !== 'null') ? String(attribute.heading) : '',
          maxPoints: (attribute.maxPoints && attribute.maxPoints !== 'null') ? String(attribute.maxPoints) : '',
          scoringType: (attribute.scoringType && attribute.scoringType !== 'null') ? String(attribute.scoringType) : 'Scale',
          instructions: (attribute.instructions && attribute.instructions !== 'null') ? String(attribute.instructions) : '',
          positiveIndicators: (attribute.positiveIndicators && attribute.positiveIndicators !== 'null') ? String(attribute.positiveIndicators) : '',
          negativeIndicators: (attribute.negativeIndicators && attribute.negativeIndicators !== 'null') ? String(attribute.negativeIndicators) : '',
          highScoreExample: (attribute.highScoreExample && attribute.highScoreExample !== 'null') ? String(attribute.highScoreExample) : '',
          lowScoreExample: (attribute.lowScoreExample && attribute.lowScoreExample !== 'null') ? String(attribute.lowScoreExample) : '',
          active: Boolean(attribute.active)
        });
      } else {
        // Profile Scoring Attributes - traditional complex scoring
        setFieldValues({
          heading: (attribute.heading && attribute.heading !== 'null') ? String(attribute.heading) : '',
          maxPoints: (attribute.maxPoints && attribute.maxPoints !== 'null') ? String(attribute.maxPoints) : '',
          bonusPoints: !!attribute.bonusPoints,
          instructions: (attribute.instructions && attribute.instructions !== 'null') ? String(attribute.instructions) : '',
          minToQualify: (attribute.minToQualify && attribute.minToQualify !== 'null') ? String(attribute.minToQualify) : '',
          signals: (attribute.signals && attribute.signals !== 'null') ? String(attribute.signals) : '',
          examples: (attribute.examples && attribute.examples !== 'null') ? String(attribute.examples) : '',
          active: Boolean(attribute.active)
        });
      }
      
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
    } else if (fieldKey === 'scoringType') {
      const currentType = currentValue || 'Scale';
      initialMessage = `I'll explain the scoring types available for ${attribute.heading || 'this criterion'}.

CURRENT SETTING: ${currentType}

🎯 **SCALE SCORING** (Recommended for most criteria)
• AI assigns 0 to Max Score based on degree of match
• Flexible scoring where partial matches get partial points
• Example: Post mentioning AI gets 8/20, post strongly advocating for AI gets 18/20
• Best for: Most content evaluation scenarios

⚠️ **FIXED PENALTY** (All-or-nothing negative)
• Full negative score applied when criterion is clearly met
• No partial scoring - either 0 or full penalty
• Example: Spam content = full -10 points, not spam = 0 points
• Best for: Clear violations or unwanted content

✅ **FIXED BONUS** (All-or-nothing positive)
• Full positive score applied when criterion is clearly met
• No partial scoring - either 0 or full bonus
• Example: Mentions specific keyword = full +15 points, doesn't mention = 0 points
• Best for: Specific requirements or rare positive indicators

You can't change this value directly, but I can help you understand which type would work best for your criterion. What type of content evaluation are you trying to achieve?`;
    } else if (fieldKey === 'instructions') {
      const hasInstructions = currentValue && currentValue.trim() && currentValue !== 'null';
      
      if (isPostAttribute) {
        initialMessage = `I'll help you create scoring instructions for ${attribute.heading || 'this post criterion'}.

${hasInstructions ? 'Current instructions are shown above.' : 'No instructions are currently set.'}

Just tell me what you're looking for in posts and I'll create the scoring breakdown for you.

Examples:
• "I want posts about AI and technology"  
• "Looking for thought leadership content"
• "Need posts about startup growth"`;
      } else {
        initialMessage = `I'll help you create scoring instructions for ${attribute.heading || 'this attribute'}.

${hasInstructions ? 'Current instructions are shown above.' : 'No instructions are currently set.'}

Just tell me what you're looking for in candidates and I'll create the scoring breakdown for you.

Examples:
• "I want people with AI experience"  
• "Looking for startup founders"
• "Need someone with Python skills"`;
      }
    } else if (fieldKey === 'positiveIndicators') {
      const hasValue = currentValue && currentValue.trim() && currentValue !== 'null';
      initialMessage = `I'll help you identify positive keywords and indicators for ${attribute.heading || 'this criterion'}.

${hasValue ? 'Current positive indicators are shown above.' : 'No positive indicators are currently set.'}

Tell me what type of content you want to score highly and I'll suggest keywords and phrases to look for.

Examples:
• "Posts about innovation and startups"
• "Content showing industry expertise"  
• "Thought leadership and insights"`;
    } else if (fieldKey === 'negativeIndicators') {
      const hasValue = currentValue && currentValue.trim() && currentValue !== 'null';
      initialMessage = `I'll help you identify negative keywords and indicators for ${attribute.heading || 'this criterion'}.

${hasValue ? 'Current negative indicators are shown above.' : 'No negative indicators are currently set.'}

Tell me what type of content should score poorly and I'll suggest keywords and phrases to watch for.

Examples:
• "Spam or promotional content"
• "Off-topic or irrelevant posts"
• "Low-quality or generic content"`;
    } else if (fieldKey === 'highScoreExample') {
      const hasValue = currentValue && currentValue.trim() && currentValue !== 'null';
      initialMessage = `I'll help you create a high-scoring example for ${attribute.heading || 'this criterion'}.

${hasValue ? 'Current example is shown above.' : 'No high-score example is currently set.'}

Describe the type of post content that should score highly, and I'll create a realistic example.

Examples:
• "A post about successful startup funding"
• "Thought leadership about industry trends"
• "Technical insights about AI development"`;
    } else if (fieldKey === 'lowScoreExample') {
      const hasValue = currentValue && currentValue.trim() && currentValue !== 'null';
      initialMessage = `I'll help you create a low-scoring example for ${attribute.heading || 'this criterion'}.

${hasValue ? 'Current example is shown above.' : 'No low-score example is currently set.'}

Describe the type of post content that should score poorly, and I'll create a realistic example.

Examples:
• "Generic promotional content"
• "Off-topic or irrelevant posts"
• "Low-quality or spammy content"`;
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
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server-hotfix.onrender.com';
      const apiUrl = `${baseUrl}/api/attributes/${attribute.id}/ai-field-help`;
      console.log('API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': getCurrentClientId(),
          ...(getCurrentPortalToken() && { 'x-portal-token': getCurrentPortalToken() }),
          ...(getCurrentDevKey() && { 'x-dev-key': getCurrentDevKey() }),
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
      
      // Create update data based on attribute type
      let updatedData;
      
      if (attribute.isPostAttribute) {
        // Post Scoring Criteria - using rich Airtable fields
        updatedData = {
          heading: fieldValues.heading,
          maxPoints: fieldValues.maxPoints ? Number(fieldValues.maxPoints) : null,
          scoringType: fieldValues.scoringType,
          instructions: fieldValues.instructions,
          positiveIndicators: fieldValues.positiveIndicators,
          negativeIndicators: fieldValues.negativeIndicators,
          highScoreExample: fieldValues.highScoreExample,
          lowScoreExample: fieldValues.lowScoreExample,
          active: fieldValues.active
        };
      } else {
        // Profile Scoring Attributes - traditional field set
        updatedData = {
          heading: fieldValues.heading,
          maxPoints: fieldValues.maxPoints ? Number(fieldValues.maxPoints) : null,
          bonusPoints: fieldValues.bonusPoints,
          instructions: fieldValues.instructions,
          minToQualify: fieldValues.minToQualify ? Number(fieldValues.minToQualify) : null,
          signals: fieldValues.signals,
          examples: fieldValues.examples,
          active: fieldValues.active
        };
      }
      
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
          <h3 className="text-lg font-semibold">
            Edit {isPostAttribute ? 'Criterion' : 'Attribute'}: {String(attribute?.heading || 'Unnamed')}
          </h3>
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
                  value={field.key === 'active' ? String(fieldValues[field.key]) : (fieldValues[field.key] || '')}
                  onChange={(e) => {
                    // Handle different value types properly
                    if (field.key === 'active') {
                      handleFieldChange(field.key, e.target.value === 'true');
                    } else {
                      handleFieldChange(field.key, e.target.value);
                    }
                  }}
                  aria-label={field.label}
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
