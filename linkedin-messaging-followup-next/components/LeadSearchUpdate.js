"use client";
import React, { useState, useEffect } from 'react';
import { searchLeads } from '../services/api';

// Let's add back the icons first with logging
console.log('🔍 LeadSearchUpdate: Starting to import icons...');
let MagnifyingGlassIcon, UserIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  MagnifyingGlassIcon = icons.MagnifyingGlassIcon;
  UserIcon = icons.UserIcon;
  console.log('✅ Icons imported successfully:', { MagnifyingGlassIcon: !!MagnifyingGlassIcon, UserIcon: !!UserIcon });
} catch (error) {
  console.error('❌ Failed to import icons:', error);
}

const LeadSearchUpdate = () => {
  console.log('🚀 LeadSearchUpdate: Component rendering...');
  
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch leads on mount
  useEffect(() => {
    console.log('📡 LeadSearchUpdate: useEffect triggered, fetching leads...');
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log('🔄 LeadSearchUpdate: Calling searchLeads API...');
      const results = await searchLeads('');
      console.log('✅ LeadSearchUpdate: API returned results:', { 
        count: results?.length, 
        firstLead: results?.[0],
        isArray: Array.isArray(results) 
      });
      setLeads(results || []);
    } catch (err) {
      console.error('❌ LeadSearchUpdate: API error:', err);
      setError('Failed to load leads');
    } finally {
      setIsLoading(false);
    }
  };

  console.log('🎨 LeadSearchUpdate: About to render JSX...');
  console.log('📊 Current state:', { 
    leadsCount: leads.length, 
    isLoading, 
    hasError: !!error,
    hasIcons: !!MagnifyingGlassIcon && !!UserIcon
  });

  // Let's try adding back the search box with icon
  return (
    <div style={{ padding: '20px' }}>
      <h1>Lead Search (With Icons Test)</h1>
      
      {/* Add search box with icon */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        {MagnifyingGlassIcon ? (
          <MagnifyingGlassIcon style={{ 
            position: 'absolute', 
            left: '10px', 
            top: '10px', 
            height: '20px', 
            width: '20px' 
          }} />
        ) : (
          <span>🔍</span>
        )}
        <input
          type="text"
          style={{ 
            padding: '10px 10px 10px 40px', 
            width: '300px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
          placeholder="Search leads..."
        />
      </div>
      
      {isLoading && <p>Loading...</p>}
      
      {error && <p style={{ color: 'red' }}>{error}</p>}
      
      {!isLoading && !error && (
        <div>
          <p>Found {leads.length} leads</p>
          <div>
            {leads.map((lead, index) => {
              console.log(`🔍 Rendering lead ${index}:`, lead);
              return (
                <div key={index} style={{ 
                  padding: '10px', 
                  border: '1px solid #eee', 
                  marginBottom: '5px',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  {UserIcon ? (
                    <UserIcon style={{ height: '20px', width: '20px', marginRight: '10px' }} />
                  ) : (
                    <span style={{ marginRight: '10px' }}>👤</span>
                  )}
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      {lead['First Name'] || 'No first name'} {lead['Last Name'] || 'No last name'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {lead['Status'] || 'No status'} • Score: {lead['AI Score'] || 'N/A'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0' }}>
        <strong>Debug Info:</strong>
        <pre>{JSON.stringify({ 
          iconStatus: {
            MagnifyingGlassIcon: !!MagnifyingGlassIcon,
            UserIcon: !!UserIcon
          },
          leadsCount: leads.length,
          isLoading,
          error
        }, null, 2)}</pre>
      </div>
    </div>
  );
};

export default LeadSearchUpdate;
