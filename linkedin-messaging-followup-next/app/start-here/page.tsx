"use client";
// "What Wingguy can do" - the map of a working day: each job, and WHERE it happens.
//
// Why (Guy, 25 Sep 2026): the tab bar reads as the full list of what a client can do, but the best of it
// has no tab - it happens via /wg inside LinkedIn and by asking Claude. A client who has seen a demo goes
// looking for it and finds nothing. So this tab was renamed from "Start Here", moved to the FRONT of the
// tab bar, and turned from a learning signpost into this map. The learning signpost (set up Wingguy /
// ask Claude / read the library) survives as the smaller section at the bottom.
//
// History: until 24 Sep 2026 this was a 63-topic manual pulled from the Airtable Help table; 24-25 Sep a
// one-screen signpost. Both are in git history (git log -- linkedin-messaging-followup-next/app/start-here/page.tsx).
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

// Opens a NEW chat in the Claude desktop app with the text already typed in. There is no reliable
// equivalent for Claude in a browser, so every phrase also has a Copy button.
const claudeLink = (text: string) => `claude://claude.ai/new?q=${encodeURIComponent(text)}`;

type Where = 'portal' | 'linkedin' | 'claude';
type Step = { where: Where; label?: string; href?: string; say?: string; or?: string; text?: string };
type Job = { job: string; steps: Step[]; needsWingguy?: boolean };
type Group = { heading: string; jobs: Job[] };

// The map. Portal steps name a tab and link to it; LinkedIn steps are /wg; Claude steps carry the exact
// phrase to say. Keep it to jobs a client does in a normal week - depth lives in Wingguy Learning.
const GROUPS: Group[] = [
  {
    heading: 'When someone connects',
    jobs: [
      { job: 'Welcome new connections, properly', steps: [
        { where: 'portal', label: 'Thanks for Connecting', href: '/thanks-for-connecting', text: "lists who's new, best first" },
        { where: 'linkedin', text: 'in their message box writes the welcome from their profile' },
      ] },
      { job: 'Add someone you met on a call', steps: [
        { where: 'portal', label: 'New Leads', href: '/new-leads', text: "they're already waiting there, transcript attached" },
      ] },
    ],
  },
  {
    heading: 'In the conversation',
    jobs: [
      { job: 'Reply to a LinkedIn message', steps: [
        { where: 'linkedin', text: 'in the conversation. It reads the whole thread and writes the reply.' },
      ] },
      { job: 'Offer times and book the meeting', steps: [
        { where: 'linkedin', text: "offers three times you're really free, on their clock" },
        { where: 'claude', text: 'when they pick one:', say: 'book it' },
      ] },
    ],
  },
  {
    heading: 'Around your meetings',
    jobs: [
      { job: "Get ready for today's calls", steps: [{ where: 'claude', say: 'prep me for my meetings' }] },
      { job: 'Write the follow-up after a call', steps: [{ where: 'claude', say: 'draft the follow-up from my last call' }] },
      { job: 'See your week', steps: [{ where: 'claude', say: "what's on my calendar this week?" }] },
    ],
  },
  {
    heading: 'Keeping on top of it',
    jobs: [
      { job: 'See who you owe a reply', steps: [
        { where: 'portal', label: 'Follow-Ups', href: '/followups', text: 'sorted overnight, drafts ready' },
        { where: 'claude', say: 'show me my follow-ups' },
      ] },
      { job: 'Make it sound more like you', steps: [
        { where: 'claude', say: 'review my edits', or: "let's set up my instructions" },
      ] },
      { job: 'Not sure what to ask?', steps: [{ where: 'claude', say: 'what can I do with Wingguy?' }] },
    ],
  },
];

const PILL: Record<Where, string> = {
  portal: 'bg-blue-50 text-blue-700',
  linkedin: 'bg-sky-50 text-sky-700',
  claude: 'bg-orange-50 text-orange-700',
};
const PILL_TEXT: Record<Where, string> = { portal: 'A screen here', linkedin: 'In LinkedIn, type /wg', claude: 'Ask Claude' };

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

// A phrase to say to Claude: shown in quotes, opens Claude with it typed in, plus Copy.
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

const StepLine: React.FC<{ step: Step; live: boolean }> = ({ step, live }) => {
  const pill = step.where === 'portal' && step.label ? step.label : step.where === 'linkedin' ? '/wg' : 'Claude';
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm text-gray-700">
      {step.where === 'portal' && step.href ? (
        <a href={buildAuthUrl(step.href)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold hover:underline ${PILL.portal}`}>{pill}</a>
      ) : (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[step.where]}`}>{pill}</span>
      )}
      {step.text && <span>{step.text}</span>}
      {step.say && <Say text={step.say} live={live} />}
      {step.or && <><span className="text-gray-500">or</span><Say text={step.or} live={live} /></>}
    </div>
  );
};

const WhatWingguyCanDo: React.FC = () => {
  // Layout only mounts its children once the client is initialised, so the profile is ready here.
  const [profile] = useState<any>(() => getClientProfile());
  // The Claude and /wg rows only work once Wingguy is switched on. Without it the Claude links would open
  // plain Claude answering from general knowledge, so they render as plain text and a note says why.
  const wingguyOn = profile?.features?.wingguy === true;

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">What Wingguy can do</h1>
        <p className="mt-2 text-base text-gray-600">
          Most of it doesn&apos;t live in these tabs. It&apos;s on LinkedIn, and in Claude. Here&apos;s where each thing happens.
        </p>

        {!wingguyOn && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Wingguy isn&apos;t switched on for you yet, so the /wg and Claude parts below won&apos;t work until it is.
            Let me know and we&apos;ll set it up together.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {(['portal', 'linkedin', 'claude'] as Where[]).map((w) => (
            <span key={w} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[w]}`}>{PILL_TEXT[w]}</span>
          ))}
        </div>

        {GROUPS.map((g) => (
          <section key={g.heading} className="mt-7">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{g.heading}</h2>
            <div className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
              {g.jobs.map((j) => (
                <div key={j.job} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[minmax(180px,1fr)_2fr] md:gap-4">
                  <div className="font-medium text-gray-900">{j.job}</div>
                  <div className="flex flex-col gap-1.5">
                    {j.steps.map((s, i) => <StepLine key={i} step={s} live={wingguyOn} />)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Record every call.</strong> Most of the Claude column runs on your call recordings - the prep, the
          follow-up drafts, the people waiting on New Leads. The more you record, the more of this works.
        </div>
        <p className="mt-4 text-sm">
          <a href={buildAuthUrl('/my-wingguy/about')} className="font-medium text-blue-700 hover:underline">See a whole working day of it &rarr;</a>
        </p>
        {wingguyOn && (
          <p className="mt-3 text-xs text-gray-400">
            Clicking a phrase opens it in the Claude app on your computer. Using Claude in a web browser? Click <strong>Copy</strong> and paste it into a new chat.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Getting set up, or learning the method</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="font-medium text-gray-900">Set up Wingguy</div>
            <p className="mt-1 text-sm text-gray-600">
              {wingguyOn ? 'Ten minutes. Nothing you can break.' : "Not switched on yet - let me know and we'll do it together."}
            </p>
            {wingguyOn && <a href={buildAuthUrl('/my-wingguy')} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">Set it up &rarr;</a>}
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="font-medium text-gray-900">Ask Claude how it works</div>
            <p className="mt-1 text-sm text-gray-600">
              Start each chat with <strong>&ldquo;{OPENER}&rdquo;</strong>, then ask in your own words - you get my method, not
              general advice off the internet.
            </p>
            {wingguyOn && <a href={claudeLink(OPENER)} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">Start a chat &rarr;</a>}
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="font-medium text-gray-900">Read the library</div>
            <p className="mt-1 text-sm text-gray-600">The thinking behind it, one short piece at a time.</p>
            <a href={LIBRARY_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">Open the library &rarr;</a>
          </div>
        </div>
        {wingguyOn && (
          <div className="mt-4 text-sm text-gray-600">
            Good questions about the method:{' '}
            {METHOD_QUESTIONS.map((q, i) => (
              <span key={q}>{i > 0 && ' · '}<a href={claudeLink(q)} className="text-blue-700 hover:underline">&ldquo;{q}&rdquo;</a></span>
            ))}
            . Want the whole lot? Say <strong>&ldquo;{EVERYTHING}&rdquo;</strong>.
          </div>
        )}
        <p className="mt-4 text-sm text-gray-500">
          Stuck on a particular screen? The <strong>Help</strong> button at the top of every screen explains it. Still stuck?{' '}
          <a href={STUCK_MAILTO} className="font-medium text-blue-700 hover:underline">Email me &rarr;</a>
        </p>
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
