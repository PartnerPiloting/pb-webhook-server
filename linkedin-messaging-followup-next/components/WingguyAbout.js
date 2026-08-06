"use client";

/**
 * "What Wingguy does" — the story half of the old setup page, given its own door.
 *
 * It used to sit on top of the fill-in-the-blanks form, which made the form feel like a wall and
 * made the product look like a settings screen (Guy: someone hears the Wingguy story, clicks
 * "My Wingguy", and lands on admin). Split out, each page does one job: this one shows what it
 * does, the setup page collects what only they can tell it.
 *
 * Read-only and auth-free by design — nothing here is per-client, so it renders for anyone who
 * reaches it. The links carry whatever auth the visitor arrived with.
 */

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const DEMO_MOMENTS = [
  {
    moment: 'You open a lead on LinkedIn and type /wg',
    does: 'It reads the whole conversation and writes the reply - grounded in what they actually said, in your words, not a template.',
  },
  {
    moment: 'They sound open to a meeting',
    does: 'It offers three times you are genuinely free, on their clock, spread across the week rather than stacked on one day.',
  },
  {
    moment: 'They pick one',
    does: 'It books it, sends the invite with your meeting room on it, and writes the warm confirmation that goes with it.',
  },
  {
    say: 'I had a great meeting with John this morning - find the transcript and draft the follow-up',
    does: 'It finds the recording, pulls out what mattered, and writes the email in your voice with the right links in it.',
  },
  {
    say: 'Prep me for today',
    does: 'Who you are meeting, what you last talked about, what you promised them, and anything still outstanding.',
  },
  {
    say: 'Show me my follow-ups',
    does: 'The people due today, in order, with the reason each one is on the list.',
  },
  {
    moment: 'End of the day, a tab open per conversation',
    does: 'Every follow-up drafts at once. You read each one and say "push", and it lands in your inbox ready to send.',
  },
];

const KINDS = [
  {
    tag: 'Standard',
    tone: 'emerald',
    headline: "The hard-won ones. You don't set them up and you don't maintain them.",
    body: "These are the difference between a message that gets a reply and one that gets ignored. When we learn something new that makes messages land better, it turns up in your Wingguy on its own - you don't lift a finger.",
    eg: '"Read their profile properly and say something true about them, rather than parroting their headline back at them."',
  },
  {
    tag: 'Fixed',
    tone: 'amber',
    headline: "Two guardrails that can't be switched off - by you or by us.",
    body: 'Nothing is ever sent without you seeing it first, and every email is copied to your own records so the conversation lands on that person\'s file. These are the reason it never goes off and does something daft on your behalf.',
    eg: '',
  },
  {
    tag: 'Yours',
    tone: 'slate',
    headline: 'Your words, your defaults, your links. Change them whenever you like.',
    body: 'How you sign off. What you say when someone asks what you do. The earliest you would ever take a meeting. These start with sensible defaults - and the setup page is where you make them yours.',
    eg: '',
  },
];

const LOOP = [
  ['It writes the draft', 'A connection request, a reply, a follow-up email after a call. It pulls in what it knows about the person first - your past messages, the call, their profile.'],
  ['You read it before it goes anywhere', 'Always. Nothing is ever sent on your behalf without you seeing it. Change what is not right and send it.'],
  ['You tell it what was off', '"Don\'t say reach out." "That\'s too long." "Always mention I\'m Brisbane based." Plain English, in your own words - you never have to phrase it like an instruction.'],
  ['It remembers - for good', 'Not just for the next message. It shows you exactly what it is about to change before it changes anything, then that correction applies to everything it writes from then on.'],
];

const SAY = [
  ['Never say "reach out"', 'Bans the phrase everywhere, in every message it ever writes for you.'],
  ['That was too long - keep them to about four lines', 'Works just as well as a reaction to a draft you are looking at right now.'],
  ['What have I changed?', 'Shows you everything that is yours, next to the standard version.'],
  ['Go back to the standard one', 'Undoes a change of yours and puts ours back. Nothing is ever lost.'],
];

function WingguyAboutInner() {
  const searchParams = useSearchParams();
  const q = searchParams.toString();
  const href = (path) => (q ? `${path}?${q}` : path);

  return (
    <div className="flex flex-col gap-16 max-w-3xl">
      <header className="flex flex-col gap-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">
          What Wingguy does
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-[1.1] text-slate-900">
          It takes the remembering, chasing and drafting off your plate
        </h1>
        <p className="font-serif text-lg leading-relaxed text-slate-600">
          Not by sending things for you - it never does that. It does the work up to the point of
          sending, in your own words, so the part left for you is the part only you can do: reading
          it, and having the conversation.
        </p>

        <a
          href="https://knowaguy.com.au/a-day-in-the-life"
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-2 block border-2 border-emerald-600 bg-emerald-50 p-6 hover:bg-emerald-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-800">
            Ten minutes, and the best explanation there is
          </div>
          <div className="font-serif text-2xl text-slate-900 mt-2 group-hover:text-emerald-900">
            A day in the life <span aria-hidden="true">&rarr;</span>
          </div>
          <p className="text-[15px] text-slate-700 leading-relaxed mt-2">
            An ordinary working day with all of this running underneath it. People who read it come
            back knowing what they want their own Wingguy to sound like.
          </p>
        </a>
      </header>

      <section className="flex flex-col gap-6">
        <SectionHead
          title="A day of it, moment by moment"
          sub="What you say on the left, what it does on the right."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {DEMO_MOMENTS.map((m) => (
            <div key={m.does} className="bg-white grid sm:grid-cols-[16rem_1fr] gap-1 sm:gap-6 px-5 py-4">
              <div className="font-serif text-[15px] text-emerald-800 leading-snug">
                {m.say ? <>&ldquo;{m.say}&rdquo;</> : <span className="text-slate-500 not-italic">{m.moment}</span>}
              </div>
              <div className="text-[15px] text-slate-700 leading-relaxed">{m.does}</div>
            </div>
          ))}
        </div>

        <blockquote className="border-l-2 border-emerald-600 pl-5 flex flex-col gap-2">
          <p className="font-serif text-lg text-slate-800 leading-relaxed">
            &ldquo;I used to finish the day with a pile of emails I still owed people. The
            remembering, the tracking, the drafting, the chasing, the diary work - it is not my job
            any more. I am less drained, and I get through far more.&rdquo;
          </p>
          <cite className="text-sm text-slate-500 not-italic">Guy</cite>
        </blockquote>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHead
          title="Why it sounds like a person and not like AI"
          sub="Every one of those moments runs on instructions - and some of them are yours."
        />
        <div className="border-2 border-emerald-600 bg-emerald-50 p-6 flex flex-col gap-3">
          <p className="font-serif text-lg text-slate-900 leading-relaxed">
            None of it is generic. It sounds like Guy because Guy taught it - and yours will sound
            like you for exactly the same reason.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            <strong>The part that matters most comes after day one.</strong> Every time Wingguy
            writes something and you tell it &ldquo;not like that - like this&rdquo;, it changes for
            good. In a chat, or right there in the Wingguy window on LinkedIn, in whatever words come
            out. Do that a handful of times over your first few weeks and the drafts stop being
            good-generic and start being unmistakably yours - across everything it writes, not just
            the message in front of you.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            There is an easier version of that, too: just change what it drafts before you send it.
            It quietly notices, and when you ask it to &ldquo;review my edits&rdquo; it shows you
            what you changed and offers to make the pattern permanent.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHead
          title="There are three kinds of instruction"
          sub="Worth knowing which is which, because you only ever look after one of them."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {KINDS.map((k) => (
            <div key={k.tag} className={`grid sm:grid-cols-[8rem_1fr] gap-2 sm:gap-6 p-6 ${k.tone === 'amber' ? 'bg-amber-50' : 'bg-white'}`}>
              <div className={`text-[11px] font-bold uppercase tracking-[0.1em] pt-1 ${k.tone === 'amber' ? 'text-amber-800' : k.tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800'}`}>
                {k.tag}
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-serif text-lg text-slate-900 leading-snug">{k.headline}</p>
                <p className="text-[15px] text-slate-600 leading-relaxed">{k.body}</p>
                {k.eg ? <p className="font-serif italic text-sm text-slate-400">{k.eg}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHead
          title="How it actually works, week to week"
          sub="Less about setting things up, more about correcting it when it gets something wrong."
        />
        <div className="flex flex-col border-t border-slate-200">
          {LOOP.map(([title, body], i) => (
            <div key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-4 py-4 border-b border-slate-200 items-baseline">
              <span className="font-serif text-xl text-emerald-700">{i + 1}</span>
              <div className="flex flex-col gap-1">
                <strong className="text-slate-900 font-semibold">{title}</strong>
                <span className="text-[15px] text-slate-600 leading-relaxed">{body}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHead
          title="Things worth saying to it"
          sub="No special wording. Say it how you would say it out loud."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {SAY.map(([quote, what]) => (
            <div key={quote} className="bg-white px-5 py-4 flex flex-col gap-1">
              <div className="font-serif text-lg text-slate-900">
                <span className="text-emerald-700">&ldquo;</span>{quote}<span className="text-emerald-700">&rdquo;</span>
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">{what}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t-2 border-slate-900 pt-8 flex flex-col gap-4">
        <p className="font-serif text-2xl text-slate-900">Ready to make it sound like you?</p>
        <p className="text-slate-600">
          It takes about ten minutes, there is nothing you can break, and nothing you cannot undo.
        </p>
        <a href={href('/my-wingguy/setup')}
          className="self-start px-5 py-3 bg-slate-900 text-white text-[15px] font-medium hover:bg-slate-800">
          Give Wingguy your instructions <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </div>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div className="flex flex-col gap-3 pb-4 border-b border-slate-200">
      <h2 className="font-serif text-2xl text-slate-900">{title}</h2>
      {sub ? <p className="text-slate-600">{sub}</p> : null}
    </div>
  );
}

export default function WingguyAbout() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <WingguyAboutInner />
    </Suspense>
  );
}
