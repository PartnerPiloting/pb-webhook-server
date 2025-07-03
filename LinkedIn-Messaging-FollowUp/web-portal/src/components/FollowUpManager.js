import React from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';

const FollowUpManager = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Follow-Up Manager</h2>
        <p className="mt-1 text-sm text-gray-600">
          Manage scheduled follow-ups and upcoming interactions.
        </p>
      </div>

      <div className="text-center py-12">
        <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">Follow-Up Manager</h3>
        <p className="mt-1 text-sm text-gray-500">
          This screen will show leads with scheduled follow-up dates.
        </p>
        <div className="mt-4 text-xs text-gray-400">
          Coming in Phase 2 implementation
        </div>
      </div>
    </div>
  );
};

export default FollowUpManager;
