// helpHtmlToText.js
// Shared lightweight HTML -> plain text normalizer for help system (embedding, lexical, QA)
// Intent: preserve list semantics and alt text while stripping markup; safe for untrusted HTML (scripts/styles removed)

function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<style[\s\S]*?<\/style>/gi,'');
  out = out.replace(/<(?:p|div|section|article|h[1-6]|li|ul|ol|blockquote|pre|br)[^>]*>/gi, m => {
    if (/^<br/i.test(m)) return '\n';
    if (/^<li/i.test(m)) return '\n- ';
    return '\n';
  });
  out = out.replace(/<\/(?:p|div|section|article|h[1-6]|li|ul|ol|blockquote|pre)>/gi,'\n');
  out = out.replace(/<img[^>]*>/gi, tag => {
    const alt = (tag.match(/alt=["']([^"']*)["']/i)||[])[1];
    return alt ? ` ${alt} ` : ' [image] ';
  });
  out = out.replace(/<a[^>]*>([^<]{0,120})<\/a>/gi, (m,text)=> ` ${text.trim()} `);
  out = out.replace(/<[^>]+>/g,'');
  out = out.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  out = out.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
  // Collapse excessive spaces
  out = out.replace(/ {2,}/g,' ');
  return out.trim();
}

module.exports = { htmlToText };
