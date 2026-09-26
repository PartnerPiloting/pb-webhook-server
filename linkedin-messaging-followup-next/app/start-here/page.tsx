"use client";
// "What Wingguy can do" - organised by PLACE, not by job: three colour-blocked bands (LinkedIn /wg,
// Ask Claude, screens here) and two message bands: call recordings (the raw material) and voice
// (the drafts sound like you, and you can keep tuning it - Guy, 26 Sep: the #1 objection is "AI
// will sound like AI"; the answer is a message on the page, not a card named after a settings tab).
//
// Why (Guy, 26 Sep 2026): the previous job-by-job table gave every row equal weight - a wall of text
// where the magic phrases sat in fine print. The page's own headline is "it's on LinkedIn, and in
// Claude", so the layout now says that too: each place is one band, and the Claude phrases are the
// visual heroes (buttons, not footnotes). The recordings band replaced a one-line amber note because
// clients think transcripts are something you LOOK AT, when they are the raw material for the prep,
// the follow-up drafts and New Leads - "you never open a transcript" is the reframe.
//
// History: until 24 Sep 2026 a 63-topic manual from the Airtable Help table; 24-25 Sep a learning
// signpost; 25 Sep the job-by-job map. All in git history (git log -- <this file>).
//
// The URL stays /start-here on purpose: 420 onboarding tasks and older emails link to
// /start-here?topic=..., and they land here instead of dying. The topic param is ignored.
//
// Every phrase a client is told to type below is REGISTERED in content/client-phrases.json, which
// stamps it into the answering tool's description and tests that this file still contains it.
// Change a phrase there first, then here - node tests/client-phrases.test.js fails if they drift.
import React, { useState } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import EnvironmentValidator from '../../components/EnvironmentValidator';
import Layout from '../../components/Layout';
import { getClientProfile, buildAuthUrl } from '../../utils/clientUtils';

export const dynamic = 'force-dynamic';

// The client view of the series library. Without ?audience=client it serves the PROSPECT version.
const LIBRARY_URL = 'https://knowaguy.com.au/series?audience=client';

// "Still stuck" goes to Guy, not to Claude: by then they have already asked Wingguy.
const GUY_EMAIL = 'guy@knowaguy.com.au';
const STUCK_MAILTO = `mailto:${GUY_EMAIL}?subject=${encodeURIComponent("I'm stuck - can you help?")}`;

// Registered in content/client-phrases.json - see the note at the top.
const OPENER = 'where are we up to?';
const EVERYTHING = 'read me everything';
const METHOD_QUESTIONS = [
  'Who should I be connecting with?',
  'What do I say to thank someone for connecting?',
  'How do I keep on top of follow-ups?',
];

// The Claude band: each phrase with the moment you'd reach for it. All registered.
const CHIPS: { say: string; when: string }[] = [
  { say: 'prep me for my meetings', when: "before today's calls" },
  { say: 'draft the follow-up from my last call', when: 'straight after you hang up' },
  { say: 'show me my follow-ups', when: 'who you owe a reply, drafts ready' },
  { say: "what's on my calendar this week?", when: 'see your week' },
  { say: 'review my edits', when: 'make it sound more like you' },
  { say: "let's set up my instructions", when: 'tell it how you like things written' },
  { say: 'what can I do with Wingguy?', when: 'not sure what to ask? start here' },
];

// Opens a NEW chat in the Claude desktop app with the text already typed in. There is no reliable
// equivalent for Claude in a browser, so every phrase also has a Copy button.
const claudeLink = (text: string) => `claude://claude.ai/new?q=${encodeURIComponent(text)}`;

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more we can do */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={copy} className="text-xs text-gray-500 hover:text-gray-800" title="Copy, then paste it into Claude">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

// A phrase said inline in a sentence: quoted, opens Claude when live.
const Say: React.FC<{ text: string; live: boolean }> = ({ text, live }) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    {live ? (
      <a href={claudeLink(text)} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[13px] text-gray-900 hover:bg-gray-200" title="Opens a new chat in the Claude app with this already typed in">
        &ldquo;{text}&rdquo;
      </a>
    ) : (
      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[13px] text-gray-900">&ldquo;{text}&rdquo;</span>
    )}
    {live && <CopyButton text={text} />}
  </span>
);

// One colour-blocked band: tinted header strip, white body. Tailwind needs the class strings whole,
// so each tone is spelled out rather than built from the colour name.
const TONES = {
  sky: { head: 'bg-sky-50 border-sky-100', num: 'bg-sky-100 text-sky-700', tick: 'text-sky-600', border: 'border-gray-200' },
  orange: { head: 'bg-orange-50 border-orange-100', num: 'bg-orange-100 text-orange-700', tick: 'text-orange-600', border: 'border-gray-200' },
  blue: { head: 'bg-blue-50 border-blue-100', num: 'bg-blue-100 text-blue-700', tick: 'text-blue-700', border: 'border-gray-200' },
  amber: { head: 'bg-amber-50 border-amber-200', num: '', tick: 'text-orange-600', border: 'border-amber-200' },
  violet: { head: 'bg-violet-50 border-violet-100', num: '', tick: 'text-violet-600', border: 'border-violet-100' },
} as const;
type Tone = keyof typeof TONES;

const Band: React.FC<{ tone: Tone; num?: string; title: React.ReactNode; how: string; children: React.ReactNode }> = ({ tone, num, title, how, children }) => (
  <section className={`mt-5 overflow-hidden rounded-xl border bg-white shadow-sm ${TONES[tone].border}`}>
    <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-6 py-4 ${TONES[tone].head}`}>
      <h2 className="flex items-center gap-2.5 text-[17px] font-semibold text-gray-900">
        {num && <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold ${TONES[tone].num}`}>{num}</span>}
        {title}
      </h2>
      <span className="text-sm text-gray-500">{how}</span>
    </div>
    <div className="px-6 py-4">{children}</div>
  </section>
);

const Tick: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <div className="flex items-baseline gap-2.5 py-1.5 text-[15px] text-gray-700">
    <span className={`font-bold ${TONES[tone].tick}`}>&#10003;</span>
    <span>{children}</span>
  </div>
);

const WhatWingguyCanDo: React.FC = () => {
  // Layout only mounts its children once the client is initialised, so the profile is ready here.
  const [profile] = useState<any>(() => getClientProfile());
  // The Claude and /wg parts only work once Wingguy is switched on. Without it the Claude links would
  // open plain Claude answering from general knowledge, so phrases render as plain text and a note says why.
  const wingguyOn = profile?.features?.wingguy === true;

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">What Wingguy can do</h1>
      <p className="mt-2 text-base text-gray-600">
        Most of it doesn&apos;t live in these tabs. It happens in three places - here&apos;s each one.
      </p>

      {!wingguyOn && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Wingguy isn&apos;t switched on for you yet, so the /wg and Claude parts below won&apos;t work until it is.
          Let me know and we&apos;ll set it up together.
        </p>
      )}

      <Band
        tone="sky"
        num="1"
        title={<>On LinkedIn <span className="font-normal text-gray-500">- type</span> <span className="rounded-md bg-gray-900 px-2 py-0.5 font-mono text-[15px] text-white">/wg</span></>}
        how="in any message box. That's the whole trick."
      >
        <Tick tone="sky"><strong className="font-semibold text-gray-900">Welcome a new connection</strong> - writes it from their profile, in your voice</Tick>
        <Tick tone="sky"><strong className="font-semibold text-gray-900">Reply to any message</strong> - reads the whole thread first</Tick>
        <Tick tone="sky">
          <strong className="font-semibold text-gray-900">Offer meeting times</strong> - three times you&apos;re really free, on their clock.
          When they pick one, tell Claude <Say text="book it" live={wingguyOn} />
        </Tick>
      </Band>

      <Band
        tone="orange"
        num="2"
        title="Ask Claude"
        how={wingguyOn ? 'click a phrase to start the chat - or Copy and paste it in.' : 'these work once Wingguy is switched on.'}
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {CHIPS.map((c) => (
            <div key={c.say} className="flex items-start justify-between gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3.5 py-2.5">
              <span className="min-w-0">
                {wingguyOn ? (
                  <a href={claudeLink(c.say)} className="font-mono text-[14px] font-semibold text-gray-900 hover:underline" title="Opens a new chat in the Claude app with this already typed in">
                    &ldquo;{c.say}&rdquo;
                  </a>
                ) : (
                  <span className="font-mono text-[14px] font-semibold text-gray-900">&ldquo;{c.say}&rdquo;</span>
                )}
                <span className="mt-0.5 block text-[12.5px] text-gray-500">{c.when}</span>
              </span>
              {wingguyOn && <CopyButton text={c.say} />}
            </div>
          ))}
        </div>
      </Band>

      <Band tone="blue" num="3" title="Screens here" how="the tabs that matter day to day.">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            // Queues first, levers last - the top three are things waiting for you.
            { name: 'Thanks for Connecting', href: '/thanks-for-connecting', what: "who's new, best first - welcome them properly" },
            { name: 'Follow-Ups', href: '/followups', what: 'sorted overnight, drafts ready' },
            { name: 'New Leads', href: '/new-leads', what: 'people you met on calls, waiting with the transcript' },
            { name: 'Lead Search & Update', href: '/', what: 'search a name or paste a LinkedIn URL - their whole story, every detail fixable' },
            { name: 'Your scoring rules', href: '/settings', what: 'what makes a lead worth your time - every new lead is scored against them, yours to tune (under Settings)' },
          ].map((s) => (
            <a key={s.name} href={buildAuthUrl(s.href)} className="block rounded-lg border border-gray-200 px-3.5 py-3 hover:border-blue-100 hover:bg-blue-50">
              <span className="text-[15px] font-semibold text-blue-700">{s.name}</span>
              <span className="mt-0.5 block text-[13px] text-gray-600">{s.what}</span>
            </a>
          ))}
        </div>
      </Band>

      <Band
        tone="amber"
        title="It all runs on your call recordings"
        how="every call you record is transcribed automatically - you never open a transcript."
      >
        <Tick tone="amber"><strong className="font-semibold text-gray-900">The prep</strong> knows what you both said last time - not just who the meeting is with</Tick>
        <Tick tone="amber"><strong className="font-semibold text-gray-900">The follow-up draft</strong> picks up what they actually said on the call - it reads like you wrote it ten minutes after hanging up</Tick>
        <Tick tone="amber"><strong className="font-semibold text-gray-900">Someone you met on a call</strong> lands on New Leads by themselves, transcript attached</Tick>
        <p className="mt-2.5 text-[15px] font-semibold text-gray-900">The more calls you record, the sharper all of the above gets - and the less typing you do.</p>
      </Band>

      <Band
        tone="violet"
        title="It sounds like you - because it's built from you"
        how="the drafts aren't AI-generated - Wingguy works out what you would say, and you can keep tuning it."
      >
        <Tick tone="violet">
          {wingguyOn ? (
            <a href={buildAuthUrl('/my-wingguy/setup')} className="font-semibold text-gray-900 hover:underline">Give it your instructions</a>
          ) : (
            <strong className="font-semibold text-gray-900">Give it your instructions</strong>
          )}
          {' '}- how you open, how you sign off, what you&apos;d never say
        </Tick>
        <Tick tone="violet">
          <strong className="font-semibold text-gray-900">Every edit teaches it</strong> - change a draft before sending, then say{' '}
          <Say text="review my edits" live={wingguyOn} /> and it learns the pattern
        </Tick>
        <Tick tone="violet">
          <strong className="font-semibold text-gray-900">Nothing is hidden</strong> -{' '}
          {wingguyOn ? (
            <a href={buildAuthUrl('/my-wingguy/review')} className="text-violet-700 hover:underline">What&apos;s changed lately</a>
          ) : (
            <span>What&apos;s changed lately</span>
          )}
          {' '}lists every adjustment, with an undo on each
        </Tick>
        <p className="mt-2.5 text-[15px] font-semibold text-gray-900">Keep honing and the drafts get better than what you&apos;d dash off on a busy Tuesday - that&apos;s the goal.</p>
      </Band>

      <div className="mt-6 space-y-2 text-sm text-gray-500">
        <p>
          {wingguyOn ? (
            <>New here? <a href={buildAuthUrl('/my-wingguy')} className="font-medium text-blue-700 hover:underline">Set up Wingguy &rarr;</a>{' '}&middot;{' '}</>
          ) : null}
          Curious how it thinks? Ask Claude <Say text={OPENER} live={wingguyOn} /> or{' '}
          <a href={LIBRARY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">read the library &rarr;</a>
        </p>
        <p>
          Good method questions:{' '}
          {METHOD_QUESTIONS.map((q, i) => (
            <span key={q}>
              {i > 0 && ' · '}
              {wingguyOn ? (
                <a href={claudeLink(q)} className="text-blue-700 hover:underline">&ldquo;{q}&rdquo;</a>
              ) : (
                <span>&ldquo;{q}&rdquo;</span>
              )}
            </span>
          ))}
          {' '}- or say <strong>&ldquo;{EVERYTHING}&rdquo;</strong> for the whole lot.
        </p>
        <p>
          Stuck on a particular screen? The <strong>Help</strong> button at the top of every screen explains it. Still stuck?{' '}
          <a href={STUCK_MAILTO} className="font-medium text-blue-700 hover:underline">Email me &rarr;</a>
        </p>
        {wingguyOn && (
          <p className="text-xs text-gray-400">
            Clicking a phrase opens it in the Claude app on your computer. Using Claude in a web browser? Click <strong>Copy</strong> and paste it into a new chat.
          </p>
        )}
      </div>
    </div>
  );
};

export default function StartHerePage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <div className="w-full pt-2">
            <WhatWingguyCanDo />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
