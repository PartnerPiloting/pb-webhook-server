"use client";
import React, { useEffect, useState } from 'react';
import { getContextHelp, getHelpTopic } from '../services/api';

export default function ContextHelpPanel({ area, isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // { area, fetchedAt, categories: [...] }
  const [expandedTopicId, setExpandedTopicId] = useState(null);
  const [topicBodies, setTopicBodies] = useState({}); // id -> { bodyHtml || body }
  const [topicLoading, setTopicLoading] = useState({}); // id -> boolean
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    const fetchHelp = async () => {
      setLoading(true); setError('');
      try {
        // Allow manual refresh via ?helpRefresh=1 in URL
        let refresh = false;
        let tableOpt = undefined;
        try {
          const u = new URL(window.location.href);
          refresh = u.searchParams.get('helpRefresh') === '1';
          // Support selecting alternate help table: ?table=copy or ?helpTable=copy
          const t = (u.searchParams.get('table') || u.searchParams.get('helpTable') || '').toLowerCase();
          if (t === 'copy' || t === 'help') tableOpt = t;
        } catch {}
        const resp = await getContextHelp(area, { includeBody: true, refresh, table: tableOpt });
        if (mounted) setData(resp || null);
      } catch (e) {
        if (mounted) setError(e?.message || 'Failed to load help');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchHelp();
    return () => { mounted = false; };
  }, [area, isOpen]);

  // Force-refresh handler (bypasses cache regardless of URL param)
  const refreshNow = async () => {
    setLoading(true); setError('');
    try {
      let tableOpt = undefined;
      try {
        const u = new URL(window.location.href);
        const t = (u.searchParams.get('table') || u.searchParams.get('helpTable') || '').toLowerCase();
        if (t === 'copy' || t === 'help') tableOpt = t;
      } catch {}
      const resp = await getContextHelp(area, { includeBody: true, refresh: true, table: tableOpt });
      setData(resp || null);
      setLastRefreshedAt(Date.now());
      // keep current expanded topic, but clear stale bodies so they re-fetch on open
      setTopicBodies((prev) => ({ ...(prev || {}) }));
    } catch (e) {
      setError(e?.message || 'Failed to refresh help');
    } finally {
      setLoading(false);
    }
  };

  const toggleTopic = async (id) => {
    if (expandedTopicId === id) { setExpandedTopicId(null); return; }
    setExpandedTopicId(id);
    if (!topicBodies[id]) {
      setTopicLoading((prev)=> ({ ...prev, [id]: true }));
      try {
        const full = await getHelpTopic(id, { includeInstructions: false });
        setTopicBodies((prev) => ({ ...prev, [id]: full }));
      } catch (e) {
        // Non-fatal; keep list usable
        console.error('getHelpTopic failed', e);
      } finally {
        setTopicLoading((prev)=> ({ ...prev, [id]: false }));
      }
    }
  };

  if (!isOpen) return null;

  // Normalize HTML exactly like Start Here page does
  const renderNormalizedHtml = (html, keyPrefix) => {
    if (!html) return null;
    let safe = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
    // Inject heading classes if missing
    safe = safe
      .replace(/<h1(?![^>]*class=)([^>]*)>/gi, '<h1 class="mt-6 mb-4 text-base font-bold text-gray-900"$1>')
      .replace(/<h2(?![^>]*class=)([^>]*)>/gi, '<h2 class="mt-6 mb-3 text-[15px] font-semibold text-gray-900"$1>')
      .replace(/<h3(?![^>]*class=)([^>]*)>/gi, '<h3 class="mt-5 mb-2 text-[14px] font-semibold text-gray-900"$1>')
      .replace(/<h4(?![^>]*class=)([^>]*)>/gi, '<h4 class="mt-5 mb-2 text-[13px] font-semibold text-gray-800"$1>');
  // Style anchors
    safe = safe
      .replace(/<a (?![^>]*class=)([^>]*?)>/gi, '<a class="text-blue-600 underline font-medium hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500" $1>')
      .replace(/<a([^>]*class=["'])([^"']*)(["'][^>]*?)>/gi, (m, pre, classes, post) => {
        if (/text-blue-600|underline/.test(classes)) return m;
        return `<a${pre}${classes} text-blue-600 underline hover:text-blue-700${post}>`;
      });
    // List styling and cleanup of <p> inside <li>
    safe = safe
      .replace(/<ul(?![^>]*class=)([^>]*)>/gi, '<ul class="list-disc pl-5"$1>')
      .replace(/<ol(?![^>]*class=)([^>]*)>/gi, '<ol class="list-decimal pl-5"$1>')
      .replace(/<li(?![^>]*class=)([^>]*)>/gi, '<li class="leading-relaxed"$1>');
    safe = safe.replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, (m, attrs, inner) => {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      return `<li${attrs}>${trimmed}</li>`;
    });
    safe = safe.replace(/(<li[^>]*>)\s*<p[^>]*>/gi, '$1');
    safe = safe.replace(/<\/p>\s*(<\/li>)/gi, '$1');
    safe = safe.replace(/<p[^>]*>\s*(?:&nbsp;)?\s*<\/p>/gi, '');
    // Tighten list container spacing with inline styles (as in Start Here)
    safe = safe
      .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul$1 style="margin:0;padding-left:1.25rem;list-style:disc;">')
      .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol$1 style="margin:0;padding-left:1.25rem;list-style:decimal;">');
    safe = safe.replace(/<\/li>\s+<li/gi, '</li><li');
  // Unescape and style <kbd> tags which may arrive HTML-escaped from the backend
  // Convert &lt;kbd&gt;...&lt;\/kbd&gt; back to real tags
  safe = safe.replace(/&lt;kbd&gt;([\s\S]*?)&lt;\/kbd&gt;/gi, '<kbd>$1<\/kbd>');
  // Apply a pleasant default style to kbd when no class is present
  safe = safe.replace(/<kbd(?![^>]*class=)([^>]*)>/gi, '<kbd class="mx-0.5 rounded border border-gray-300 bg-gray-100 px-1 py-0.5 text-[0.75rem] font-medium text-gray-800 align-baseline"$1>');
    // Strip internal reference tokens and render basic bold/italic inside provided HTML
    safe = safe
      .replace(/:contentReference\[[^\]]+\]\{[^}]*\}/g, '')
      .replace(/:oaicite\[[^\]]+\]\{[^}]*\}/g, '')
      .replace(/\\\*/g, '*')
      .replace(/\*\*([^*<>][^*<>]*?)\*\*/g, '<strong>$1<\/strong>')
      .replace(/(^|[\s>(])\*([^*<>][^*<>]*?)\*(?=[\s<).,!?:;]|$)/g, '$1<em>$2<\/em>')
      .replace(/  +/g, ' ');
    // Preserve current query params (e.g., ?testClient=abc) on internal /start-here links
    try {
      if (typeof window !== 'undefined') {
        const q = window.location.search || '';
        if (q) {
          safe = safe.replace(/href=(['"])(\/start-here[^'"\s>]*)\1/gi, (m, quote, path) => {
            if (path.includes('?')) return `href=${quote}${path}&${q.replace(/^\?/, '')}${quote}`;
            return `href=${quote}${path}${q}${quote}`;
          });
        }
  // Also force /start-here links to open in a new tab
  // Add target+rel when missing
  safe = safe.replace(/<a(?![^>]*target=)([^>]*href=(["'])(\/start-here[^"']*)\2[^>]*)>/gi, '<a$1 target="_blank" rel="noopener noreferrer">');
  // Ensure rel exists when target already present
  safe = safe.replace(/<a([^>]*href=(["'])(\/start-here[^"']*)\2[^>]*target=["'][^"']*["'])(?![^>]*rel=)([^>]*)>/gi, '<a$1 rel="noopener noreferrer"$3>');
      }
    } catch(_) {}

  return <div key={keyPrefix || 'help-html'} className="prose prose-sm max-w-none text-xs leading-[1.5]" dangerouslySetInnerHTML={{ __html: safe }} />;
  };

  // Ensure links have a protocol to avoid relative navigation
  const withHttp = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
  };

  const renderBlocks = (blocks = []) => {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    // Helper: render plain text while converting <kbd>...</kbd> (or encoded) into styled elements
    const renderTextWithKbd = (text) => {
      if (!text) return null;
      const parts = [];
      const regex = /(?:<kbd>|&lt;kbd&gt;)([\s\S]*?)(?:<\/kbd>|&lt;\/kbd&gt;)/gi;
      let lastIndex = 0; let m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
        const label = (m[1] || '').trim();
        parts.push(
          <kbd key={`kbd-${parts.length}`} className="mx-0.5 rounded border border-gray-300 bg-gray-100 px-1 py-0.5 text-[0.75rem] font-medium text-gray-800 align-baseline">{label || '⌨︎'}</kbd>
        );
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) parts.push(text.slice(lastIndex));
      return parts;
    };
    return (
      <div className="space-y-3">
        {blocks.map((b, i) => {
          if (b.type === 'text') {
            const text = (b.markdown || b.text || '').trim();
            if (!text) return null;
            if (/(?:<kbd>|&lt;kbd&gt;)/i.test(text)) {
              return <div key={i} className="whitespace-pre-wrap text-gray-800 text-sm">{renderTextWithKbd(text)}</div>;
            }
            return <div key={i} className="whitespace-pre-wrap text-gray-800 text-sm">{text}</div>;
          }
          if (b.type === 'media') {
            const m = b.media || {};
            const url = withHttp(m.url || (m.attachment && m.attachment.url) || '');
            const caption = m.caption || '';
            const isImage = (m.type || '').toLowerCase().includes('image');
            return (
              <div key={i} className="text-sm">
                {isImage && url ? (
                  <figure>
                    <img src={url} alt={caption || 'media'} className="max-w-full h-auto rounded border" />
                    {caption ? <figcaption className="text-xs text-gray-600 mt-1">{caption}</figcaption> : null}
                  </figure>
                ) : url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{caption || url}</a>
                ) : (
                  <div className="text-gray-500">[media]</div>
                )}
              </div>
            );
          }
          if (b.type === 'media-missing') {
            return <div key={i} className="text-xs text-gray-500">[media {b.media_id} missing]</div>;
          }
          return null;
        })}
      </div>
    );
  };

  const areaTitle = (() => {
    switch (area) {
      case 'lead_search_and_update_detail':
        return 'Help: Lead Detail';
      case 'lead_search_and_update_search':
      case 'lead_search_and_update':
        return 'Help: Lead Search & Update';
      case 'lead_follow_up':
        return 'Help: Follow-Up Manager';
      case 'new_lead':
        return 'Help: New Lead';
      case 'top_scoring_leads':
        return 'Help: Top Scoring Leads';
      case 'top_scoring_posts':
        return 'Help: Top Scoring Posts';
      case 'post_scoring':
        return 'Help: Post Scoring Criteria';
      case 'profile_attributes':
        return 'Help: Profile Scoring Attributes';
      default:
        return 'Help';
    }
  })();

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black bg-opacity-30" role="dialog" aria-modal="true" onMouseDown={(e)=>{ if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" onMouseDown={(e)=>e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{areaTitle}</h3>
            {lastRefreshedAt && (
              <div className="text-[11px] text-gray-500">Refreshed {new Date(lastRefreshedAt).toLocaleTimeString()}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`px-2.5 py-1 text-xs rounded border ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={refreshNow}
              disabled={loading}
              title="Refresh help (bypass cache)"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="text-gray-500 hover:text-gray-700" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto">
          {loading && (
            <div className="text-sm text-gray-600">Loading help…</div>
          )}
          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && (!data || !Array.isArray(data.categories) || data.categories.length === 0) && (
            <div className="text-sm text-gray-600">No help content available yet for this area.</div>
          )}

          {data && Array.isArray(data.categories) && data.categories.length > 0 && (
            <div className="space-y-4">
              {data.categories.sort((a,b)=> (a.order||0) - (b.order||0)).map((cat) => (
                <div key={cat.id} className="border border-gray-200 rounded-md">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <div className="text-sm font-medium text-gray-900">{cat.name}</div>
                    {cat.description ? <div className="text-xs text-gray-600">{cat.description}</div> : null}
                  </div>
                  <div className="p-3 space-y-3">
                    {(cat.subCategories || []).sort((a,b)=> (a.order||0) - (b.order||0)).map((sub) => (
                      <div key={sub.id} className="">
                        <div className="text-sm font-semibold text-gray-800">{sub.name}</div>
                        {sub.description ? <div className="text-xs text-gray-600 mb-1">{sub.description}</div> : null}
                        <ul className="list-disc pl-5 space-y-1">
                          {(sub.topics || []).sort((a,b)=> (a.order||0) - (b.order||0)).map((t) => (
                            <li key={t.id}>
                              <button className="text-blue-700 hover:underline text-sm" onClick={()=> toggleTopic(t.id)}>
                                {t.title || 'Untitled Topic'}
                              </button>
                              {expandedTopicId === t.id && (
                                <div className="mt-2">
                                  {topicLoading[t.id] ? (
                                    <div className="text-xs text-gray-500">Loading…</div>
                                  ) : (() => {
                                    // Merge detail topic (blocks) with list topic (may include bodyHtml)
                                    const full = { ...(t || {}), ...(topicBodies[t.id] || {}) };
                                    // Prefer explicit HTML when present (matches Start Here rendering fidelity)
                                    let html = full.bodyHtml || full.html || '';
                                    const body = full.body || '';
                                    if (!html && typeof body === 'string' && /<\s*(?:p|h[1-6]|ul|ol|li|img|blockquote|hr|div|section|strong|em|br|a|table|thead|tbody|tr|td|th|code|pre)[\s>/]/i.test(body)) {
                                      html = body;
                                    }
                                    if (html) return renderNormalizedHtml(html, t.id);
                                    // Fallback to blocks when no HTML is available
                                    if (Array.isArray(full.blocks) && full.blocks.length) return renderBlocks(full.blocks);
                                    if (body) return <pre className="whitespace-pre-wrap text-gray-800">{body}</pre>;
                                    return <div className="text-gray-500">No content.</div>;
                                  })()}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

  {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end">
          <button className="px-3 py-1.5 text-sm rounded border" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
