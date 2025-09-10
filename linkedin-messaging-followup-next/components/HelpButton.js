"use client";
import React from 'react';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

/**
 * Small reusable Help button.
 * Props:
 * - area?: string — help area to open (overrides Layout's inferred area)
 * - label?: string — button label (default: Help)
 * - title?: string — tooltip/title
 * - className?: string — extra classes
 */
export default function HelpButton({ area, label = 'Help', title = 'Open contextual help', className = '' }) {
  const onClick = () => {
    try {
      if (typeof window !== 'undefined') {
        const detail = {};
        if (area) detail.area = area;
        window.dispatchEvent(new CustomEvent('open-help', { detail }));
      }
    } catch (_) {}
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 ${className}`}
      title={title}
    >
      <QuestionMarkCircleIcon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
