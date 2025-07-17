"use client";
import React, { useState, useEffect } from 'react';
import { getAttributes, saveAttribute } from '../services/api';
import { CogIcon } from '@heroicons/react/24/outline';
import TestModal from './TestModal';
import AIEditModal from './AIEditModal';

const Settings = () => {
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
      // Reload attributes to show changes
      const data = await getAttributes();
      setAttributes(data.attributes || []);
    } catch (err) {
      console.error('Error saving attribute:', err);
      throw err;
    }
  };

  // Phase 1: Load attributes with bulletproof error handling
  useEffect(() => {
    const loadAttributes = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getAttributes();
        setAttributes(data.attributes || []);
      } catch (err) {
        const errorMessage = err?.message || 'Failed to load attributes';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadAttributes();
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

  // Phase 1: Simple attribute list - no complex logic
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure your lead scoring system
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Lead Scoring Attributes</h3>
          <p className="text-sm text-gray-500 mt-1">
            {attributes.length} attributes configured
          </p>
        </div>
        
        <div className="divide-y divide-gray-200 max-w-4xl">
          {attributes.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No attributes found
            </div>
          ) : (
            attributes.map((attribute) => {
              // Phase 1: Convert everything to strings immediately - no risk of object rendering
              const name = String(attribute.heading || 'Unnamed Attribute');
              const maxPoints = String(attribute.maxPoints || 0);
              const minToQualify = String(attribute.minToQualify || 0);
              const category = String(attribute.category || 'uncategorized');
              const isActive = attribute.active !== false;
              const needsSetup = Boolean(attribute.isEmpty);
              
              return (
                <div key={attribute.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start space-x-4">
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
                        <span>Max Points: {maxPoints}</span>
                        <span>Min to Qualify: {minToQualify}</span>
                        <span className="capitalize">{category}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
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
