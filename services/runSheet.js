// services/runSheet.js
// Turns an onboarding doc + one client's minted links into a single tick-off page - the run
// sheet Guy follows while onboarding a client. Pure: no network, no filesystem, so the parsers
// and the renderer are pinned by tests/wingguy-run-sheet.test.js. scripts/run-sheet.js is the
// CLI that fetches the client's links and writes the file; the page is then published as an
// Artifact so the ticks save into the page itself and each step can ask Claude to explain.
//
// Two docs feed it:
//   - docs/concierge-run-sheet.md   (Guy does the whole setup over remote access in one sitting)
//   - docs/wingguy-onboarding-checklist.md THE OVERVIEW (the standard week-by-week journey)
// Both stay the master copy of the WORDS. This file only shapes them.

const CONCIERGE_LINKS = { connector: 'connector', unipile: 'unipile', installer: 'installer', none: null };
// Which checklist steps carry which link on the standard journey.
const STANDARD_LINKS = { 1: 'connector', 2: 'unipile', 9: 'installer', 10: 'portal' };

// ---- parsers ----

/** docs/concierge-run-sheet.md -> [{ n, title, phase, who, minutes, link, proves, say, dos, check, watch }] */
function parseConciergeDoc(md) {
  const steps = [];
  const blocks = String(md || '').split(/^## Step /m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const head = lines.shift() || '';
    const m = head.match(/^(\d+)\s*-\s*(.+?)\s*$/);
    if (!m) continue;
    const step = { n: Number(m[1]), title: m[2], phase: '', who: '', minutes: null, link: null, proves: [], why: '', say: '', dos: [], check: '', watch: '' };
    let inDo = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (inDo && /^- /.test(line.trim())) { step.dos.push(line.trim().slice(2).trim()); continue; }
      if (inDo && line.trim() === '') { continue; }
      inDo = false;
      const kv = line.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      if (key === 'phase') step.phase = val;
      else if (key === 'who') step.who = val;
      else if (key === 'minutes') step.minutes = Number(val) || null;
      else if (key === 'link') step.link = Object.prototype.hasOwnProperty.call(CONCIERGE_LINKS, val) ? CONCIERGE_LINKS[val] : null;
      else if (key === 'proves') step.proves = val.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
      else if (key === 'say') step.say = val;
      else if (key === 'why') step.why = val;
      else if (key === 'do') inDo = true;
      else if (key === 'worked when') step.check = val;
      else if (key === 'watch') step.watch = val;
    }
    steps.push(step);
  }
  return steps;
}

/** The checklist's THE OVERVIEW paragraphs -> the same step shape (one "do" = the paragraph). */
function parseStandardOverview(md) {
  const text = String(md || '');
  const start = text.indexOf('## THE OVERVIEW');
  const body = start >= 0 ? text.slice(start) : text;
  const end = body.indexOf('\n## ', 10);
  const section = end >= 0 ? body.slice(0, end) : body;
  const steps = [];
  const re = /^\*\*Step (\d+) - (.+?)\s*\[([a-z, ]+)\]\*\*\s*([\s\S]*?)(?=^\*\*Step \d+ - |\n## |$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(section))) {
    const n = Number(m[1]);
    const title = m[2].replace(/\s*\([^)]*\)\s*$/, '').trim();
    const tag = m[3].trim();
    const para = m[4].replace(/\s+/g, ' ').trim();
    steps.push({
      n, title, phase: tag, who: tag === 'solo' ? 'You alone' : tag === 'homework' ? 'the client, in their own time' : 'together', minutes: null,
      link: STANDARD_LINKS[n] || null, proves: [n], why: '', say: '', dos: [para], check: '', watch: '',
    });
  }
  return steps;
}

// ---- rendering ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{--ground:#F3F4F6;--surface:#fff;--ink:#1B2430;--ink2:#3D4854;--muted:#6B7480;--rule:#DDE2E8;--accent:#0F6E8C;--accent-soft:#E3F0F5;--done:#2E7D4F;--done-soft:#E1F1E7;--warn:#9A5B00;--warn-soft:#FBEBD0;--mono:#EEF1F5}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ground:#141A21;--surface:#1C242E;--ink:#E6EAF0;--ink2:#C3CAD3;--muted:#8E98A5;--rule:#303B48;--accent:#4FB3D1;--accent-soft:#1B3A46;--done:#6CC494;--done-soft:#1E3A2C;--warn:#E5A94A;--warn-soft:#3D2E14;--mono:#111820}}
:root[data-theme="dark"]{--ground:#141A21;--surface:#1C242E;--ink:#E6EAF0;--ink2:#C3CAD3;--muted:#8E98A5;--rule:#303B48;--accent:#4FB3D1;--accent-soft:#1B3A46;--done:#6CC494;--done-soft:#1E3A2C;--warn:#E5A94A;--warn-soft:#3D2E14;--mono:#111820}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;padding-inline:18px;padding-block:28px 60px}
.wrap{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
h1{font-size:24px;margin:0;line-height:1.2}
h2.phase{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 0 0}
.lede{color:var(--ink2);margin:0;font-size:15px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:12px 14px;font-size:14px}
.facts .k{color:var(--muted);font-size:12px}
.facts .bad{color:var(--warn);font-weight:600}
.step{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.step.done{opacity:.55}
.step .head{display:flex;align-items:center;gap:12px}
.step .head input{width:22px;height:22px;accent-color:var(--done);flex:none;cursor:pointer}
.step h3{margin:0;font-size:18px;line-height:1.25}
.step.done h3{text-decoration:line-through;text-decoration-color:var(--muted)}
.step .who{font-size:13px;color:var(--muted);margin:0}
.why{margin:0;color:var(--ink2);font-size:15px}
.say{border-left:3px solid var(--accent);padding:2px 0 2px 12px;margin:0;color:var(--ink2);font-style:italic}
.say b{font-style:normal;color:var(--ink)}
.dos{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px}
.link{display:flex;flex-direction:column;gap:5px}
.link .lbl{font-size:13px;font-weight:600;color:var(--ink2)}
.link .row{display:flex;gap:8px;align-items:stretch}
.link .val{flex:1;min-width:0;font:13px/1.45 Consolas,"Courier New",monospace;background:var(--mono);border:1px solid var(--rule);border-radius:8px;padding:8px 10px;word-break:break-all}
.link .val.empty{color:var(--muted);font-style:italic;font-family:inherit}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--rule);background:var(--surface);color:var(--ink);padding:6px 12px;font-size:13px;font-weight:600}
button.copy{background:var(--accent);color:#fff;border-color:transparent;min-width:70px}
button.copy.ok{background:var(--done)}
.check{background:var(--done-soft);color:var(--done);border-radius:8px;padding:7px 11px;font-size:14px;margin:0}
.watch{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:7px 11px;font-size:14px;margin:0}
.check b,.watch b{color:inherit}
.verdicts{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted)}
.verdicts .v{display:inline-block;min-width:52px;text-align:center;border-radius:4px;padding:0 4px;font-weight:700;margin-right:6px}
.v.done{background:var(--done-soft);color:var(--done)}.v.owed{background:var(--warn-soft);color:var(--warn)}.v.manual{background:var(--mono);color:var(--muted)}
.explain{display:flex;flex-direction:column;gap:6px}
.explain .ask{display:flex;gap:8px}
.explain input{flex:1;font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--rule);border-radius:8px;background:var(--surface);color:var(--ink)}
.explain .out{white-space:pre-wrap;background:var(--accent-soft);border-radius:8px;padding:10px 12px;font-size:14px;color:var(--ink)}
.explain .out:empty{display:none}
.foot{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:13px;border-top:1px solid var(--rule);padding-top:12px;margin-top:6px}
.saving{color:var(--accent)}
[hidden]{display:none!important}
`;

// The page's own script. It renders the body from data + state (the same renderer the generator
// uses at build time, so a republished page is produced from canonical source, never from the
// live DOM), keeps the ticks, and offers "explain this" via the sample capability.
const PAGE_JS = `
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function linkBlock(kind,links,minted){
  var rows=[];
  if(kind==='connector')rows.push(['Paste this into their Claude',links.connectorUrl,'connector']);
  else if(kind==='unipile')rows.push(['Paste this into their browser'+(minted&&minted.mintedAt?' (minted '+minted.mintedAt+', lasts a day)':''),minted&&minted.url,'unipile','Not minted - ask Claude to run the sheet again with --mint']);
  else if(kind==='installer'){rows.push(['Paste this into PowerShell on their machine',links.installerWindows,'installer']);rows.push(['Then open this once in their browser',links.portalUrl,'portal']);}
  else if(kind==='portal')rows.push(['Open this once in their browser',links.portalUrl,'portal']);
  return rows.map(function(r){
    var has=!!r[1];
    return '<div class="link"><span class="lbl">'+esc(r[0])+'</span><div class="row"><div class="val'+(has?'':' empty')+'">'+esc(has?r[1]:(r[3]||'not available - no portal token on the record'))+'</div>'+(has?'<button class="copy" data-copy="'+esc(r[2])+'">Copy</button>':'')+'</div></div>';
  }).join('');
}
function renderBody(data,state){
  var s=state||{ticks:{}};
  var out=[];
  var f=data.client.firstName;
  // The sheet is written to be read by BOTH people on a shared screen, so the doc says {{first}}
  // wherever the client's name goes and "Guy" for the coach. tx() fills the name in, then escapes.
  function tx(v){return esc(String(v==null?'':v).split('{{first}}').join(f));}
  out.push('<div class="wrap">');
  out.push('<div><p class="lede" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">'+esc(data.mode==='concierge'?'Concierge run sheet':'Onboarding run sheet')+'</p><h1>'+esc(data.client.name)+'</h1><p class="lede">'+esc(data.mode==='concierge'?'Guy drives '+f+'\\u2019s computer and does the setup. '+f+' is here for the first twenty-five minutes, then leaves Guy to it. Each step says who does what. Tick them off as you go - the ticks save into this page.':'The standard journey, one step per session or so. Tick each step as it lands - the ticks save into this page.')+'</p><p class="lede" style="font-size:13px">Made '+esc(data.generatedAt)+' from '+esc(f)+'&rsquo;s record.</p></div>');
  var st=data.setup||{};
  out.push('<div class="facts"><div><div class="k">Timezone</div><div class="'+(st.timezone?'':'bad')+'">'+esc(st.timezone||'BLANK - fix first')+'</div></div><div><div class="k">Drafting key</div><div>'+esc(st.managedClaudeKey?'Managed plan':st.hasAnthropicKey?'Own key on record':'Own key, not yet on record')+'</div></div><div><div class="k">Login email</div><div>'+esc(st.loginEmail||'-')+'</div></div><div><div class="k">Calendar and mail</div><div>'+esc(st.unipileConnected?'connected ('+(st.calendarProvider||'unipile')+')':'not connected yet')+'</div></div></div>');
  if(data.facts&&data.facts.length){
    out.push('<div class="facts" style="margin-top:-6px"><div style="grid-column:1/-1" class="k">From '+esc(f)+'&rsquo;s reply</div>'+data.facts.map(function(x){return '<div><div class="k">'+esc(x.k)+'</div><div class="'+(x.v?'':'bad')+'">'+esc(x.v||'not answered - ask on the call')+'</div></div>';}).join('')+'</div>');
  }
  var phase='';
  data.steps.forEach(function(step){
    if(step.phase!==phase){phase=step.phase;out.push('<h2 class="phase">'+tx(phase)+'</h2>');}
    var done=!!s.ticks[String(step.n)];
    out.push('<section class="step'+(done?' done':'')+'" data-step="'+step.n+'">');
    out.push('<div class="head"><input type="checkbox" id="tick-'+step.n+'" data-tick="'+step.n+'"'+(done?' checked':'')+'><h3><label for="tick-'+step.n+'">'+step.n+'. '+tx(step.title)+'</label></h3></div>');
    var w=String(step.who||'');
    var who=(w==='You alone'||w==='Guy alone')?'Guy alone. Nothing for '+f+'.':(/^Guy\\b/.test(w)?w:(f+': '+w));
    out.push('<p class="who">'+tx(who)+(step.minutes?' &middot; about '+step.minutes+' min':'')+'</p>');
    if(step.why)out.push('<p class="why">'+tx(step.why)+'</p>');
    if(step.say)out.push('<p class="say"><b>Say: </b>'+tx(step.say)+'</p>');
    if(step.dos&&step.dos.length)out.push('<ul class="dos">'+step.dos.map(function(d){return '<li>'+tx(d)+'</li>';}).join('')+'</ul>');
    if(step.link)out.push(linkBlock(step.link,data.links||{},data.minted));
    if(step.check)out.push('<p class="check"><b>You\\'ll know it worked when: </b>'+tx(step.check)+'</p>');
    if(step.watch)out.push('<p class="watch"><b>Watch: </b>'+tx(step.watch)+'</p>');
    var vs=(step.proves||[]).map(function(n){return (data.verdicts||{})[n];}).filter(Boolean);
    if(vs.length)out.push('<div class="verdicts">'+vs.map(function(v){return '<div><span class="v '+esc(v.verdict)+'">'+esc(String(v.verdict).toUpperCase())+'</span>'+esc(v.evidence)+'</div>';}).join('')+'<div style="margin-top:2px">What the record said when this page was made.</div></div>');
    out.push('<div class="explain" data-explain="'+step.n+'" hidden><div class="ask"><input type="text" placeholder="I don\\'t get this / what if... (or leave blank for a plain-English explanation)"><button class="go">Ask Claude</button></div><div class="out"></div></div>');
    out.push('</section>');
  });
  out.push('<div class="foot"><span id="status">'+(s.savedAt?'Ticks saved '+esc(s.savedAt):'Nothing ticked yet')+'</span><span><button id="reset">Untick everything</button></span></div>');
  out.push('</div>');
  return out.join('');
}
function buildDocument(data,state){
  var css=document.getElementById('rs-css').textContent;
  var app=document.getElementById('rs-app').textContent;
  return '<!doctype html>\\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(data.client.name)+' run sheet</title><style id="rs-css">'+css+'</style></head><body>'
    +'<script id="rs-data" type="application/json">'+JSON.stringify(data).replace(/<\\//g,'<\\\\/')+'<\\/script>'
    +'<script id="rs-state" type="application/json">'+JSON.stringify(state).replace(/<\\//g,'<\\\\/')+'<\\/script>'
    +renderBody(data,state)
    +'<script id="rs-app">'+app+'<\\/script></body></html>';
}
(function(){
  if(typeof document==='undefined')return;
  var data=JSON.parse(document.getElementById('rs-data').textContent);
  var state=JSON.parse(document.getElementById('rs-state').textContent||'{}');
  state.ticks=state.ticks||{};
  var KEY='run-sheet:'+data.client.id;
  var artifact=null,sample=null,readOnly=false;
  try{var local=localStorage.getItem(KEY);if(local&&!state.savedAt){var l=JSON.parse(local);state.ticks=Object.assign({},state.ticks,l.ticks||{});}}catch(e){}
  var root=document.body;
  function paint(){
    var wrap=document.querySelector('.wrap');
    var tmp=document.createElement('div');tmp.innerHTML=renderBody(data,state);
    wrap.replaceWith(tmp.firstChild);
    wire();
  }
  function status(t,cls){var el=document.getElementById('status');if(el){el.textContent=t;el.className=cls||'';}}
  var timer=null;
  function persist(){
    try{localStorage.setItem(KEY,JSON.stringify({ticks:state.ticks}));}catch(e){}
    if(!artifact||readOnly){status('Ticks kept in this browser');return;}
    clearTimeout(timer);
    status('Saving\\u2026','saving');
    timer=setTimeout(function(){
      var next=Object.assign({},state,{savedAt:new Date().toLocaleString('en-AU',{hour:'numeric',minute:'2-digit',day:'numeric',month:'short'})});
      try{sessionStorage.setItem(KEY+':pending',JSON.stringify(next.ticks));}catch(e){}
      artifact.publish(buildDocument(data,next)).then(function(){/* the view reloads to the new version */}).catch(function(e){
        if(e&&(e.code==='not_writer'||e.code==='not_granted'||e.code==='not_declared')){readOnly=true;status('Read-only view - ticks kept in this browser only');}
        else if(e&&e.code==='conflict'){/* reload is on its way */}
        else status('Could not save ('+(e&&e.code||'error')+') - ticks kept in this browser');
      });
    },900);
  }
  function wire(){
    document.querySelectorAll('[data-tick]').forEach(function(cb){cb.addEventListener('change',function(){
      state.ticks[cb.dataset.tick]=cb.checked;
      cb.closest('.step').classList.toggle('done',cb.checked);
      persist();
    });});
    document.querySelectorAll('button.copy').forEach(function(b){b.addEventListener('click',function(){
      var v=b.previousElementSibling.textContent;
      function ok(){b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent='Copy';b.classList.remove('ok');},1400);}
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(v).then(ok,ok);else ok();
    });});
    var r=document.getElementById('reset');if(r)r.addEventListener('click',function(){if(!confirm('Untick every step on this sheet?'))return;state.ticks={};paint();persist();});
    document.querySelectorAll('[data-explain]').forEach(function(box){
      if(!sample)return;
      box.hidden=false;
      var btn=box.querySelector('button.go'),inp=box.querySelector('input'),out=box.querySelector('.out');
      function run(){
        var n=box.dataset.explain;var step=data.steps.filter(function(s){return String(s.n)===n;})[0];
        var q=(inp.value||'').trim();
        var prompt='You are helping Guy, a coach in Brisbane, who is onboarding a client called '+data.client.name+' onto Wingguy (his AI assistant that lives inside the client\\'s Claude, reads their calendar and email, and drafts LinkedIn messages). '+(data.mode==='concierge'?'Guy is doing the whole setup himself over remote access in one sitting.':'This is the standard week-by-week journey.')+'\\n\\nHere is the complete run sheet he is following:\\n\\n'+data.docText.slice(0,40000)+'\\n\\nHe is on step '+n+' ("'+step.title+'").\\n\\n'+(q?'His question: '+q:'Explain this step to him in plain English - what it does, why it matters, and the one thing most likely to go wrong.')+'\\n\\nAnswer in plain English, short, Australian spelling, a spaced short dash " - " never an em dash. What a thing does before what it is called. Give a recommendation and the reason, not a menu of options.';
        btn.disabled=true;out.textContent='Thinking\\u2026';
        sample(prompt,{onText:function(u){out.textContent=u.text;}}).then(function(r){out.textContent=r.text;}).catch(function(e){
          if(e&&e.code==='not_granted'){box.hidden=true;}
          else out.textContent=(e&&e.text)||('Could not ask Claude ('+(e&&e.code||'error')+'). Try again in a moment.');
        }).then(function(){btn.disabled=false;});
      }
      btn.addEventListener('click',run);
      inp.addEventListener('keydown',function(ev){if(ev.key==='Enter')run();});
    });
  }
  wire();
  if(window.claude&&window.claude.use){
    window.claude.use('artifact').then(function(a){artifact=a;if(a){try{var p=sessionStorage.getItem(KEY+':pending');if(p){sessionStorage.removeItem(KEY+':pending');}}catch(e){}}});
    window.claude.use('sample').then(function(s){sample=s;if(s)document.querySelectorAll('[data-explain]').forEach(function(b){b.hidden=false;});wire();});
  }
})();
`;

/**
 * Render the whole page. `data` = { mode, client:{id,name,firstName}, links, setup, minted,
 * verdicts:{n:{verdict,evidence}}, steps, docText, generatedAt }, `state` = { ticks }.
 */
function renderRunSheet(data, state = { ticks: {} }) {
  // Run the page's own renderBody in Node so the initial body is byte-for-byte what a republish
  // would produce - one renderer, two hosts.
  const fn = new Function('data', 'state', `${PAGE_JS.split('(function(){')[0]}; return renderBody(data, state);`);
  const body = fn(data, state);
  const json = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(data.client.name)} run sheet</title><style id="rs-css">${CSS}</style></head><body>` +
    `<script id="rs-data" type="application/json">${json(data)}</script>` +
    `<script id="rs-state" type="application/json">${json(state)}</script>` +
    body +
    `<script id="rs-app">${PAGE_JS}</script></body></html>`;
}

/** Shape the data object from a board detail payload + the parsed steps. */
function buildData({ mode, detail, steps, docText, minted, facts = [], now = new Date() }) {
  const name = detail.clientName || detail.clientId;
  const verdicts = {};
  for (const s of (detail.preflight && detail.preflight.steps) || []) verdicts[s.n] = { verdict: s.verdict, evidence: s.evidence };
  return {
    mode,
    client: { id: detail.clientId, name, firstName: String(name).split(' ')[0] },
    links: detail.links || {},
    setup: detail.setup || {},
    // What the client said in their reply to the pre-session email (address, recorder, machine,
    // the day) - so on the day nothing has to be hunted for in the inbox. [{k, v}]; a blank v
    // renders as "not answered - ask on the call".
    facts: (facts || []).map((x) => ({ k: String(x.k || '').trim(), v: String(x.v == null ? '' : x.v).trim() })).filter((x) => x.k),
    minted: minted ? { url: minted.url, mintedAt: now.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) } : null,
    verdicts,
    steps,
    // The doc feeds the page's "Ask Claude" prompt, so the client's name goes in here too.
    docText: String(docText || '').split('{{first}}').join(String(name).split(' ')[0]),
    generatedAt: now.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

/**
 * The starting ticks: a step arrives ticked when EVERY checklist step it proves is DONE on the
 * live preflight. So a sheet made for a client part-way through the journey opens showing where
 * they are, not blank (Guy, 2026-09-16). Steps that prove nothing (remote access, the
 * pre-session answers) start unticked - only Guy knows.
 */
function initialTicks(data) {
  const ticks = {};
  for (const s of data.steps || []) {
    if (!s.proves || !s.proves.length) continue;
    const all = s.proves.every((n) => data.verdicts[n] && data.verdicts[n].verdict === 'done');
    if (all) ticks[String(s.n)] = true;
  }
  return ticks;
}

module.exports = { parseConciergeDoc, parseStandardOverview, renderRunSheet, buildData, initialTicks, STANDARD_LINKS, PAGE_JS, CSS };
