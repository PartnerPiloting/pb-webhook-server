'use client';

import { useEffect, useCallback } from 'react';

/**
 * Custom hook for the Quick Update keyboard shortcut (Ctrl+Shift+U)
 * 
 * @param {Function} onTrigger - Callback when shortcut is pressed
 * @param {boolean} enabled - Whether the shortcut is active (default true)
 * @returns {Object} - { shortcutLabel: string }
 */
export function useQuickUpdateShortcut(onTrigger, enabled = true) {
  const handleKeyDown = useCallback((e) => {
    // Ctrl+Shift+U
    if (e.ctrlKey && e.shiftKey && (e.key === 'u' || e.key === 'U')) {
      // Don't trigger if user is typing in an input/textarea
      const tagName = document.activeElement?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        // Allow in these fields - modal will take over
      }
      
      e.preventDefault();
      e.stopPropagation();
      onTrigger();
    }
  }, [onTrigger]);

  useEffect(() => {
    if (!enabled) return;
    
    // Use capture phase to catch before browser default
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleKeyDown, enabled]);

  return {
    shortcutLabel: 'Ctrl+Shift+U'
  };
}

export default useQuickUpdateShortcut;
