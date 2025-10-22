"use client";
import React from 'react';
import ReactDOM from 'react-dom/client';
import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';

// Shared HTML normalizer/renderer - uses react-medium-image-zoom library
export function renderHelpHtml(html, keyPrefix) {
  if (!html) return null;
  let safe = String(html);

  // Inject heading classes
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

  // Mark images for React zoom wrapping
  safe = safe.replace(/<img([^>]*)>/gi, (match, attrs) => {
    const uniqueId = 'zoom-' + Math.random().toString(36).substr(2, 9);
    return `<span data-zoom-placeholder="${uniqueId}" data-img-attrs="${attrs.replace(/"/g, '&quot;')}"></span>`;
  });

  // List styling
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
  safe = safe
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul$1 style="margin:0;padding-left:1.25rem;list-style:disc;">')
    .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol$1 style="margin:0;padding-left:1.25rem;list-style:decimal;">')
    .replace(/<\/li>\s+<li/gi, '</li><li');

  // Fix kbd tags
  safe = safe.replace(/&lt;kbd&gt;([\s\S]*?)&lt;\/kbd&gt;/gi, '<kbd>$1</kbd>');
  safe = safe.replace(/<kbd(?![^>]*class=)([^>]*)>/gi, '<kbd class="mx-0.5 rounded border border-gray-300 bg-gray-100 px-1 py-0.5 text-[0.75rem] font-medium text-gray-800 align-baseline"$1>');

  // Strip tokens
  safe = safe
    .replace(/:contentReference\[[^\]]+\]\{[^}]*\}/g, '')
    .replace(/:oaicite\[[^\]]+\]\{[^}]*\}/g, '')
    .replace(/\\\*/g, '*')
    .replace(/\*\*([^*<>][^*<>]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s>(])\*([^*<>][^*<>]*?)\*(?=[\s<).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/  +/g, ' ');

  // Handle /start-here links
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

  return <HelpHtmlContent key={keyPrefix} html={safe} />;
}

// Component that uses react-medium-image-zoom library
class HelpHtmlContent extends React.Component {
  containerRef = React.createRef();
  roots = [];

  componentDidMount() {
    this.renderZoomImages();
  }

  componentDidUpdate() {
    this.renderZoomImages();
  }

  componentWillUnmount() {
    this.roots.forEach(root => {
      try {
        root.unmount();
      } catch (e) {}
    });
    this.roots = [];
  }

  renderZoomImages() {
    if (!this.containerRef.current) return;

    const placeholders = this.containerRef.current.querySelectorAll('[data-zoom-placeholder]:not([data-zoom-rendered])');
    
    placeholders.forEach(placeholder => {
      const attrs = placeholder.getAttribute('data-img-attrs')?.replace(/&quot;/g, '"') || '';
      
      const srcMatch = attrs.match(/src=["']([^"']*)["']/);
      const altMatch = attrs.match(/alt=["']([^"']*)["']/);
      
      const src = srcMatch ? srcMatch[1] : '';
      const alt = altMatch ? altMatch[1] : '';
      
      if (!src) return;
      
      const wrapper = document.createElement('div');
      wrapper.className = 'my-4';
      wrapper.setAttribute('data-zoom-rendered', 'true');
      placeholder.parentNode.replaceChild(wrapper, placeholder);
      
      const root = ReactDOM.createRoot(wrapper);
      root.render(
        <Zoom>
          <img 
            src={src} 
            alt={alt}
            style={{ maxWidth: '2000px', width: '100%', height: 'auto', cursor: 'zoom-in' }}
          />
        </Zoom>
      );
      
      this.roots.push(root);
    });
  }

  render() {
    return (
      <div ref={this.containerRef} className="prose prose-sm max-w-none">
        <div dangerouslySetInnerHTML={{ __html: this.props.html }} />
      </div>
    );
  }
}

export default renderHelpHtml;
