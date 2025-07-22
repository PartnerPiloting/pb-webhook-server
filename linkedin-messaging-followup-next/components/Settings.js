"use client";
import React, { useState, useEffect } from 'react';
import { getAttributes, saveAttribute, toggleAttributeActive, getTokenUsage } from '../services/api';
import { CogIcon } from '@heroicons/react/24/outline';
import AIEditModal from './AIEditModal';

const Settings = () => {
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  // Phase 2: Add AI modal state
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [selectedAttribute, setSelectedAttribute] = useState(null);

  // Phase 2: AI modal handlers - with debugging
  const handleOpenAIEdit = (attribute) => {
    console.log('=== DEBUGGING CLICK ===');
    console.log('1. Raw attribute:', attribute);
    console.log('2. Attribute type:', typeof attribute);
    console.log('3. Attribute keys:', Object.keys(attribute));
    
    // Check each property
    Object.keys(attribute).forEach(key => {
      console.log(`4. ${key} =`, attribute[key], 'type:', typeof attribute[key]);
    });
    
    try {
      console.log('5. About to set state...');
      setSelectedAttribute(attribute);
      setIsAIModalOpen(true);
      console.log('6. State set successfully!');
    } catch (err) {
      console.error('7. ERROR in handleOpenAIEdit:', err);
      alert('Error: ' + err.message);
    }
  };

  const handleCloseAIModal = () => {
    setIsAIModalOpen(false);
    setSelectedAttribute(null);
  };

  const handleSaveAttribute = async (attributeId, updatedData) => {
    try {
      await saveAttribute(attributeId, updatedData);
      // Reload attributes and token usage to show changes
      const data = await getAttributes();
      setAttributes(data.attributes || []);
      
      // Refresh token usage
      try {
        const tokenData = await getTokenUsage();
        setTokenUsage(tokenData.usage);
      } catch (tokenErr) {
        console.error('Error refreshing token usage:', tokenErr);
      }
    } catch (err) {
      console.error('Error saving attribute:', err);
      throw err;
    }
  };

  const handleToggleActive = async (attributeId, currentActiveStatus) => {
    try {
      const newActiveStatus = !currentActiveStatus;
      await toggleAttributeActive(attributeId, newActiveStatus);
      // Reload attributes and token usage to show changes
      const data = await getAttributes();
      setAttributes(data.attributes || []);
      
      // Refresh token usage
      try {
        const tokenData = await getTokenUsage();
        setTokenUsage(tokenData.usage);
      } catch (tokenErr) {
        console.error('Error refreshing token usage:', tokenErr);
      }
    } catch (err) {
      console.error('Error toggling active status:', err);
      alert('Failed to toggle active status. Please try again.');
    }
  };

  // Phase 1: Load attributes and token usage with bulletproof error handling
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load attributes
        const data = await getAttributes();
        setAttributes(data.attributes || []);
        
        // Load token usage
        try {
          setTokenLoading(true);
          const tokenData = await getTokenUsage();
          setTokenUsage(tokenData.usage);
        } catch (tokenErr) {
          console.error('Error loading token usage:', tokenErr);
          // Don't fail the whole page if token usage fails
        } finally {
          setTokenLoading(false);
        }
        
      } catch (err) {
        const errorMessage = err?.message || 'Failed to load attributes';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Phase 1: Simple loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Loading configuration...</p>
        </div>
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  // Phase 1: Simple error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Error loading configuration</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-red-800 font-medium mb-2">Unable to Load Settings</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Group attributes by category for better organization
  const positiveAttributes = attributes.filter(attr => attr.category === 'Positive');
  const negativeAttributes = attributes.filter(attr => attr.category === 'Negative');

  // Component to render attribute section
  const AttributeSection = ({ title, sectionAttributes, bgColor, textColor }) => (
    <div className="bg-white rounded-lg border border-gray-200 mb-6">
      <div className={`px-6 py-3 border-b border-gray-200 ${bgColor}`}>
        <h3 className={`text-lg font-semibold ${textColor}`}>{title}</h3>
        <p className="text-sm text-gray-600 mt-1">
          {sectionAttributes.length} {title.toLowerCase()} configured
        </p>
      </div>
      
      <div className="divide-y divide-gray-200">
        {sectionAttributes.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No {title.toLowerCase()} found
          </div>
        ) : (
          sectionAttributes.map((attribute) => {
            // Convert everything to strings immediately - no risk of object rendering
            const attributeId = String(attribute.attributeId || '');
            const name = String(attribute.heading || 'Unnamed Attribute');
            const maxPoints = String(attribute.maxPoints || 0);
            const minToQualify = String(attribute.minToQualify || 0);
            const penalty = String(attribute.penalty || 0);
            const isActive = attribute.active !== false;
            const needsSetup = Boolean(attribute.isEmpty);
            const isPositive = attribute.category === 'Positive';
            
            return (
              <div key={attribute.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start space-x-6">
                  {/* Left Column: Attribute ID */}
                  <div className="flex-shrink-0 w-12">
                    <span className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 text-blue-800 text-sm font-bold rounded-full">
                      {attributeId}
                    </span>
                  </div>
                  
                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      <h4 className="text-sm font-medium text-gray-900">{name}</h4>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                      {needsSetup && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Needs Setup
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      {isPositive ? (
                        <>
                          <span>Max Points: {maxPoints}</span>
                          <span>Min to Qualify: {minToQualify}</span>
                        </>
                      ) : (
                        <>
                          <span>Penalty: {penalty}</span>
                          <span>Min to Qualify: {minToQualify}</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Right Column: Toggle Active + Edit Button */}
                  <div className="flex-shrink-0 flex items-center space-x-2">
                    {/* Active/Inactive Toggle */}
                    <button 
                      className={`inline-flex items-center px-3 py-1.5 border text-xs font-medium rounded transition-colors ${
                        isActive 
                          ? 'border-green-600 text-green-700 bg-green-50 hover:bg-green-100' 
                          : 'border-gray-300 text-gray-600 bg-gray-50 hover:bg-gray-100'
                      }`}
                      onClick={() => handleToggleActive(attribute.id, isActive)}
                      title={isActive ? 'Click to deactivate' : 'Click to activate'}
                    >
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        isActive ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                      {isActive ? 'Active' : 'Inactive'}
                    </button>
                    
                    {/* Edit Button */}
                    <button 
                      className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                      onClick={() => handleOpenAIEdit(attribute)}
                    >
                      <CogIcon className="h-3 w-3 mr-1" />
                      Edit with AI
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // Phase 1: Simple attribute list with improved UX
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure your lead scoring system
        </p>
      </div>

      {/* Token Usage Display */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <CogIcon className="h-5 w-5 text-gray-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Token Usage</h3>
              {tokenLoading ? (
                <p className="text-sm text-gray-500">Loading usage...</p>
              ) : tokenUsage ? (
                <div className="flex items-center space-x-4">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">
                      {tokenUsage.totalTokens?.toLocaleString() || '0'}
                    </span>
                    {' of '}
                    <span className="font-semibold">
                      {tokenUsage.limit?.toLocaleString() || '15,000'}
                    </span>
                    {' tokens used'}
                  </p>
                  <div className="flex-1 max-w-xs">
                    <div className="bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${
                          tokenUsage.percentUsed >= 90 ? 'bg-red-500' :
                          tokenUsage.percentUsed >= 75 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(tokenUsage.percentUsed || 0, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className={`text-xs font-medium ${
                    tokenUsage.percentUsed >= 90 ? 'text-red-600' :
                    tokenUsage.percentUsed >= 75 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {tokenUsage.percentUsed || 0}%
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Token usage unavailable</p>
              )}
            </div>
          </div>
          {tokenUsage && tokenUsage.percentUsed >= 90 && (
            <div className="text-right">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                Budget Nearly Full
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Centered container with narrower width */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          {attributes.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 px-6 py-8 text-center text-gray-500">
              No attributes found
            </div>
          ) : (
            <>
              {/* Positive Attributes Section */}
              <AttributeSection 
                title="Positive Attributes" 
                sectionAttributes={positiveAttributes}
                bgColor="bg-green-50"
                textColor="text-green-800"
              />
              
              {/* Negative Attributes Section */}
              <AttributeSection 
                title="Negative Attributes" 
                sectionAttributes={negativeAttributes}
                bgColor="bg-red-50"
                textColor="text-red-800"
              />
            </>
          )}
        </div>
      </div>

      {/* New AIEditModal - converted from working TestModal */}
      {selectedAttribute && (
        <AIEditModal
          isOpen={isAIModalOpen}
          onClose={handleCloseAIModal}
          attribute={selectedAttribute}
          onSave={handleSaveAttribute}
        />
      )}
    </div>
  );
};

export default Settings;
