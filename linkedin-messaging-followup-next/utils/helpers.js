// Debounce function for search
export const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(null, args), delay);
  };
};

// Format LinkedIn URL for consistent storage
export const formatLinkedInUrl = (url) => {
  if (!url) return '';
  
  // Remove trailing slash
  let formatted = url.endsWith('/') ? url.slice(0, -1) : url;
  
  // Ensure https protocol
  if (!formatted.startsWith('http')) {
    formatted = 'https://' + formatted;
  }
  
  return formatted;
};

// Generate profile key from LinkedIn URL (matches Airtable formula)
export const generateProfileKey = (linkedinUrl) => {
  if (!linkedinUrl) return '';
  
  let profileKey = linkedinUrl;
  
  // Remove trailing slash
  if (profileKey.endsWith('/')) {
    profileKey = profileKey.slice(0, -1);
  }
  
  // Remove protocols
  profileKey = profileKey.replace(/^https?:\/\//, '');
  
  return profileKey.toLowerCase();
};

// Validate LinkedIn URL format
export const isValidLinkedInUrl = (url) => {
  if (!url) return false;
  
  const linkedinPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+\/?$/;
  return linkedinPattern.test(url);
};

// Format date for display
export const formatDate = (dateString) => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    return dateString;
  }
};

// Format date for form input (YYYY-MM-DD)
export const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch (error) {
    return '';
  }
};

// Parse and format notes with timestamps
export const formatNotesWithTimestamp = (existingNotes, newNote) => {
  if (!newNote.trim()) return existingNotes;
  
  const timestamp = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  const timestampedNote = `[${timestamp}] ${newNote.trim()}`;
  
  if (!existingNotes) {
    return timestampedNote;
  }
  
  return `${existingNotes}\n\n${timestampedNote}`;
};

// Extract name from LinkedIn URL if names are missing
export const extractNameFromLinkedInUrl = (url) => {
  if (!url) return { firstName: '', lastName: '' };
  
  try {
    const match = url.match(/linkedin\.com\/in\/([^/?]+)/);
    if (match) {
      const username = match[1];
      // Try to extract readable name from username
      const parts = username.split('-').filter(part => part.length > 1);
      if (parts.length >= 2) {
        return {
          firstName: parts[0].charAt(0).toUpperCase() + parts[0].slice(1),
          lastName: parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1)
        };
      }
    }
  } catch (error) {
    console.warn('Could not extract name from LinkedIn URL:', error);
  }
  
  return { firstName: '', lastName: '' };
};

// Validate email format
export const isValidEmail = (email) => {
  if (!email) return true; // Email is optional
  
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
};

// Calculate posts relevance percentage (matches Airtable formula)
export const calculatePostsRelevancePercentage = (postsRelevanceScore) => {
  if (!postsRelevanceScore || postsRelevanceScore === 0) return 0;
  
  return Math.round((postsRelevanceScore / 80) * 100);
};

// Helper for handling API errors
export const getErrorMessage = (error) => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return 'An unexpected error occurred';
};

// Save user preferences to localStorage
export const saveUserPreferences = (preferences) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('leadPortalPreferences', JSON.stringify(preferences));
  }
};

// Get user preferences from localStorage
export const getUserPreferences = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('leadPortalPreferences');
    if (stored) {
      return JSON.parse(stored);
    }
  }
  return {
    defaultView: 'all',
    pageSize: 20,
    sortBy: 'lastActivity'
  };
};

// Field visibility helper (for multi-tenant configuration)
export const getFieldVisibility = (fieldName, userRole = 'client') => {
  const ownerOnlyFields = [
    'linkedinMessages',
    'extensionLastSync'
  ];
  
  if (userRole === 'owner') {
    return { visible: true, editable: true };
  }
  
  if (ownerOnlyFields.includes(fieldName)) {
    return { visible: false, editable: false };
  }
  
  const readOnlyFields = [
    'profileKey',
    'aiScore',
    'postsRelevancePercentage',
    'lastMessageDate'
  ];
  
  return {
    visible: true,
    editable: !readOnlyFields.includes(fieldName)
  };
};
