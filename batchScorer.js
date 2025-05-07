/* ===================================================================
   batchScorer.js – fast chunk-mode scorer (replaces JSONL Batch flow)
   -------------------------------------------------------------------
   • Pulls un-scored leads               (/run-batch-score?limit=N)
   • Slices them into CHUNK_SIZE chunks  (env, default 40)
   • Sends one chunk at a time to GPT-4o
   • 60-second timeout, 3 retries, token split guard
   • Computes finalPct & hybrid breakdown locally
   • Mailgun email on error/timeout (+ optional success ping)
=================================================================== */
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");
const tiktoken = require("@dqbd/tiktoken");
const Airtable  = require("airtable");
const fetch     = (...a)=>import("node-fetch").then(({default:f})=>f(...a));

const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }           = require("./attributeLoader");
const { computeFinalScore }        = require("./scoring");
const { buildAttributeBreakdown }  = require("./breakdown");
const { callGptScoring }           = require("./callGptScoring");

/* ---------- Env + constants ------------------------------------ */
const MODEL           = process.env.GPT_MODEL || "gpt-4o";
const CHUNK_SIZE      = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE||"40",10));
const GPT_TIMEOUT_MS  = Math.max(10000, parseInt(process.env.GPT_TIMEOUT_MS||"60000",10));
const TOKEN_SOFT_CAP  = 7500;      // stay safely below 8192
const MAX_RETRIES     = 3;

/* ---------- OpenAI + Airtable setup ---------------------------- */
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- Token counter -------------------------------------- */
const encoder = tiktoken.getEncoding("cl100k_base");
const tokens  = s => encoder.encode(s).length;

/* ---------- Mailgun alert helper ------------------------------- */
async function alertAdmin(subj,msg,kind="error"){
  if(kind==="success"&&process.env.ALERT_VERBOSE!=="true")return;
  const { MAILGUN_API_KEY:key, MAILGUN_DOMAIN:dom, ALERT_EMAIL:to }=process.env;
  if(!key||!dom||!to) return;
  const auth=Buffer.from(`api:${key}`).toString("base64");
  const body=new URLSearchParams({
    from:`AI Scorer <noreply@${dom}>`, to, subject:subj,
    text: msg.slice(0,2000)
  });
  await fetch(`https://api.mailgun.net/v3/${dom}/messages`,{
    method:"POST", headers:{Authorization:`Basic ${auth}`}, body
  }).catch(()=>{});
}

/* ---------- GPT call with timeout ------------------------------ */
function gptWithTimeout(messages){
  const call  = openai.createChatCompletion({ model:MODEL, temperature:0, messages });
  const timer = new Promise((_,rej)=>setTimeout(()=>rej(new Error("GPT timeout")),GPT_TIMEOUT_MS));
  return Promise.race([call,timer]);
}

/* ---------- Queue machinery ------------------------------------ */
let pending=[], busy=false;
async function enqueue(chunk,attempt=1){ pending.push({chunk,attempt}); runQueue(); }

async function runQueue(){
  if(busy) return;
  const job=pending.shift(); if(!job) return;
  busy=true;
  try{ await scoreChunk(job.chunk); }
  catch(err){
    console.error("Chunk error:",err.message);
    await alertAdmin("Chunk scoring error",err.stack||String(err));
    if(job.attempt<MAX_RETRIES){
      console.log("Retrying chunk…");
      pending.unshift({chunk:job.chunk, attempt:job.attempt+1});
    }else{
      console.error("Max retries reached, marking leads Failed.");
      await Promise.all(job.chunk.map(r=>base("Leads").update(r.id,{ "Scoring Status":"Failed"})));
    }
  }finally{
    busy=false;
    if(!pending.length) await alertAdmin("Batch complete","All chunks processed","success");
    runQueue();
  }
}

/* ---------- Core scorer for one chunk -------------------------- */
async function scoreChunk(records){
  const fullPrompt = await buildPrompt();
  const slimLeads  = records.map(r=>slimLead(JSON.parse(r.get("Profile Full JSON")||"{}")));
  const userMsg    = JSON.stringify({ leads: slimLeads });

  /* Split chunk if token budget blown */
  if(tokens(fullPrompt)+tokens(userMsg) > TOKEN_SOFT_CAP && records.length>1){
    const mid=Math.ceil(records.length/2);
    await enqueue(records.slice(0,mid));
    await enqueue(records.slice(mid));
    return;
  }

  const messages=[
    { role:"system", content: fullPrompt },
    { role:"user",   content:"Return results array in same order:\n"+userMsg }
  ];
  const resp = await gptWithTimeout(messages);
  const parsed = JSON.parse(resp.data.choices[0].message.content); // array of results

  const { positives, negatives } = await loadAttributes();

  for(let i=0;i<records.length;i++){
    const rec   = records[i];
    const gpt   = callGptScoring(JSON.stringify(parsed[i])); // ensure same parser
    /* compute finalPct if GPT didn’t */
    const { percentage, rawScore:earned, denominator:max } = computeFinalScore(
      gpt.positive_scores, positives,
      gpt.negative_scores, negatives,
      gpt.contact_readiness, gpt.unscored_attributes||[]
    );
    gpt.finalPct = Math.round((gpt.finalPct??(percentage))*100)/100;

    const breakdown = buildAttributeBreakdown(
      gpt.positive_scores, positives,
      gpt.negative_scores, negatives,
      gpt.unscored_attributes||[], earned, max,
      gpt.attribute_reasoning||{}, false, null
    );

    await base("Leads").update(rec.id,{
      "AI Score"              : gpt.finalPct,
      "AI Profile Assessment" : gpt.aiProfileAssessment||"",
      "AI Attribute Breakdown": breakdown,
      "Scoring Status"        : "Scored",
      "Date Scored"           : new Date().toISOString().split("T")[0],
      "AI_Excluded"           : (gpt.ai_excluded||"No")==="Yes",
      "Exclude Details"       : gpt.exclude_details||""
    });
  }
}

/* ---------- Public runner (used by /run-batch-score) ----------- */
async function run(limit=1600){
  console.log("▶︎ batchScorer.run — limit",limit);
  const recs = await base("Leads")
      .select({ filterByFormula:'{Scoring Status} = "To Be Scored"', maxRecords:limit })
      .firstPage();
  if(!recs.length){ console.log("No leads need scoring"); return; }

  const chunks=[]; for(let i=0;i<recs.length;i+=CHUNK_SIZE) chunks.push(recs.slice(i,i+CHUNK_SIZE));
  chunks.forEach(c=>enqueue(c));
  console.log(`Queued ${recs.length} leads in ${chunks.length} chunk(s) of ${CHUNK_SIZE}`);
}

module.exports={ run };