// Linked Helper Manual Crawler (MVP Scaffold)
// Fills manuals/lh-snapshot/segments.jsonl then triggers index rebuild.
// Configure seeds & limits in lhManual.config.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { seedUrls = [], allowedHostPattern = /.*/, maxPages = 30, concurrency = 2, paceMs = 300, userAgent = 'LH-Manual-Crawler/0.1 (+local dev)' } = require('./lhManual.config');
const { getRuntimeSeeds } = require('./lhManualSeedsRuntime');
const { rebuildIndex } = require('./lhManualIndex');

const SNAPSHOT_DIR = path.join(__dirname, 'manuals', 'lh-snapshot');
const SEGMENTS_FILE = path.join(SNAPSHOT_DIR, 'segments.jsonl');

function hash(str) { return crypto.createHash('sha256').update(str).digest('hex').slice(0,16); }

function normalizeUrl(u) {
  try { const url = new URL(u); url.hash=''; url.searchParams.sort(); return url.toString(); } catch { return null; }
}

function extractMainContent(html) {
  const $ = cheerio.load(html);
  ['script','style','noscript','iframe','nav','header','footer'].forEach(sel=>$(sel).remove());
  $('[class*="nav"],[class*="menu"],[class*="sidebar"],[class*="footer"]').remove();
  const text = $('body').text() || '';
  return text.replace(/\s+/g,' ').trim();
}

function segmentText(text, url) {
  const sentences = text.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
  const segments=[]; let buf=[]; let idx=0;
  for (const s of sentences) {
    buf.push(s);
    const charLen = buf.join(' ').length;
    if (charLen>600 || buf.length>=6) {
      const joined = buf.join(' ');
      segments.push({ id: 'seg-'+hash(url+'::'+idx), url, headingPath: [], text: joined, wordCount: joined.split(/\s+/).length, hash: hash(joined) });
      buf=[]; idx++; }
  }
  if (buf.length) { const joined = buf.join(' '); segments.push({ id: 'seg-'+hash(url+'::'+idx), url, headingPath: [], text: joined, wordCount: joined.split(/\s+/).length, hash: hash(joined) }); }
  return segments;
}

async function fetchPage(url) {
  const resp = await axios.get(url, { headers: { 'User-Agent': userAgent, 'Accept': 'text/html,application/xhtml+xml' } });
  return resp.data;
}

async function crawl() {
  const start = Date.now();
  const activeSeeds = getRuntimeSeeds();
  const effectiveSeeds = activeSeeds.length ? activeSeeds : seedUrls;
  if (!effectiveSeeds.length) return { ok:false, error:'NO_SEED_URLS' };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const queue=[...effectiveSeeds]; const seen=new Set(); const segmentsOut=[]; let active=0; let fetched=0;
  return await new Promise(resolve=>{
    const pump=()=>{
      if ((fetched>=maxPages) || (queue.length===0 && active===0)) {
        const stream = fs.createWriteStream(SEGMENTS_FILE, { encoding:'utf8' });
        for (const seg of segmentsOut) stream.write(JSON.stringify(seg)+'\n');
        stream.end();
        try { rebuildIndex(); } catch(e) { console.warn('[crawler] rebuildIndex error', e.message); }
  return resolve({ ok:true, pages:fetched, segments:segmentsOut.length, ms: Date.now()-start, file: SEGMENTS_FILE, seedsUsed: effectiveSeeds });
      }
      while (active<concurrency && queue.length && fetched<maxPages) {
        const next=queue.shift();
        const norm=normalizeUrl(next); if(!norm || seen.has(norm) || !allowedHostPattern.test(norm)) continue;
        seen.add(norm); active++;
        fetchPage(norm).then(html=>{
          fetched++;
          const main = extractMainContent(html);
            if (main.split(/\s+/).length>10) segmentsOut.push(...segmentText(main, norm));
            const $ = cheerio.load(html);
            $('a[href]').each((_,el)=>{
              const href=$(el).attr('href'); if(!href) return; if (/^mailto:|^javascript:/i.test(href)) return;
              const abs = href.startsWith('http')? href : new URL(href, norm).toString();
              const n=normalizeUrl(abs);
              if (n && !seen.has(n) && allowedHostPattern.test(n) && (queue.length + fetched) < maxPages) queue.push(n);
            });
        }).catch(err=>{
          console.warn('[crawler] fetch failed', norm, err.message);
          fetched++;
        }).finally(()=>{ active--; setTimeout(pump, paceMs); });
      }
    };
    pump();
  });
}

module.exports = { crawl };
