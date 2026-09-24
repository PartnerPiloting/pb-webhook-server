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

// Registered in content/client-phrases.json - see the note at the top.
const OPENER = 'where are we up to?';
const STARTERS = [
  'Who should I be connecting with?',
  'What do I say to thank someone for connecting?',
  'How do I keep on top of follow-ups?',
];
const EVERYTHING = 'read me everything';

const CopyPhrase: React.FC<{ text: string }> = ({ text }) => {
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
    <button
      type="button"
      onClick={copy}
      className="group inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-sm text-gray-800 hover:border-blue-300 hover:bg-blue-50"
      title="Copy, then paste it into Claude"
    >
      <span className="italic">{text}</span>
      <span className="text-xs text-gray-400 group-hover:text-blue-600">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const Step: React.FC<{ n: number; title: string; note?: string; children: React.ReactNode }> = ({ n, title, note, children }) => (
  <section className="flex gap-4 rounded-lg border border-gray-200 bg-white p-5">
    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{n}</div>
    <div className="min-w-0 flex-1 space-y-2">
      <h2 className="text-base font-semibold text-gray-900">
        {title}
        {note && <span className="ml-2 text-sm font-normal italic text-gray-500">- {note}</span>}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">{children}</div>
    </div>
  </section>
);

const StartHereContent: React.FC = () => {
  // Layout only mounts its children once the client is initialised, so the profile is ready here.
  const [profile] = useState<any>(() => getClientProfile());
  const wingguyOn = profile?.features?.wingguy === true;

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-gray-700">
        Everything you need to learn this system is already inside Wingguy. Here&apos;s how to use it.
      </p>

      <Step n={1} title="Set up Wingguy" note={wingguyOn ? "skip this if you've done it" : undefined}>
        {wingguyOn ? (
          <>
            <p>Wingguy plugs into your Claude. It takes a couple of minutes.</p>
            <p>
              <a href={buildAuthUrl('/my-wingguy')} className="font-medium text-blue-700 hover:underline">
                Set it up &rarr;
              </a>
            </p>
          </>
        ) : (
          <p>Wingguy isn&apos;t switched on for you yet - let me know and we&apos;ll set it up together.</p>
        )}
      </Step>

      <Step n={2} title="Ask it anything">
        <p>
          Start each chat with <strong>&ldquo;{OPENER}&rdquo;</strong> - it picks up where you left off, and makes
          sure you&apos;re getting my method, not general advice off the internet.
        </p>
        <div className="flex">
          <CopyPhrase text={OPENER} />
        </div>
        <p>Then just ask, in your own words. Some good places to start:</p>
        <div className="flex flex-col items-start gap-2">
          {STARTERS.map((s) => <CopyPhrase key={s} text={s} />)}
        </div>
        <p>
          Want the whole lot at once? Say <strong>&ldquo;{EVERYTHING}&rdquo;</strong>.
        </p>
      </Step>

      <Step n={3} title="Read the library">
        <p>The whole method on one page, then a short piece on each step. Read whatever grabs you.</p>
        <p>
          <a href={LIBRARY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">
            Open the library &rarr;
          </a>
        </p>
      </Step>

      <Step n={4} title="Stuck on a screen?">
        <p>Click the <strong>Help</strong> button at the top of it.</p>
      </Step>

      <Step n={5} title="Still stuck?">
        <p>Ask me.</p>
      </Step>
    </div>
  );
};

export default function StartHerePage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <div className="w-full">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-gray-900">Start Here</h1>
            </div>
            <StartHereContent />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
