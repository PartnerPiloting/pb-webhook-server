"use client";
import React from 'react';

// Shared HTML normalizer/renderer for all help areas
// Applies identical heading/link/list styling, fixes <kbd>, preserves query params on /start-here links,
// and opens start-here links in a new tab.
export function renderHelpHtml(html, keyPrefix) {
  if (!html) return null;
  let safe = String(html);
  // Strip scripts defensively
  safe = safe.replace(/<script[\s\S]*?<\/script>/gi, '');

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

  // Image styling - wrap all images in scrollable container with smooth zoom
  safe = safe.replace(/<img([^>]*)>/gi, (match, attrs) => {
    // Extract alt text for caption
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const caption = altMatch ? altMatch[1] : '';
    const uniqueId = Math.random().toString(36).substr(2, 9);
    
    return `<div class="my-4 space-y-2">
      <div class="border rounded-lg overflow-auto bg-gray-50 p-4" style="max-height:1200px;" id="container-${uniqueId}">
        <img${attrs} id="img-${uniqueId}" style="display:block;width:100%;height:auto;cursor:zoom-in;image-rendering:high-quality;transition:width 0.3s ease;" title="Click to zoom" />
      </div>
      <div class="text-xs text-gray-500 italic text-center">
        ${caption}${caption ? ' ' : ''}
        <span class="text-gray-400">(click to zoom, scroll to view) </span>
        <span id="indicator-${uniqueId}" class="font-semibold text-blue-600">100%</span>
      </div>
      <script>
        (function() {
          const img = document.getElementById('img-${uniqueId}');
          const container = document.getElementById('container-${uniqueId}');
          const indicator = document.getElementById('indicator-${uniqueId}');
          
          img.onclick = function() {
            const isZoomed = this.style.width === '150%';
            this.style.width = isZoomed ? '100%' : '150%';
            this.style.cursor = isZoomed ? 'zoom-in' : 'zoom-out';
            indicator.textContent = isZoomed ? '100%' : '150%';
            
            if (!isZoomed) {
              setTimeout(function() {
                container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
              }, 50);
            }
          };
        })();
      </script>
    </div>`;
  });

  // List styling and cleanup of <p> inside <li>
  safe = safe
    .replace(/<ul(?![^>]*class=)([^>]*)>/gi, '<ul class="list-disc pl-5"$1>')
    .replace(/<ol(?![^>]*class=)([^>]*)>/gi, '<ol class="list-decimal pl-5"$1>')
    .replace(/<li(?![^>]*class=)([^>]*)>/gi, '<li class="leading-relaxed"$1>');
  safe = safe.replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, (m, attrs, inner) => {
    const trimmed = (inner || '').trim();
    if (!trimmed) return '';
    return `<li${attrs}>${trimmed}</li>`;
  });
  safe = safe.replace(/(<li[^>]*>)\s*<p[^>]*>/gi, '$1');
  safe = safe.replace(/<\/p>\s*(<\/li>)/gi, '$1');
  // Tighten list spacing and ensure default bullets/decimal
  safe = safe
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul$1 style="margin:0;padding-left:1.25rem;list-style:disc;">')
    .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol$1 style="margin:0;padding-left:1.25rem;list-style:decimal;">')
    .replace(/<\/li>\s+<li/gi, '</li><li');

  // Unescape <kbd> that might arrive encoded, then apply a default style when no class exists
  safe = safe.replace(/&lt;kbd&gt;([\s\S]*?)&lt;\/kbd&gt;/gi, '<kbd>$1</kbd>');
  safe = safe.replace(/<kbd(?![^>]*class=)([^>]*)>/gi, '<kbd class="mx-0.5 rounded border border-gray-300 bg-gray-100 px-1 py-0.5 text-[0.75rem] font-medium text-gray-800 align-baseline"$1>');

  // Strip internal reference tokens and render basic markdown-style bold/italic within HTML bodies
  safe = safe
    .replace(/:contentReference\[[^\]]+\]\{[^}]*\}/g, '')
    .replace(/:oaicite\[[^\]]+\]\{[^}]*\}/g, '')
    .replace(/\\\*/g, '*')
    .replace(/\*\*([^*<>][^*<>]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s>(])\*([^*<>][^*<>]*?)\*(?=[\s<).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/  +/g, ' ');

  // Preserve current query params on internal /start-here links and force them to open in a new tab
  try {
    if (typeof window !== 'undefined') {
      const q = window.location.search || '';
      if (q) {
        safe = safe.replace(/href=(["'])(\/start-here[^'"\s>]*)\1/gi, (m, quote, path) => {
          if (path.includes('?')) return `href=${quote}${path}&${q.replace(/^\?/, '')}${quote}`;
          return `href=${quote}${path}${q}${quote}`;
        });
      }
      safe = safe.replace(/<a([^>]*href=["']\/start-here[^>]*?)>/gi, (m, pre) => {
        if (/target=|rel=/.test(m)) return m;
        return `<a${pre} target="_blank" rel="noopener noreferrer">`;
      });
    }
  } catch {}

  return <div key={keyPrefix} className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: safe }} />;
}

export default renderHelpHtml;
