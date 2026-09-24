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
const STARTERS = [
  'Who should I be connecting with?',
  'What do I say to thank someone for connecting?',
  'How do I keep on top of follow-ups?',
];
const EVERYTHING = 'read me everything';

// Opens a NEW chat in the Claude desktop app with the question already typed in, ready to send.
// Documented by Anthropic ("Open Claude Desktop with a link", support.claude.com, July 2026). There is
// no reliable equivalent for Claude in a browser - the old claude.ai/new?q= was dropped - so every
// phrase also has a Copy button.
const claudeLink = (text: string) => `claude://claude.ai/new?q=${encodeURIComponent(text)}`;

const Phrase: React.FC<{ text: string }> = ({ text }) => {
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm italic text-gray-800">{text}</span>
      <a
        href={claudeLink(text)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        title="Opens a new chat in the Claude app with this already typed in"
      >
        Open in Claude &rarr;
      </a>
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700"
        title="Copy, then paste it into Claude"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

const Step: React.FC<{ n: number; title: string; note?: string; children: React.ReactNode }> = ({ n, title, note, children }) => (
  <section className="flex gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{n}</div>
    <div className="min-w-0 flex-1 space-y-3">
      <h2 className="text-base font-semibold text-gray-900">
        {title}
        {note && <span className="ml-2 text-sm font-normal italic text-gray-500">- {note}</span>}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">{children}</div>
    </div>
  </section>
);

const ActionLink: React.FC<{ href: string; external?: boolean; children: React.ReactNode }> = ({ href, external, children }) => (
  <a
    href={href}
    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
  >
    {children}
  </a>
);

const StartHereContent: React.FC = () => {
  // Layout only mounts its children once the client is initialised, so the profile is ready here.
  const [profile] = useState<any>(() => getClientProfile());
  const wingguyOn = profile?.features?.wingguy === true;

  return (
    <div className="max-w-7xl space-y-6">
      <p className="text-base text-gray-700">
        Everything you need to learn this system is already inside Wingguy. Here&apos;s how to use it.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Left: the two steps where the doing happens */}
        <div className="space-y-5 lg:col-span-3">
          <Step n={1} title="Set up Wingguy" note={wingguyOn ? "skip this if you've done it" : undefined}>
            {wingguyOn ? (
              <>
                <p>Wingguy plugs into your Claude. It takes a couple of minutes.</p>
                <ActionLink href={buildAuthUrl('/my-wingguy')}>Set it up &rarr;</ActionLink>
              </>
            ) : (
              <p>Wingguy isn&apos;t switched on for you yet - let me know and we&apos;ll set it up together.</p>
            )}
          </Step>

          <Step n={2} title="Ask Claude anything">
            {/* The portal can't see into a client's Claude - it only knows whether Wingguy is switched on for
                them. Without Wingguy these buttons would open Claude on its own, answering from general
                knowledge - exactly what this page warns against - so they only show once it's switched on. */}
            {!wingguyOn ? (
              <p>
                Once Wingguy is set up, this is where you&apos;ll ask Claude how anything in this system works - in your
                own words - and get my method, not general advice off the internet.
              </p>
            ) : (
            <>
            <p>
              Once Wingguy is connected to your Claude, ask anything about how this works - in your own words - and
              you&apos;ll get my method, not general advice off the internet.
            </p>
            <p>
              Start each chat with <strong>&ldquo;{OPENER}&rdquo;</strong> - it picks up where you left off.
            </p>
            <Phrase text={OPENER} />
            <p className="pt-1">Then just ask. Some good places to start:</p>
            <div className="space-y-2">
              {STARTERS.map((s) => <Phrase key={s} text={s} />)}
            </div>
            <p className="pt-1">
              Want the whole lot at once? Say <strong>&ldquo;{EVERYTHING}&rdquo;</strong>.
            </p>
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <strong>Open in Claude</strong> opens a new chat in the Claude app on your computer, with the question
              already typed in - just press send. Using Claude in a web browser instead? Click <strong>Copy</strong> and
              paste it into a new chat.
            </p>
            </>
            )}
          </Step>
        </div>

        {/* Right: the three quick ones */}
        <div className="space-y-5 lg:col-span-2">
          <Step n={3} title="Read the library">
            <p>The whole method on one page, then a short piece on each step. Read whatever grabs you.</p>
            <ActionLink href={LIBRARY_URL} external>Open the library &rarr;</ActionLink>
          </Step>

          <Step n={4} title="Stuck on a screen?">
            <p>Click the <strong>Help</strong> button at the top of it.</p>
          </Step>

          <Step n={5} title="Still stuck?">
            <p>Ask me. I&apos;m happy to help.</p>
            <ActionLink href={STUCK_MAILTO}>Email me &rarr;</ActionLink>
          </Step>
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
          <div className="w-full">
            <div className="mb-4">
              <h1 className="text-2xl font-semibold text-gray-900">Start Here</h1>
            </div>
            <StartHereContent />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
