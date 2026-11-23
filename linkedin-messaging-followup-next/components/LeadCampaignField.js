"use client";
import React, { useEffect, useState } from 'react';
import { getLeadCampaigns, setLeadCampaign } from '../services/api';

// The Campaign row on a lead (23 Nov 2026, Roland Illyes).
//   - Linked Helper sent them  -> the campaign name, read-only (scoring uses the same campaign)
//   - nobody sent them         -> a list of the client's own Linked Helper campaigns to choose from
// Saves on change, by itself - it is not part of the form's Save. Renders nothing for a lead
// object that never came through the lead endpoint (campaignLocked undefined).
export default function LeadCampaignField({ lead }) {
  const leadId = lead && (lead.id || lead.recordId);
  const locked = lead ? lead.campaignLocked : undefined;
  const [value, setValue] = useState((lead && lead.campaign) || '');
  const [choices, setChoices] = useState(null);
  const [state, setState] = useState({ saving: false, note: '', error: '' });

  useEffect(() => {
    setValue((lead && lead.campaign) || '');
    setState({ saving: false, note: '', error: '' });
  }, [leadId, lead && lead.campaign]);

  useEffect(() => {
    if (locked !== false) return undefined;
    let alive = true;
    getLeadCampaigns().then((o) => { if (alive) setChoices(o.choices || []); }).catch(() => { if (alive) setChoices([]); });
    return () => { alive = false; };
  }, [locked]);

  if (!leadId || locked === undefined) return null;

  const onChange = async (e) => {
    const next = e.target.value;
    const before = value;
    setValue(next);
    setState({ saving: true, note: '', error: '' });
    try {
      await setLeadCampaign(leadId, next);
      setState({ saving: false, note: 'Saved', error: '' });
    } catch (err) {
      setValue(before);
      setState({ saving: false, note: '', error: err.message || 'Could not save the campaign' });
    }
  };

  // The current value stays in the list even if that campaign is no longer on the machine.
  const options = [...new Set([...(choices || []), ...(value ? [value] : [])])];

  return (
    <div className="flex">
      <label htmlFor="lead-campaign" className="w-28 text-sm font-medium text-gray-700 flex-shrink-0 py-2">Campaign</label>
      <div className="flex-1">
        {locked ? (
          <>
            <div className="px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm text-gray-800">{value}</div>
            <p className="mt-1 text-xs text-gray-500">Set by Linked Helper - the campaign that sent this person.</p>
          </>
        ) : (
          <>
            <select
              id="lead-campaign"
              value={value}
              onChange={onChange}
              disabled={state.saving || choices === null}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">No campaign</option>
              {options.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {state.error
                ? <span className="text-red-600">{state.error}</span>
                : state.saving ? 'Saving...'
                  : state.note ? <span className="text-green-700">{state.note}</span>
                    : choices !== null && choices.length === 0 ? 'No Linked Helper campaigns to choose from yet.'
                      : 'No campaign sent this person. Choose one of your Linked Helper campaigns if they belong to it.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
