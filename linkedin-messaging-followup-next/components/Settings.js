"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getAttributes, saveAttribute, toggleAttributeActive, getTokenUsage, getPostAttributes, getPostAttributeForEditing, getPostAISuggestions, savePostAttributeChanges, togglePostAttributeActive } from '../services/api';
import { CogIcon, UserGroupIcon, DocumentTextIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import AIEditModal from './AIEditModal';

// Component that uses useSearchParams wrapped in Suspense
const SettingsWithParams = () => {
  const searchParams = useSearchParams();
  // Get service level from URL parameters (level=1 basic, level=2 includes post scoring)
  const serviceLevel = parseInt(searchParams.get('level') || '2');
  
  // State for which settings section to show
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'profile', 'posts'
  
  const [attributes, setAttributes] = useState([]);
  const [postAttributes, setPostAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [postLoading, setPostLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  // Phase 2: Add AI modal state
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [selectedAttribute, setSelectedAttribute] = useState(null);

  // Set initial view based on service level
  useEffect(() => {
    if (serviceLevel === 1) {
      // Service level 1 goes directly to profile attributes
      setCurrentView('profile');
    } else {
      // Service level 2+ shows the menu
      setCurrentView('menu');
    }
  }, [serviceLevel]);
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

  // Navigation handlers
  const handleBackToMenu = () => {
    setCurrentView('menu');
  };

  const handleViewProfileAttributes = () => {
    setCurrentView('profile');
  };

  const handleViewPostAttributes = () => {
    setCurrentView('posts');
  };

  // Helper function to get scoring type explanations
  const getScoringTypeExplanation = (scoringType) => {
    switch (scoringType) {
      case 'Scale':
        return 'AI assigns 0 to Max Score based on degree of match - flexible scoring where partial matches get partial points';
      case 'Fixed Penalty':
        return 'All-or-nothing application of negative Max Score - if criterion is met, full penalty is applied';
      case 'Fixed Bonus':
        return 'All-or-nothing application of positive Max Score - if criterion is met, full bonus is applied';
      default:
        return 'Click to see scoring type details';
    }
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

  // Post attribute handlers
  const handleEditPostAttribute = async (attribute) => {
    try {
      const editData = await getPostAttributeForEditing(attribute.id);
      setSelectedAttribute({
        ...attribute,
        ...editData,
        isPostAttribute: true
      });
      setIsAIModalOpen(true);
    } catch (err) {
      console.error('Error loading post attribute for editing:', err);
      alert('Failed to load post attribute for editing. Please try again.');
    }
  };

  const handleSavePostAttribute = async (attributeId, updatedData) => {
    try {
      await savePostAttributeChanges(attributeId, updatedData);
      // Reload post attributes
      await loadPostAttributes();
      
      // Refresh token usage
      try {
        const tokenData = await getTokenUsage();
        setTokenUsage(tokenData.usage);
      } catch (tokenErr) {
        console.error('Error refreshing token usage:', tokenErr);
      }
    } catch (err) {
      console.error('Error saving post attribute:', err);
      throw err;
    }
  };

  const handleTogglePostAttributeActive = async (attributeId, currentActiveStatus) => {
    try {
      const newActiveStatus = !currentActiveStatus;
      await togglePostAttributeActive(attributeId, newActiveStatus);
      // Reload post attributes
      await loadPostAttributes();
      
      // Refresh token usage
      try {
        const tokenData = await getTokenUsage();
        setTokenUsage(tokenData.usage);
      } catch (tokenErr) {
        console.error('Error refreshing token usage:', tokenErr);
      }
    } catch (err) {
      console.error('Error toggling post active status:', err);
      alert('Failed to toggle post active status. Please try again.');
    }
  };

  const loadPostAttributes = async () => {
    try {
      setPostLoading(true);
      console.log('🔍 Loading post attributes...');
      const data = await getPostAttributes();
      console.log('📋 Post attributes data received:', data);
      setPostAttributes(data.attributes || []);
      console.log('✅ Post attributes set to state:', data.attributes || []);
    } catch (err) {
      console.error('❌ Error loading post attributes:', err);
      console.error('❌ Error details:', err.message);
    } finally {
      setPostLoading(false);
    }
  };

  // Phase 1: Load attributes and token usage with bulletproof error handling
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load profile attributes
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

  // Load post attributes when switching to posts view
  useEffect(() => {
    if (currentView === 'posts') {
      loadPostAttributes();
    }
  }, [currentView]);

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

  // Group post attributes by category
  const positivePostAttributes = postAttributes.filter(attr => attr.category === 'Positive');
  const negativePostAttributes = postAttributes.filter(attr => attr.category === 'Negative');

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

  // Component to render post criteria section  
  const PostCriteriaSection = ({ title, sectionAttributes, bgColor, textColor }) => (
    <div className="bg-white rounded-lg border border-gray-200 mb-6">
      <div className={`px-6 py-3 border-b border-gray-200 ${bgColor}`}>
        <h3 className={`text-lg font-semibold ${textColor}`}>{title}</h3>
        <p className="text-sm text-gray-600 mt-1">
          {sectionAttributes.length} {title.toLowerCase().replace('attributes', 'criteria')} configured
        </p>
      </div>
      
      <div className="divide-y divide-gray-200">
        {sectionAttributes.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No {title.toLowerCase().replace('attributes', 'criteria')} found
          </div>
        ) : (
          sectionAttributes.map((attribute) => {
            // Convert everything to strings immediately - no risk of object rendering
            const attributeId = String(attribute.attributeId || '');
            const name = String(attribute.heading || 'Unnamed Criterion');
            const maxPoints = String(attribute.maxPoints || 0);
            const scoringType = String(attribute.scoringType || 'N/A');
            const positiveIndicators = String(attribute.positiveIndicators || '');
            const negativeIndicators = String(attribute.negativeIndicators || '');
            const highScoreExample = String(attribute.highScoreExample || '');
            const lowScoreExample = String(attribute.lowScoreExample || '');
            const instructions = String(attribute.instructions || '');
            const isActive = attribute.active !== false;
            const needsSetup = Boolean(attribute.isEmpty);
            const isPositive = attribute.category === 'Positive';
            
            return (
              <div key={attribute.id} className="px-6 py-6 hover:bg-gray-50">
                <div className="flex items-start space-x-4">
                  {/* Left Column: Criterion ID */}
                  <div className="flex-shrink-0 w-16">
                    <div className="inline-flex items-center justify-center w-14 h-14 bg-purple-100 text-purple-800 text-lg font-bold rounded-full">
                      {attributeId}
                    </div>
                  </div>
                  
                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start space-x-3 mb-3">
                      <h4 className="text-sm font-medium text-gray-900 leading-relaxed">{name}</h4>
                      <div className="flex-shrink-0 flex items-center space-x-2">
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
                    </div>
                    
                    {/* Scoring Details */}
                    <div className="flex items-center space-x-4 text-sm text-gray-500 mb-4">
                      <span>Max Points: {maxPoints}</span>
                      <span title={getScoringTypeExplanation(scoringType)}>
                        Scoring Type: {scoringType}
                      </span>
                    </div>

                    {/* Keywords and Examples Section */}
                    <div className="space-y-3">
                      {/* Instructions/Rubric */}
                      {instructions && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 mb-1">Scoring Instructions:</h5>
                          <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                            {instructions.length > 150 ? `${instructions.substring(0, 150)}...` : instructions}
                          </p>
                        </div>
                      )}

                      {/* Positive Indicators */}
                      {positiveIndicators && (
                        <div>
                          <h5 className="text-xs font-medium text-green-700 mb-1">Keywords/Positive Indicators:</h5>
                          <p className="text-xs text-gray-600 bg-green-50 p-2 rounded">
                            {positiveIndicators.length > 150 ? `${positiveIndicators.substring(0, 150)}...` : positiveIndicators}
                          </p>
                        </div>
                      )}

                      {/* Negative Indicators */}
                      {negativeIndicators && (
                        <div>
                          <h5 className="text-xs font-medium text-red-700 mb-1">Keywords/Negative Indicators:</h5>
                          <p className="text-xs text-gray-600 bg-red-50 p-2 rounded">
                            {negativeIndicators.length > 150 ? `${negativeIndicators.substring(0, 150)}...` : negativeIndicators}
                          </p>
                        </div>
                      )}

                      {/* Examples Row */}
                      {(highScoreExample || lowScoreExample) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* High Score Example */}
                          {highScoreExample && (
                            <div>
                              <h5 className="text-xs font-medium text-blue-700 mb-1">Example - High Score:</h5>
                              <p className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                                {highScoreExample.length > 100 ? `${highScoreExample.substring(0, 100)}...` : highScoreExample}
                              </p>
                            </div>
                          )}

                          {/* Low Score Example */}
                          {lowScoreExample && (
                            <div>
                              <h5 className="text-xs font-medium text-gray-700 mb-1">Example - Low Score:</h5>
                              <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                {lowScoreExample.length > 100 ? `${lowScoreExample.substring(0, 100)}...` : lowScoreExample}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Right Column: Toggle Active + Edit Button */}
                  <div className="flex-shrink-0 flex flex-col items-end space-y-2">
                    {/* Active/Inactive Toggle */}
                    <button 
                      className={`inline-flex items-center px-3 py-1.5 border text-xs font-medium rounded transition-colors ${
                        isActive 
                          ? 'border-green-600 text-green-700 bg-green-50 hover:bg-green-100' 
                          : 'border-gray-300 text-gray-600 bg-gray-50 hover:bg-gray-100'
                      }`}
                      onClick={() => handleTogglePostAttributeActive(attribute.id, isActive)}
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
                      onClick={() => handleEditPostAttribute(attribute)}
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

  // Render different views based on current view and service level
  if (currentView === 'menu' && serviceLevel >= 2) {
    // Main settings menu for service level 2+
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure your lead scoring system
          </p>
        </div>

        {/* Settings Options */}
        <div className="flex justify-center">
          <div className="w-full max-w-2xl">
            <div className="grid gap-6 md:grid-cols-2">
              
              {/* LinkedIn Profile Scoring Attributes */}
              <div 
                className="bg-white rounded-lg border border-gray-200 p-6 hover:border-blue-300 cursor-pointer transition-colors"
                onClick={handleViewProfileAttributes}
              >
                <div className="flex items-center space-x-3 mb-4">
                  <div className="flex-shrink-0">
                    <UserGroupIcon className="h-8 w-8 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      LinkedIn Profile Scoring Attributes
                    </h3>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  Configure how AI scores LinkedIn profiles based on experience, skills, and background.
                </p>
                <div className="flex items-center text-sm text-blue-600 font-medium">
                  Configure Profile Scoring →
                </div>
              </div>

              {/* LinkedIn Post Scoring Criteria */}
              <div 
                className="bg-white rounded-lg border border-gray-200 p-6 hover:border-blue-300 cursor-pointer transition-colors"
                onClick={handleViewPostAttributes}
              >
                <div className="flex items-center space-x-3 mb-4">
                  <div className="flex-shrink-0">
                    <DocumentTextIcon className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      LinkedIn Post Scoring Criteria
                    </h3>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  Configure how AI scores LinkedIn posts for relevance and engagement opportunities.
                </p>
                <div className="flex items-center text-sm text-green-600 font-medium">
                  Configure Post Scoring →
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Token Usage Display - Centered */}
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <CogIcon className="h-5 w-5 text-gray-400" />
                  <h3 className="text-sm font-medium text-gray-900">Token Usage</h3>
                </div>
                {tokenLoading ? (
                  <p className="text-sm text-gray-500">Loading usage...</p>
                ) : tokenUsage ? (
                  <div className="space-y-3">
                    <p className="text-lg font-semibold text-gray-900">
                      {tokenUsage.totalTokens?.toLocaleString() || '0'}
                      <span className="text-sm font-normal text-gray-600 mx-1">of</span>
                      {tokenUsage.limit?.toLocaleString() || '15,000'}
                      <span className="text-sm font-normal text-gray-600 ml-1">tokens used</span>
                    </p>
                    <div className="w-full">
                      <div className="bg-gray-200 rounded-full h-2.5">
                        <div 
                          className={`h-2.5 rounded-full transition-all duration-300 ${
                            tokenUsage.percentUsed >= 90 ? 'bg-red-500' :
                            tokenUsage.percentUsed >= 75 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(tokenUsage.percentUsed || 0, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-center space-x-2">
                      <span className={`text-sm font-medium ${
                        tokenUsage.percentUsed >= 90 ? 'text-red-600' :
                        tokenUsage.percentUsed >= 75 ? 'text-yellow-600' : 'text-green-600'
                      }`}>
                        {tokenUsage.percentUsed || 0}% used
                      </span>
                      {tokenUsage && tokenUsage.percentUsed >= 90 && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Budget Nearly Full
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Token usage unavailable</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Profile attributes view (for both service levels) or posts view
  const isProfileView = currentView === 'profile';
  const isPostsView = currentView === 'posts';
  const viewTitle = isProfileView ? 'LinkedIn Profile Scoring Attributes' : 'LinkedIn Post Scoring Criteria';
  const viewDescription = isProfileView 
    ? 'Configure how AI scores LinkedIn profiles' 
    : 'Configure how AI scores LinkedIn posts';

  // Phase 1: Simple attribute list with improved UX
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center space-x-3">
          {/* Back button for service level 2+ */}
          {serviceLevel >= 2 && (
            <button
              onClick={handleBackToMenu}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-1" />
              Back to Settings
            </button>
          )}
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{viewTitle}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {viewDescription}
            </p>
          </div>
        </div>
      </div>

      {/* Token Usage Display - Centered */}
      <div className="flex justify-center">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-center">
              <div className="flex items-center justify-center space-x-2 mb-3">
                <CogIcon className="h-5 w-5 text-gray-400" />
                <h3 className="text-sm font-medium text-gray-900">Token Usage</h3>
              </div>
              {tokenLoading ? (
                <p className="text-sm text-gray-500">Loading usage...</p>
              ) : tokenUsage ? (
                <div className="space-y-3">
                  <p className="text-lg font-semibold text-gray-900">
                    {tokenUsage.totalTokens?.toLocaleString() || '0'}
                    <span className="text-sm font-normal text-gray-600 mx-1">of</span>
                    {tokenUsage.limit?.toLocaleString() || '15,000'}
                    <span className="text-sm font-normal text-gray-600 ml-1">tokens used</span>
                  </p>
                  <div className="w-full">
                    <div className="bg-gray-200 rounded-full h-2.5">
                      <div 
                        className={`h-2.5 rounded-full transition-all duration-300 ${
                          tokenUsage.percentUsed >= 90 ? 'bg-red-500' :
                          tokenUsage.percentUsed >= 75 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(tokenUsage.percentUsed || 0, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center space-x-2">
                    <span className={`text-sm font-medium ${
                      tokenUsage.percentUsed >= 90 ? 'text-red-600' :
                      tokenUsage.percentUsed >= 75 ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {tokenUsage.percentUsed || 0}% used
                    </span>
                    {tokenUsage && tokenUsage.percentUsed >= 90 && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Budget Nearly Full
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Token usage unavailable</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Show different content based on view */}
      {isPostsView ? (
        // Post scoring attributes view
        <div className="flex justify-center">
          <div className="w-full max-w-3xl">
            {postLoading ? (
              <div className="bg-white rounded-lg border border-gray-200 px-6 py-8 text-center">
                <p className="text-gray-500">Loading post criteria...</p>
              </div>
            ) : postAttributes.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 px-6 py-8 text-center text-gray-500">
                No post criteria found
              </div>
            ) : (
              <>
                {/* Positive Post Criteria Section */}
                <PostCriteriaSection 
                  title="Positive Criteria" 
                  sectionAttributes={positivePostAttributes}
                  bgColor="bg-green-50"
                  textColor="text-green-800"
                />
                
                {/* Negative Post Criteria Section */}
                <PostCriteriaSection 
                  title="Negative Criteria" 
                  sectionAttributes={negativePostAttributes}
                  bgColor="bg-red-50"
                  textColor="text-red-800"
                />
              </>
            )}
          </div>
        </div>
      ) : (
        // Profile attributes view (existing functionality)
        <>
          {/* Token Usage Display - Centered */}
          <div className="flex justify-center">
            <div className="w-full max-w-md">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-center">
                  <div className="flex items-center justify-center space-x-2 mb-3">
                    <CogIcon className="h-5 w-5 text-gray-400" />
                    <h3 className="text-sm font-medium text-gray-900">Token Usage</h3>
                  </div>
                  {tokenLoading ? (
                    <p className="text-sm text-gray-500">Loading usage...</p>
                  ) : tokenUsage ? (
                    <div className="space-y-3">
                      <p className="text-lg font-semibold text-gray-900">
                        {tokenUsage.totalTokens?.toLocaleString() || '0'}
                        <span className="text-sm font-normal text-gray-600 mx-1">of</span>
                        {tokenUsage.limit?.toLocaleString() || '15,000'}
                        <span className="text-sm font-normal text-gray-600 ml-1">tokens used</span>
                      </p>
                      <div className="w-full">
                        <div className="bg-gray-200 rounded-full h-2.5">
                          <div 
                            className={`h-2.5 rounded-full transition-all duration-300 ${
                              tokenUsage.percentUsed >= 90 ? 'bg-red-500' :
                              tokenUsage.percentUsed >= 75 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(tokenUsage.percentUsed || 0, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <span className={`text-sm font-medium ${
                          tokenUsage.percentUsed >= 90 ? 'text-red-600' :
                          tokenUsage.percentUsed >= 75 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {tokenUsage.percentUsed || 0}% used
                        </span>
                        {tokenUsage && tokenUsage.percentUsed >= 90 && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Budget Nearly Full
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Token usage unavailable</p>
                  )}
                </div>
              </div>
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
        </>
      )}

      {/* New AIEditModal - converted from working TestModal */}
      {selectedAttribute && (
        <AIEditModal
          isOpen={isAIModalOpen}
          onClose={handleCloseAIModal}
          attribute={selectedAttribute}
          onSave={selectedAttribute.isPostAttribute ? handleSavePostAttribute : handleSaveAttribute}
        />
      )}
    </div>
  );
};

// Main Settings component with Suspense wrapper
const Settings = () => {
  return (
    <Suspense fallback={<div>Loading settings...</div>}>
      <SettingsWithParams />
    </Suspense>
  );
};

export default Settings;
