"use client";
import React from 'react';
import LeadSearchTable from './LeadSearchTable';

// Simple pass-through wrapper to ensure client rendering boundary
export default function LeadSearchTableClient(props) {
  return <LeadSearchTable {...props} />;
}
