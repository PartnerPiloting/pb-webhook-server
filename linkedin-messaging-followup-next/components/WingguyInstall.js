"use client";

/**
 * "Install the extension" — the portal page a client uses to get the Wingguy browser extension,
 * and every later version, by clicking a button and following a few plain steps.
 *
 * WHY THIS EXISTS (Guy, 2026-10-01). The background updater installs by pulling and running code
 * every hour, which is exactly the shape antivirus distrusts - Bitdefender shut PowerShell down on
 * Steve Nelson's machine. A person clicking a button and getting a file is what NO antivirus
 * objects to, so this becomes the default lane for new clients and the rescue for a blocked one.
 * The hourly updater stays only on the machines it already works on; this does not replace it
 * there, it sits alongside.
 *
 * The page shows the RIGHT instructions for where the client is, driven by /extension/dist/
 * portal-status:
 *   - never seen on any version -> the first-time, six-step install (Developer mode, Load unpacked).
 *   - behind the current version -> the short three-step update (no Developer mode, no Load unpacked).
 * The download is fetched WITH the portal-token header and saved as a blob, so the token never
 * rides in a URL.
 *
 * STANDALONE like the other portal pages: the token in ?token= is the whole authentication story.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBackendBase } from '../services/api';
import { usePageAuth } from './WingguyReview';

// The one step people get wrong: finding the Developer mode switch. A small drawn stand-in for the
// top-right of chrome://extensions, with the switch on. The real page can swap in a screenshot.
function DeveloperModeShot() {
  return (
    <div className="mt-3 overflow-hidden rounded-[10px] border border-slate-200 bg-white">
      <svg viewBox="0 0 520 96" xmlns="http://www.w3.org/2000/svg" className="block w-full h-auto" role="img"
           aria-label="The top-right of the Chrome extensions page, with the Developer mode switch turned on.">
        <rect width="520" height="96" fill="#ffffff" />
        <text x="20" y="40" fontFamily="system-ui, sans-serif" fontSize="17" fontWeight="600" fill="#0f172a">Extensions</text>
        <text x="20" y="64" fontFamily="system-ui, sans-serif" fontSize="12.5" fill="#64748b">Load unpacked&#160;&#160;&#160;Pack extension&#160;&#160;&#160;Update</text>
        <rect x="330" y="26" width="178" height="44" rx="12" fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" />
        <text x="346" y="53" fontFamily="system-ui, sans-serif" fontSize="14" fontWeight="600" fill="#0f172a">Developer mode</text>
        <rect x="462" y="39" width="34" height="18" rx="9" fill="#2563eb" />
        <circle cx="487" cy="48" r="7" fill="#ffffff" />
      </svg>
      <div className="border-t border-slate-200 px-3 py-[7px] text-[12.5px] text-slate-500">
        The switch is in the top-right. On looks like this.
      </div>
    </div>
  );
}

function Step({ n, title, last, children }) {
  return (
    <li className="relative pl-[52px] pb-[22px] last:pb-0">
      <span className="absolute left-0 top-[-2px] flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] border-slate-200 bg-white text-[15px] font-semibold text-slate-900 tabular-nums">
        {n}
      </span>
      {!last && <span className="absolute left-[16.5px] top-[34px] bottom-0 w-[1.5px] bg-slate-200" aria-hidden="true" />}
      <h3 className="mb-1 mt-[2px] text-[16.5px] font-semibold text-slate-900">{title}</h3>
      <div className="text-[15px] leading-relaxed text-slate-600">{children}</div>
    </li>
  );
}

const Code = ({ children }) => (
  <code className="rounded-[6px] bg-slate-100 px-[7px] py-[1.5px] font-mono text-[13.5px] text-slate-800">{children}</code>
);

function FirstTimeSteps() {
  return (
    <ol className="mt-5 list-none p-0">
      <Step n={1} title="Download it">
        Click the button above. A file lands in your Downloads, usually shown at the bottom or top
        of your browser.
        <div className="mt-[10px] rounded-[10px] bg-slate-50 px-[13px] py-[11px] text-[13.5px] text-slate-600">
          <b className="font-semibold text-slate-900">If your browser says it &ldquo;can&rsquo;t scan this
          file&rdquo; - that&rsquo;s normal.</b> Any download that doesn&rsquo;t come from a big app store
          gets that message. It&rsquo;s safe. Click Keep.
        </div>
      </Step>
      <Step n={2} title="Unzip it into one fixed folder">
        Find the file in your Downloads, right-click it and choose <b>Extract All</b>. In the box that
        asks where to put it, delete what&rsquo;s there and type <Code>C:\Wingguy</Code>, then click
        <b>Extract</b>.
        <div className="mt-[10px] rounded-[10px] bg-slate-50 px-[13px] py-[11px] text-[13.5px] text-slate-600">
          <b className="font-semibold text-slate-900">Why that folder matters.</b> Wingguy lives in
          <Code>C:\Wingguy</Code> from now on - every update goes to the same place, so there is never
          a question of where it went. (On a Mac, use a folder called <Code>Wingguy</Code> in your home
          folder.)
        </div>
      </Step>
      <Step n={3} title="Open your extensions page">
        In Chrome, type <Code>chrome://extensions</Code> into the address bar and press Enter.
      </Step>
      <Step n={4} title="Turn on Developer mode">
        There&rsquo;s a switch in the top-right corner. Flick it on. This sounds scarier than it is -
        it just lets Chrome run the tool I&rsquo;ve given you directly. Nothing on your computer changes.
        <DeveloperModeShot />
      </Step>
      <Step n={5} title="Load the folder">
        Click <b>Load unpacked</b> (top-left), go to <Code>C:\Wingguy</Code> and click <b>Select Folder</b>.
        Wingguy is now in your browser.
      </Step>
      <Step n={6} last title="Switch it on for you">
        Open this portal once in that browser so the extension knows it&rsquo;s you. Then open any
        LinkedIn profile and type <Code>/wg</Code> to check it&rsquo;s working.
      </Step>
    </ol>
  );
}

function UpdateSteps() {
  return (
    <ol className="mt-5 list-none p-0">
      <Step n={1} title="Download the new version">
        Click the button above to get the latest file.
      </Step>
      <Step n={2} title="Unzip it into the same folder">
        Right-click the file, choose <b>Extract All</b>, type <Code>C:\Wingguy</Code> as the destination
        - exactly as the first time - and click <b>Extract</b>. Windows will ask whether to replace the
        files that are already there: choose <b>Replace the files in the destination</b>.
        <div className="mt-[10px] rounded-[10px] bg-slate-50 px-[13px] py-[11px] text-[13.5px] text-slate-600">
          Same folder every time is the whole trick - it&rsquo;s what lets the next step pick up the new
          version. Not sure? Message me and we&rsquo;ll do it together in two minutes.
        </div>
      </Step>
      <Step n={3} last title="Refresh it">
        Go to <Code>chrome://extensions</Code> and click the little circular-arrow <b>refresh</b> icon on
        the Wingguy card (or just close and reopen Chrome). It re-reads <Code>C:\Wingguy</Code> and
        picks up the new version. Developer mode stays on from last time - nothing to re-set, and
        you stay signed in.
      </Step>
    </ol>
  );
}

function StatusBanner({ status }) {
  if (!status) return null;
  if (status.neverInstalled) {
    return (
      <div className="flex items-center gap-[10px] rounded-[12px] border border-slate-200 bg-slate-50 px-[14px] py-[12px] text-[14.5px] text-slate-600">
        <span className="h-[9px] w-[9px] flex-none rounded-full bg-slate-400" aria-hidden="true" />
        <span>Let&rsquo;s get Wingguy into your browser. It takes about two minutes, and you only do the full set-up once.</span>
      </div>
    );
  }
  if (status.behind) {
    return (
      <div className="flex items-center gap-[10px] rounded-[12px] border border-amber-300 bg-amber-50 px-[14px] py-[12px] text-[14.5px] text-amber-800">
        <span className="h-[9px] w-[9px] flex-none rounded-full bg-amber-500" aria-hidden="true" />
        <span><b className="font-semibold">A new version is ready.</b> You&rsquo;re on {status.installed} -
        the current one is {status.current}. Updating takes about 30 seconds.</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[10px] rounded-[12px] border border-emerald-200 bg-emerald-50 px-[14px] py-[12px] text-[14.5px] text-emerald-800">
      <span className="h-[9px] w-[9px] flex-none rounded-full bg-emerald-600" aria-hidden="true" />
      <span><b className="font-semibold">You&rsquo;re up to date</b> - running version {status.current},
      which is the current one.</span>
    </div>
  );
}

function WingguyInstallInner() {
  const searchParams = useSearchParams();
  const { token, client, devKey, hasAuth, ready } = usePageAuth(searchParams);

  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (token) h['x-portal-token'] = token;
    if (client) h['x-client-id'] = client;
    if (devKey) h['x-dev-key'] = devKey;
    return h;
  }, [token, client, devKey]);

  const [status, setStatus] = useState(null); // null while loading | {current,installed,behind,neverInstalled} | {error}
  const [dl, setDl] = useState({ busy: false, error: '' });

  useEffect(() => {
    if (!ready || !hasAuth) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/extension/dist/portal-status`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setStatus(res.ok && data.ok ? data : { error: data.error || 'Could not check your version.' });
      } catch (e) {
        if (!cancelled) setStatus({ error: 'Could not check your version - check your connection.' });
      }
    })();
    return () => { cancelled = true; };
  }, [ready, hasAuth, authHeaders]);

  const download = useCallback(async () => {
    setDl({ busy: true, error: '' });
    try {
      const res = await fetch(`${getBackendBase()}/extension/dist/download`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      const blob = await res.blob();
      const version = (status && status.current) || 'latest';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wingguy-extension-${version}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDl({ busy: false, error: 'The download did not start. Try again, or message me and I will send it across.' });
      return;
    }
    setDl({ busy: false, error: '' });
  }, [authHeaders, status]);

  if (ready && !hasAuth) {
    return (
      <div className="max-w-[680px]">
        <h1 className="font-serif text-4xl leading-tight text-slate-900">Install the extension</h1>
        <p className="mt-4 text-[16px] text-slate-600">
          Open this page from your own Wingguy link so it knows who you are. If you don&rsquo;t have it
          handy, message me and I&rsquo;ll resend it.
        </p>
      </div>
    );
  }

  const showUpdate = status && !status.error && status.behind;

  return (
    <div className="max-w-[680px]">
      <h1 className="font-serif text-4xl leading-tight text-slate-900">Install your Wingguy extension</h1>
      <p className="mb-6 mt-[10px] max-w-[56ch] text-[16.5px] leading-relaxed text-slate-600">
        This takes about two minutes, and you only do the full set-up once. A couple of the steps have
        slightly technical-sounding names - don&rsquo;t let that put you off. I&rsquo;ll tell you exactly what to click.
      </p>

      <div className="mb-6"><StatusBanner status={status && !status.error ? status : null} /></div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={download}
          disabled={dl.busy}
          className="inline-flex items-center gap-[10px] rounded-[12px] bg-blue-600 px-6 py-[15px] text-[17px] font-semibold text-white shadow-[0_1px_2px_rgba(31,39,51,.06),0_6px_20px_rgba(31,39,51,.08)] transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
          </svg>
          {dl.busy ? 'Preparing…' : showUpdate ? 'Download the update' : 'Download the extension'}
        </button>
        {status && status.current && (
          <span className="text-[13.5px] text-slate-500">Version {status.current} &middot; about 100&nbsp;KB</span>
        )}
      </div>
      {dl.error && <p className="mt-3 text-[14px] text-red-600">{dl.error}</p>}

      {showUpdate ? (
        <>
          <UpdateSteps />
          <details className="mt-6 rounded-[12px] border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-[15px] font-semibold text-slate-700">Installing on a new computer</summary>
            <FirstTimeSteps />
          </details>
        </>
      ) : (
        <>
          <FirstTimeSteps />
          <details className="mt-6 rounded-[12px] border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-[15px] font-semibold text-slate-700">Updating later, when a new version is out</summary>
            <UpdateSteps />
          </details>
        </>
      )}

      <div className="mt-8 rounded-[14px] border border-slate-200 bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(31,39,51,.05)]">
        <p className="mb-1 text-[15px] font-semibold text-slate-900">Stuck anywhere?</p>
        <p className="text-[15px] text-slate-600">
          Don&rsquo;t guess - message me and we&rsquo;ll do it together on a quick call. It takes two minutes.
        </p>
      </div>
    </div>
  );
}

export default function WingguyInstall() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <WingguyInstallInner />
    </Suspense>
  );
}
