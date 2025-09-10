"use client";
import React, { useEffect, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import Layout from '../../components/Layout';
import ErrorBoundary from '../../components/ErrorBoundary';
import EnvironmentValidator from '../../components/EnvironmentValidator';
import { getStartHereHelp, getHelpTopic } from '../../services/api';

export const dynamic = 'force-dynamic';

interface HelpTopic { id: string; title: string; order: number; body?: string; contextType?: string | null; }
interface TopicBlockText { type: 'text'; markdown: string }
interface TopicBlockMedia { type: 'media'; token: string; media: { media_id: number|string; type: string; url: string|null; caption?: string|null; description?: string|null; instructions?: string|null; attachment?: any } }
interface TopicBlockMissing { type: 'media-missing'; token: string; media_id: string }
type TopicBlock = TopicBlockText | TopicBlockMedia | TopicBlockMissing;
interface HelpSubCategory { id: string; name: string; order: number; description?: string | null; topics: HelpTopic[]; }
interface HelpCategory { id: string; name: string; order: number; description?: string | null; subCategories: HelpSubCategory[]; }
interface HelpResponse { area: string; fetchedAt: string; categories: HelpCategory[]; meta: any; }

const StartHereContent: React.FC = () => {
  const [data, setData] = useState<HelpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Map-based open state (reverted to stable approach)
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({});
  const [qaLoading, setQaLoading] = useState<Record<string, boolean>>({});
  // Legacy single-answer store (kept briefly for compatibility, will phase out)
  const [qaAnswer, setQaAnswer] = useState<Record<string, { answer: string; method: string }>>({});
  // Conversation history per topic: array of messages { role: 'user'|'assistant', text, method? }
  const [qaHistory, setQaHistory] = useState<Record<string, { role: 'user'|'assistant'; text: string; method?: string }[]>>({});
  const [qaInput, setQaInput] = useState<Record<string, string>>({});
  const [topicBlocks, setTopicBlocks] = useState<Record<string, TopicBlock[]>>({});
  const [topicLoadState, setTopicLoadState] = useState<Record<string, 'idle'|'loading'|'error'|'ready'>>({});

  // Expose renderer to helper function outside component scope
  useEffect(()=>{
    (window as any).__renderTopic = (id: string) => {
      const blocks = topicBlocks[id];
      if (!blocks) {
        const st = topicLoadState[id];
  if (st==='loading') return <div className="text-xs text-gray-400">Loading topic content…</div>;
  if (st==='error') return <div className="text-xs text-red-500">Failed to load topic content.</div>;
  return <div className="text-xs text-gray-400">Preparing topic content…</div>;
      }
      return blocks.map((b,i) => {
        if (b.type==='text') return renderMarkdown(b.markdown, id+'::'+i);
        if (b.type==='media') {
          const m = b.media;
          if (m.type==='image' && m.url) return <figure key={id+'::m::'+i} className="space-y-1"><img src={m.url} alt={m.caption||'media'} className="rounded border" /><figcaption className="text-[11px] text-gray-500">{m.caption || `Image ${m.media_id}`}</figcaption></figure>;
          if (m.type==='link' && m.url) return <p key={id+'::m::'+i} className="text-blue-600 underline"><a href={m.url} target="_blank" rel="noreferrer">{m.caption || m.url}</a></p>;
          if (m.url) return <p key={id+'::m::'+i}><a className="text-blue-600 underline" href={m.url} target="_blank" rel="noreferrer">{m.caption||`Asset ${m.media_id}`}</a></p>;
          return <p key={id+'::m::'+i} className="text-xs text-gray-400">(media missing url)</p>;
        }
        if (b.type==='media-missing') return <p key={id+'::mm::'+i} className="text-xs text-amber-600">Missing media {b.media_id}</p>;
        return null;
      });
    };
  }, [topicBlocks, topicLoadState]);

  // (Removed activeTopic useEffect; fetch handled inside toggleTopic when opened)

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const resp = await getStartHereHelp();
        if (!active) return;
        setData(resp);
        setLoading(false);
      } catch (e:any) {
        console.error('StartHere load error', e);
        if (!active) return;
        setError(e.message || 'Failed to load Start Here content');
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="text-gray-500">Loading Start Here content...</div>;
  }
  if (error) {
    return <div className="text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="text-gray-500">No Start Here content available.</div>;
  }

  const toggleCat = (id:string) => {
    // Exclusive category open
    setOpenCats({ [id]: !openCats[id] });
    setOpenSubs({});
    setOpenTopics({});
  };
  const toggleSubCategory = (id:string) => {
    setOpenSubs({ [id]: !openSubs[id] });
    setOpenTopics({});
  };
  const toggleTopic = (id:string) => {
    setOpenTopics(prev => {
      const willOpen = !prev[id];
      const next: Record<string, boolean> = { [id]: willOpen }; // exclusive topic
      if (willOpen && !topicLoadState[id]) {
        setTopicLoadState(s=>({...s,[id]:'loading'}));
        getHelpTopic(id, { includeInstructions: false })
          .then(data => {
            setTopicBlocks(s=>({...s,[id]: data.blocks || [] }));
            setTopicLoadState(s=>({...s,[id]:'ready'}));
          })
          .catch(err => {
            console.error('topic load error', id, err);
            setTopicLoadState(s=>({...s,[id]:'error'}));
          });
      }
      return next;
    });
  };

  const askQuestion = async (topicId: string) => {
    const question = (qaInput[topicId] || '').trim();
    if (!question) return;
    // Append user message immediately
    setQaHistory(h => ({ ...h, [topicId]: [...(h[topicId] || []), { role: 'user', text: question }] }));
    setQaInput(s => ({ ...s, [topicId]: '' }));
    setQaLoading(s => ({ ...s, [topicId]: true }));
    try {
  // Always talk to backend base (env-aware; defaults: localhost in dev, staging in preview, prod in production)
  const { getBackendBase } = await import('../../services/api');
  const baseUrl = getBackendBase();
      const resp = await fetch(`${baseUrl}/api/help/qa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, question, includeInstructions: true }) });
        if (resp.ok) {
        const json = await resp.json();
        // Compose enriched message with citations & completeness (12c)
        let enriched = json.answer || '';
        if (json.sources && Array.isArray(json.sources) && json.sources.length) {
          const sourceLines = json.sources.map((s:any) => `[#${s.id}] ${s.type}: ${s.title}${s.score ? ` (score ${s.score})` : ''}`);
          enriched += '\n\nSources:\n' + sourceLines.join('\n');
        }
        if (json.completeness && json.completeness.note) {
          enriched += `\n\n_${json.completeness.note}_`;
        }
        // Store legacy single-answer (optional)
        setQaAnswer(s => ({ ...s, [topicId]: { answer: enriched, method: json.method } }));
        // Append assistant message
        setQaHistory(h => ({ ...h, [topicId]: [...(h[topicId] || []), { role: 'assistant', text: enriched, method: json.method }] }));
      } else {
        setQaHistory(h => ({ ...h, [topicId]: [...(h[topicId] || []), { role: 'assistant', text: 'Error answering question.', method: 'error' }] }));
      }
    } catch (e:any) {
      setQaHistory(h => ({ ...h, [topicId]: [...(h[topicId] || []), { role: 'assistant', text: 'Network error.', method: 'error' }] }));
    } finally {
      setQaLoading(s => ({ ...s, [topicId]: false }));
    }
  };

  // Clean and format an assistant answer by stripping internal reference labels
  const sanitizeAnswer = (raw: string) => {
    if (!raw) return raw;
    const lines = raw.split(/\n+/);
    const skipLabels = new Set(['additional reference:', 'additional references:', 'manual:', 'lh snapshot:', 'topic reference:']);
    const out: string[] = [];
    for (let i=0;i<lines.length;i++) {
      const l = lines[i].trim();
      if (!l) { out.push(''); continue; }
      const lower = l.toLowerCase();
      if (skipLabels.has(lower)) continue; // drop pure label lines
      // Remove leading label + content pattern e.g. "Manual: some text"
      const colonIdx = l.indexOf(':');
      if (colonIdx > -1) {
        const head = l.slice(0, colonIdx+1).toLowerCase();
        if (skipLabels.has(head)) {
          const rest = l.slice(colonIdx+1).trim();
          if (rest) out.push(rest); else continue;
          continue;
        }
      }
      out.push(l);
    }
    // Rejoin, collapse excess blank lines
    let cleaned = out.join('\n');
    cleaned = cleaned.replace(/\n{3,}/g,'\n\n');
    return cleaned.trim();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500 pl-1 tracking-wide">{data.meta?.totalTopics ?? 0} topics • fetched {new Date(data.fetchedAt).toLocaleTimeString()} {data.meta?.cached && '(cached)'} • ordering: {data.meta?.orderingStrategy || 'default'} • mode: Full</div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        {data.categories.sort((a,b)=>a.order-b.order).map(cat => {
          const catOpen = !!openCats[cat.id];
          const topicCount = cat.subCategories.reduce((sum, sc) => sum + sc.topics.length, 0);
          return (
            <div key={cat.id} className={`group relative flex flex-col bg-white rounded-lg shadow-sm transition border ${catOpen ? 'md:col-span-2 border-blue-500 shadow-md overflow-hidden' : 'border-gray-200 hover:shadow-md'}`}>
              <button onClick={()=>toggleCat(cat.id)} aria-expanded={catOpen} className="w-full flex justify-between items-start gap-3 text-left px-5 py-4 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <div className="pr-6">
                  <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                    <span>{cat.name}</span>
                    <span className="inline-block text-[10px] font-medium uppercase tracking-wide text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded">Cat {cat.order}</span>
                  </h3>
                  <p className="text-xs text-gray-500">{cat.subCategories.length} sub-categories • {topicCount} topics</p>
                  {catOpen && cat.description && (
                    <p className="mt-2 text-[11px] leading-snug text-gray-600 pr-4">{cat.description}</p>
                  )}
                </div>
                <ChevronDownIcon className={`h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${catOpen ? 'rotate-180 text-blue-500' : 'group-hover:text-gray-600'}`} />
              </button>
              {catOpen && (
                <div className="px-5 pb-4 bg-gradient-to-b from-white to-gray-50/70 pt-0">
                  <div className="divide-y divide-gray-100">
                    {cat.subCategories.sort((a,b)=>a.order-b.order).map(sub => {
                      const subOpen = !!openSubs[sub.id];
                      return (
                        <div key={sub.id} className="py-3 first:pt-1 last:pb-1">
                          <button onClick={()=>toggleSubCategory(sub.id)} className="w-full text-left mb-1 flex items-start justify-between group/sub px-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                              {sub.name}
                              <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{sub.topics.length}</span>
                            </div>
                            <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition-transform ${subOpen ? 'rotate-180 text-blue-500' : 'group-hover/sub:text-gray-600'}`} />
                          </button>
                          {sub.description && subOpen && (
                            <p className="text-[11px] text-gray-500 leading-snug mt-1 pr-2">{sub.description}</p>
                          )}
                          {subOpen && (
                            <ul className="mt-2 space-y-2 text-sm">
                              {sub.topics.sort((a,b)=>a.order-b.order).map(t => {
                                const tOpen = !!openTopics[t.id];
                                return (
                                  <li key={t.id} className="border border-gray-200 rounded-md bg-gray-50/40">
                                    <button onClick={()=>toggleTopic(t.id)} className="w-full flex items-start justify-between gap-3 text-left px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md">
                                      <span className="flex-1 text-gray-800 leading-snug">
                                        <span className="font-medium">{t.title}</span>
                                      </span>
                                      <ChevronDownIcon className={`h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${tOpen ? 'rotate-180 text-blue-500' : 'group-hover:text-gray-600'}`} />
                                    </button>
                                    {tOpen && (
                                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
                                        {topicLoadState[t.id]==='error' && (
                                          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 flex items-center justify-between">
                                            <span>Failed to load topic content.</span>
                                            <button onClick={()=>{ setTopicLoadState(s=>({...s,[t.id]:'idle'})); toggleTopic(t.id); }} className="text-red-700 underline font-medium">Retry</button>
                                          </div>
                                        )}
                                        <div className="text-[13px] leading-relaxed text-gray-700 space-y-4">
                                          {renderTopicContent(t.id)}
                                        </div>
                                        <div className="bg-white/60 border border-gray-200 rounded-md p-2 flex flex-col gap-2 max-h-96 overflow-hidden">
                                          <div className="flex-1 overflow-auto pr-1 space-y-3 order-1">
                                            {qaHistory[t.id] && qaHistory[t.id].length > 0 ? (
                                              qaHistory[t.id].map((m, idx) => (
                                                <div key={t.id+'::msg::'+idx} className={`text-[12px] leading-relaxed rounded-md px-2 py-1.5 border ${m.role==='user' ? 'bg-blue-50/70 border-blue-200 text-gray-800' : 'bg-white border-gray-200 text-gray-700'}`}> 
                                                  {m.role==='assistant' ? (
                                                    <>
                                                      {renderMarkdown(sanitizeAnswer(m.text), t.id+'::ans::'+idx)}
                                                      {m.method && m.method !== 'error' && (
                                                        <div className="mt-1 text-[9px] tracking-wide text-gray-300" title="Internal retrieval method (hidden from end users)">/* {m.method} */</div>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <div className="font-medium">{m.text}</div>
                                                  )}
                                                </div>
                                              ))
                                            ) : (
                                              <div className="text-[11px] text-gray-400">Ask a question below to start a mini Q&A for this topic.</div>
                                            )}
                                          </div>
                                          <div className="flex gap-2 border-t border-gray-100 pt-2 order-2">
                                            <input
                                              type="text"
                                              value={qaInput[t.id] || ''}
                                              onChange={e=>setQaInput(s=>({...s,[t.id]:e.target.value}))}
                                              placeholder="Ask a question about this topic..."
                                              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); askQuestion(t.id);} }}
                                            />
                                            <button onClick={()=>askQuestion(t.id)} disabled={qaLoading[t.id]} className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed min-w-[52px]">{qaLoading[t.id] ? '...' : 'Ask'}</button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Basic markdown + media renderer (inside same file for now)
function renderMarkdown(md: string, keyPrefix: string) {
  // If backend already sent HTML, render it as HTML (with a minimal sanitizer)
  const isLikelyHtml = /<\s*(h[1-6]|p|ul|ol|li|em|strong|blockquote|hr|br|a|figure|img|div|span|table|thead|tbody|tr|td)\b/i.test(md);
  if (isLikelyHtml) {
    const sanitized = basicSanitizeHtml(md);
    return <div key={keyPrefix} className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitized }} />;
  }
  // 1. Normalize newlines and unescape common escaped markdown chars introduced by Airtable / JSON
  let text = md.replace(/\r\n?/g,'\n');
  // Unescape sequences like \* \- \# \" \` etc
  text = text.replace(/\\([*`_#\-])/g,'$1');
  // Unescape escaped quotes specifically (\\")
  text = text.replace(/\\"/g,'"');
  // Remove backslash before heading hashes at start of line (\### -> ###)
  text = text.replace(/(^|\n)\\(#{1,6})/g,'$1$2');
  // Remove backslash before list hyphen (\- )
  text = text.replace(/(^|\n)\\-\s/g,'$1- ');
  // Unescape escaped digit list markers like 1\. to 1.
  text = text.replace(/(^|\n)(\s*\d+)\\\./g,'$1$2.');

  // 1b. Heuristic heading promotion: Convert standalone Title Case lines into ### headings
  // Criteria: line not already markdown heading/list, 2-10 words, majority words capitalized, no ending period, previous line blank
  const rawLines = text.split(/\n/);
  for (let i=0;i<rawLines.length;i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue; // already heading
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) continue; // list item
    if (/^[`>]/.test(trimmed)) continue; // code/quote
    if (trimmed.length > 70 || trimmed.length < 4) continue;
    if (/[.!?:]$/.test(trimmed)) continue; // likely sentence
    const words = trimmed.split(/\s+/);
    if (words.length < 2 || words.length > 10) continue;
    let capCount = 0;
    for (const w of words) {
      if (/^[A-Z][A-Za-z0-9'()\/-]*$/.test(w)) capCount++;
    }
    if (capCount / words.length >= 0.6) {
      const prev = i>0 ? rawLines[i-1].trim() : '';
      if (prev === '' || /^---+$/.test(prev)) {
        rawLines[i] = '### ' + trimmed; // promote
      }
    }
  }
  text = rawLines.join('\n');

  // 2. Escape HTML angle brackets
  let safe = text.replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 3. Horizontal rules ---
  safe = safe.replace(/^\s*---+\s*$/gm,'<hr/>');

  // 4. Headings (after unescape) – apply consistent spacing + visual hierarchy
  // Add top margin except when it's the very first element
  let headingIndex = 0;
  safe = safe.replace(/^######\s+(.*)$/gm,(_,c)=>`<h6 class=\"mt-5 mb-1 text-[13px] font-semibold text-gray-700 tracking-wide\">${c}<\/h6>`)
             .replace(/^#####\s+(.*)$/gm,(_,c)=>`<h5 class=\"mt-5 mb-1 text-[14px] font-semibold text-gray-700 tracking-wide\">${c}<\/h5>`)
             .replace(/^####\s+(.*)$/gm,(_,c)=>`<h4 class=\"mt-6 mb-2 text-[15px] font-semibold text-gray-800\">${c}<\/h4>`)
             .replace(/^###\s+(.*)$/gm,(_,c)=>`<h3 class=\"mt-6 mb-2 text-base font-semibold text-gray-900\">${c}<\/h3>`)
             .replace(/^##\s+(.*)$/gm,(_,c)=>`<h2 class=\"mt-7 mb-3 text-lg font-semibold text-gray-900\">${c}<\/h2>`)
             .replace(/^#\s+(.*)$/gm,(_,c)=>`<h1 class=\"mt-8 mb-4 text-xl font-bold text-gray-900\">${c}<\/h1>`);

  // Ensure first heading does not get excessive top margin
  safe = safe.replace(/^(<h[1-6][^>]*class=\\" )mt-[0-9]+/m,(m)=>m.replace(/mt-[0-9]+/,'mt-2'));

  // 5. Bold / Italic (do after headings so we don't bold inside tags accidentally)
  safe = safe.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  safe = safe.replace(/(^|\s)\*(?!\*)([^*]+)\*(?=\s|$)/g,'$1<em>$2</em>');

  // 6. Lists (unordered + ordered)
  const lines = safe.split(/\n/);
  const out: string[] = [];
  let ulist: string[] = [];
  let olist: string[] = [];
  const flushU = () => { if (ulist.length) { out.push('<ul class="list-disc pl-5">'+ulist.join('')+'</ul>'); ulist = []; } };
  const flushO = () => { if (olist.length) { out.push('<ol class="list-decimal pl-5">'+olist.join('')+'</ol>'); olist = []; } };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      flushO();
      ulist.push('<li>'+ line.replace(/^\s*[-*]\s+/,'') +'</li>');
    } else if (/^\s*\d+\.\s+/.test(line)) {
      flushU();
      olist.push('<li>'+ line.replace(/^\s*\d+\.\s+/,'') +'</li>');
    } else {
      flushU(); flushO();
      out.push(line);
    }
  }
  flushU(); flushO();
  safe = out.join('\n');

  // 7. Paragraph wrapping & blank line spacing
  // Split again and wrap plain text lines (that are not already block-level HTML) into <p> tags
  const blockLevelStarts = /^(<h[1-6]|<ul|<ol|<li|<hr|<blockquote|<pre|<figure)/i;
  const paraLines = safe.split(/\n/);
  const paraOut: string[] = [];
  let buffer: string[] = [];
  const flushPara = () => {
    if (!buffer.length) return;
    const content = buffer.join(' ').trim();
    if (content) paraOut.push(`<p class=\"mt-2 leading-relaxed text-gray-700\">${content}<\/p>`);
    buffer = [];
  };
  for (const ln of paraLines) {
    const trimmed = ln.trim();
    if (!trimmed) { flushPara(); continue; }
    if (blockLevelStarts.test(trimmed)) { flushPara(); paraOut.push(trimmed); continue; }
    // Inline line: accumulate
    buffer.push(trimmed);
  }
  flushPara();
  safe = paraOut.join('\n');

  // 8. Add extra blank line after major headings for readability (handled via Tailwind margins visually)

  return <div key={keyPrefix} className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{__html: safe}} />;
}

// Minimal HTML sanitizer for curated Help content.
// - Strips <script>/<style>
// - Removes inline event handlers (on*) and javascript: URLs
// Note: For untrusted input consider a full sanitizer like DOMPurify.
function basicSanitizeHtml(input: string): string {
  if (!input) return '';
  let html = String(input);
  // Remove script and style blocks completely (use RegExp constructor to avoid TSX parsing pitfalls)
  html = html.replace(new RegExp('<script[^>]*>[\\s\\S]*?<\\/script>', 'gi'), '');
  html = html.replace(new RegExp('<style[^>]*>[\\s\\S]*?<\\/style>', 'gi'), '');
  // Neutralize javascript: URLs in href/src while preserving the quote style
  html = html.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"']*\2/gi, ' $1="#"');
  // Remove inline event handlers like onclick, onerror
  html = html.replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  return html;
}

function renderTopicContent(topicId: string) {
  const fn = (window as any).__renderTopic;
  if (!fn) return <div className="text-gray-400 text-xs">Preparing renderer...</div>;
  const out = fn(topicId);
  if (!out) return <div className="text-gray-400 text-xs">Loading content...</div>;
  return out;
}

export default function StartHerePage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <StartHereContent />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
