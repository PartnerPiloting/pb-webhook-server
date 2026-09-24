"use client";
// Start Here - a one-screen signpost to where learning actually lives now.
//
// Until 24 Sep 2026 this page was a 63-topic manual pulled from the Airtable Help table. About a third
// were operator docs, a third taught the pre-VPS Linked Helper setup, and several described post
// scoring and Apify, retired in May. Learning now lives in Wingguy (the playbook, served by
// wingguy_learn), the email series library, and each screen's own Help button - so this page's only
// job is to point at those. It is a signpost, not a shelf: resist adding topics back.
// The old page is in git history (git log -- linkedin-messaging-followup-next/app/start-here/page.tsx).
//
// Layout (Guy's review, 24 Sep): centred, three equal steps across the top so the eye has one place to
// start, the questions as quiet tiles below, and the two "stuck?" notes as a small footer pair.
//
// The URL stays /start-here on purpose: 420 onboarding tasks and older emails link to
// /start-here?topic=..., and they now land here instead of dying. The topic param is ignored.
//
// Every phrase a client is told to type below is REGISTERED in content/client-phrases.json, which
// stamps it into wingguy_learn's description and tests that it lands on the right playbook topic.
// Change a phrase there first, then here - node tests/client-phrases.test.js fails if they drift.
import React, { useState } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import EnvironmentValidator from '../../components/EnvironmentValidator';
import Layout from '../../components/Layout';
import { getClientProfile, buildAuthUrl } from '../../utils/clientUtils';

export const dynamic = 'force-dynamic';

// The client view of the series library: the ten-step map on top, every piece beneath in send order.
// Without ?audience=client it serves the PROSPECT version - a different map and pitch-style endings.
const LIBRARY_URL = 'https://knowaguy.com.au/series?audience=client';

// "Still stuck" goes to Guy, not to Claude: by then they have already asked Wingguy, and a Claude link
// would only put them back in front of it.
const GUY_EMAIL = 'guy@knowaguy.com.au';
const STUCK_MAILTO = `mailto:${GUY_EMAIL}?subject=${encodeURIComponent("I'm stuck - can you help?")}`;

// Registered in content/client-phrases.json - see the note at the top.
const OPENER = 'where are we up to?';
const STARTERS: { label: string; text: string }[] = [
  { label: 'Who to approach', text: 'Who should I be connecting with?' },
  { label: 'When they connect', text: 'What do I say to thank someone for connecting?' },
  { label: 'Staying on top of it', text: 'How do I keep on top of follow-ups?' },
];
const EVERYTHING = 'read me everything';

// Opens a NEW chat in the Claude desktop app with the text already typed in, ready to send.
// Documented by Anthropic ("Open Claude Desktop with a link", support.claude.com, July 2026). There is
// no reliable equivalent for Claude in a browser - the old claude.ai/new?q= was dropped - so every
// question also has a Copy button.
const claudeLink = (text: string) => `claude://claude.ai/new?q=${encodeURIComponent(text)}`;

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: fall back to a hidden textarea.
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
    <button type="button" onClick={copy} className="text-gray-500 hover:text-gray-800" title="Copy, then paste it into Claude">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const QuestionTile: React.FC<{ label: string; text: string; hint?: string; primary?: boolean }> = ({ label, text, hint, primary }) => (
  <div className={`rounded-lg border p-4 ${primary ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
    <div className={`text-xs font-semibold uppercase tracking-wide ${primary ? 'text-blue-700' : 'text-gray-400'}`}>{label}</div>
    <div className="mt-1 text-base font-medium text-gray-900">&ldquo;{text}&rdquo;</div>
    {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    <div className="mt-3 flex gap-4 text-sm">
      <a href={claudeLink(text)} className="font-medium text-blue-700 hover:underline" title="Opens a new chat in the Claude app with this already typed in">
        Open in Claude &rarr;
      </a>
      <CopyButton text={text} />
    </div>
  </div>
);

const StepCard: React.FC<{ n: number; title: string; highlight?: boolean; action?: React.ReactNode; hint?: string; children: React.ReactNode }> = ({ n, title, highlight, action, hint, children }) => (
  <div className={`flex flex-col rounded-xl bg-white p-6 shadow-sm ${highlight ? 'border-2 border-blue-600' : 'border border-gray-200'}`}>
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{n}</div>
    <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
    <div className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{children}</div>
    {/* Fixed-height footer so the three buttons line up however long each card's text runs. */}
    <div className="mt-5 min-h-[4rem]">
      {action}
      {hint && <p className="mt-2 text-xs text-gray-400">{hint}</p>}
    </div>
  </div>
);

const ButtonLink: React.FC<{ href: string; external?: boolean; children: React.ReactNode }> = ({ href, external, children }) => (
  <a
    href={href}
    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
  >
    {children}
  </a>
);

const StartHereContent: React.FC = () => {
  // Layout only mounts its children once the client is initialised, so the profile is ready here.
  const [profile] = useState<any>(() => getClientProfile());
  // The portal can't see into a client's Claude - it only knows whether Wingguy is switched on for them.
  // Without Wingguy the Claude buttons would open plain Claude answering from general knowledge - exactly
  // what this page warns against - so they only show once it's switched on.
  const wingguyOn = profile?.features?.wingguy === true;

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Start Here</h1>
        <p className="mx-auto mt-3 max-w-3xl text-base text-gray-600">
          Everything you need to learn this system is already inside Wingguy. Here&apos;s how to use it.
        </p>
      </div>

      {/* The three steps. The one to do next gets the highlight. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StepCard
          n={1}
          title="Set up Wingguy"
          highlight={!wingguyOn}
          action={wingguyOn ? <ButtonLink href={buildAuthUrl('/my-wingguy')}>Set it up &rarr;</ButtonLink> : undefined}
          hint={wingguyOn ? 'Already done? Skip to step 2.' : undefined}
        >
          {wingguyOn
            ? <p>Wingguy plugs into your Claude. It takes a couple of minutes.</p>
            : <p>Wingguy isn&apos;t switched on for you yet - let me know and we&apos;ll set it up together.</p>}
        </StepCard>

        <StepCard
          n={2}
          title="Ask Claude anything"
          highlight={wingguyOn}
          action={wingguyOn ? <ButtonLink href={claudeLink(OPENER)}>Start a chat &rarr;</ButtonLink> : undefined}
          hint={wingguyOn ? `Opens Claude with "${OPENER}" ready to send.` : undefined}
        >
          {wingguyOn ? (
            <p>
              Once Wingguy is connected, ask anything about how this works, in your own words. You&apos;ll get my
              method, not general advice off the internet.
            </p>
          ) : (
            <p>
              Once Wingguy is set up, this is where you&apos;ll ask Claude how anything in this system works - and get
              my method, not general advice off the internet.
            </p>
          )}
        </StepCard>

        <StepCard n={3} title="Read the library" action={<ButtonLink href={LIBRARY_URL} external>Open the library &rarr;</ButtonLink>}>
          <p>The whole method on one page, then a short piece on each step. Read whatever grabs you.</p>
        </StepCard>
      </div>

      {wingguyOn && (
        <div className="mt-10 rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-lg font-semibold text-gray-900">Good questions to start with</h2>
          <p className="mt-1 text-sm text-gray-600">Click one to open it in Claude, ready to send.</p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <QuestionTile primary label="Start every chat with" text={OPENER} hint="It picks up where you left off." />
            {STARTERS.map((s) => <QuestionTile key={s.text} label={s.label} text={s.text} />)}
          </div>
          <p className="mt-5 text-sm text-gray-600">
            Want the whole lot at once? Say <strong>&ldquo;{EVERYTHING}&rdquo;</strong>.
          </p>
          <p className="mt-2 text-xs text-gray-400">
            <strong>Open in Claude</strong> works with the Claude app on your computer. Using Claude in a web browser?
            Click <strong>Copy</strong> and paste it into a new chat.
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Stuck on a screen?</h3>
          <p className="mt-1 text-sm text-gray-600">Click the <strong>Help</strong> button at the top of it.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Still stuck?</h3>
          <p className="mt-1 text-sm text-gray-600">
            Ask me - I&apos;m happy to help.{' '}
            <a href={STUCK_MAILTO} className="font-medium text-blue-700 hover:underline">Email me &rarr;</a>
          </p>
        </div>
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
            <StartHereContent />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
