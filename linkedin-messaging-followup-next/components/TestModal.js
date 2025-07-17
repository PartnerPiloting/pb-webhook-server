"use client";
import React, { useState, useEffect } from 'react';

const TestModal = ({ isOpen, onClose, attribute }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState([]);
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);

  // Step 3: Add field-specific handlers (sparkle icon logic)
  const handleOpenFieldAI = (fieldKey) => {
    console.log('TestModal: Opening AI help for field:', fieldKey);
    setActiveFieldHelper(fieldKey);
  };

  const handleFieldChange = (fieldKey, value) => {
    console.log('TestModal: Field change:', fieldKey, 'value:', value, 'type:', typeof value);
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  };

  // Add the useEffect from complex modal
  useEffect(() => {
    if (attribute) {
      console.log('TestModal: Setting field values for attribute:', attribute);
      setFieldValues({
        heading: String(attribute.heading || ''),
        maxPoints: String(attribute.maxPoints || ''),
        instructions: String(attribute.instructions || ''),
        minToQualify: String(attribute.minToQualify || ''),
        signals: String(attribute.signals || ''),
        examples: String(attribute.examples || ''),
        active: attribute.active !== false
      });
    }
  }, [attribute]);

  // Step 2: Add chatHistory state management from complex modal
  useEffect(() => {
    if (isOpen && attribute) {
      console.log('TestModal: Setting up chatHistory for attribute:', attribute.id);
      
      // Initialize with system message like the complex modal
      const systemMessage = {
        role: 'system',
        content: `You are helping to configure a lead scoring attribute: ${String(attribute.heading || 'Unnamed Attribute')}`
      };
      
      console.log('TestModal: Initial chat history:', [systemMessage]);
      setChatHistory([systemMessage]);
    }
  }, [isOpen, attribute]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <h3 className="text-lg font-semibold">Test Modal - Step 3: Add field handlers + sparkle logic</h3>
        <p>ID: {String(attribute?.id || 'N/A')}</p>
        <p>Name: {String(attribute?.heading || 'N/A')}</p>
        <p>Max Points: {String(attribute?.maxPoints || 'N/A')}</p>
        
        <div className="mt-4 p-2 bg-gray-100 rounded">
          <h4 className="font-medium">Field Values State:</h4>
          <p>Heading: {fieldValues.heading}</p>
          <p>Max Points: {fieldValues.maxPoints}</p>
          <p>Active: {String(fieldValues.active)}</p>
        </div>
        
        <div className="mt-4 p-2 bg-blue-100 rounded">
          <h4 className="font-medium">Chat History State:</h4>
          <p>Messages: {chatHistory.length}</p>
          <p>First message: {chatHistory[0]?.content?.substring(0, 50) || 'None'}...</p>
        </div>
        
        <div className="mt-4 p-2 bg-green-100 rounded">
          <h4 className="font-medium">Step 3: Field Helper State:</h4>
          <p>Active Field Helper: {activeFieldHelper || 'None'}</p>
          <button 
            onClick={() => handleOpenFieldAI('heading')}
            className="mt-2 px-2 py-1 bg-purple-500 text-white rounded text-xs"
          >
            ✨ Test Sparkle (Heading)
          </button>
          <button 
            onClick={() => handleOpenFieldAI('active')}
            className="mt-2 ml-2 px-2 py-1 bg-purple-500 text-white rounded text-xs"
          >
            ✨ Test Sparkle (Active)
          </button>
        </div>
        
        <div className="mt-4 p-2 bg-yellow-100 rounded">
          <h4 className="font-medium">Step 3: Test Field Change (Boolean Bug?):</h4>
          <button 
            onClick={() => handleFieldChange('active', true)}
            className="mt-2 px-2 py-1 bg-red-500 text-white rounded text-xs"
          >
            Test Boolean True
          </button>
          <button 
            onClick={() => handleFieldChange('active', false)}
            className="mt-2 ml-2 px-2 py-1 bg-red-500 text-white rounded text-xs"
          >
            Test Boolean False
          </button>
          <button 
            onClick={() => handleFieldChange('active', 'true' === 'true')}
            className="mt-2 ml-2 px-2 py-1 bg-red-500 text-white rounded text-xs"
          >
            Test Boolean Expression
          </button>
        </div>
        
        <button 
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-gray-500 text-white rounded"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default TestModal;
