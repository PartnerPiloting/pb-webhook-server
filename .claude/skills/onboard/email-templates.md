# Onboarding email patterns - distilled from real sent emails

All on the `email-html-format` shell. Voice: Guy first person, plain-spoken, one idea per
paragraph, ` - ` dashes, Australian English. Every email ends with a clear "send me X back" or
"nothing to do" so the client always knows their side. The patterns, in journey order:

## 1. Welcome aboard (on sign-up)
*Real example: "Welcome aboard Szymon - here's your link", 6 Aug 2026.*

- Warm one-liner acknowledging how they signed up.
- Portal login link + "save it somewhere handy, you only see the token once".
- ONE reading ask, pinpointed ("the orientation at the top of the Setup section under Start here"),
  with why ("covers where Linked Helper fits - it goes in last, on purpose, and the reading
  explains what we build first and why").
- Two think-abouts, not tasks: who the first outreach lists are, and how many discovery calls a
  week they'd genuinely commit to ("start smaller than feels ambitious").
- Offer 2-3 concrete session times, "(all times are Brisbane time)" if same tz - otherwise the
  timezone-marker instruction applies.
- Close: "That's the lot - nothing heavy. It just means the first session is spent building
  rather than setting up."

## 2. Pre-session ("the plan, and N things I need from you")
*Real example: "Thursday 4pm - the plan for what we'll be doing, and three things I need from
you" to Dean, 18 Aug 2026 - the canonical one.*

- One line of purpose: "so we use the half hour properly instead of spending it fishing around."
- **What we're doing** - the session's 2-3 hookups, each with a one-sentence WHY in benefit
  language ("so it can see when you're actually free", "that's the part that takes the load off
  your head"). Sell the step, don't just name it.
- **N things I need from you** - numbered, each a QUESTION or a tiny action, each with enough
  context that they can answer from their chair (e.g. "when you sit down to check your email,
  what do you actually open?"). Never more than three.
- Pre-empt the known objection in-line (e.g. Fathom free "is not a free trial that quietly turns
  into a bill").
- "Send those back and I'll do the setting up at my end beforehand. Then [day] is just switching
  it on and watching it work."
- **What comes after - nothing to do about this yet** - one paragraph previewing the NEXT stage
  (extension, API key) so it never lands cold later. Explicitly "nothing to do about it now."

## 2b. Pre-session, late journey ("let's finish the setup")
*Real example: "Today at 2:30 - let's finish the setup & get on with creating the results:)" to
Ashley, 20 Aug 2026 - pull the SENT copy (Guy's edit), not the drafts. Use once most plumbing is
in and the session's job is to close it out.*

The shape, in order (Guy converged on this over five drafts - keep the shape, rebuild the words
from the client's live state every time):

- **Results framing up top, one breath:** "Today's the day we finish the plumbing. After this...
  we get on with what you're actually here for - results." The whole email points past setup.
- **"Two things before the call, five minutes total"** - pre-call homework that SHRINKS the call
  (a Refresh Tool List; a key created and capped, "which I'm sure you've done before... come
  ready with the key"). This is what makes a 30-minute slot enough. Never more than two or
  three, and say the total time.
- **"On the call we will:"** - three items max, each a plain noun phrase ("Install the Chrome
  extension. Plug your key in."). No selling here; the selling is the next block.
- **The essential next piece** with its WHY in one breath (Ashley: My Wingguy setup page - "until
  it's filled in, every message it writes for you is running on empty instead of sounding like
  you"). Guy placed it right after the on-call list so it reads as part of the plumbing. Frame as
  "essential", never "worthwhile" - and always say why.
- **"And here's what that buys you"** - the capability teaser: 5-6 bullets, each a literal thing
  they can type in quotes, tied to THEIR stated pains in their own words (Ashley:
  "the someone-booked-over-my-blocked-slot problem is done"). Guy's header softened it to "here
  are some of the things that will make possible" - a teaser, not a promise sheet.
- **One thing they can test alone, no session time** - with the exact words to type ("start with
  'what recordings do you hold for me?'").
- Lean close: "See you at [time]."

**The live-proof rule applies to every line:** each "just works" bullet and each "you should be
able to" must have been exercised as that client the same morning (see SKILL.md, session arc).
The Ashley email was only right because the morning's preflight found and fixed two dead pipes
first - the email inherits its truthfulness from the preflight, never from memory.

## 3. Day-of ("one link to click before we start")
*Real example: "Today's session - one link to click before we start" to Owen, 19 Aug 2026.*

- Open by acknowledging their completed homework specifically ("campaign uploaded, webhook
  renamed, Premium sorted... scoring away quietly every night since").
- The ONE action for today with the link in the email.
- Today's agenda in two lines.

## 4. Session follow-up ("where we got to and what's next")
*Real examples: "Wingguy - where we got to and what's next" to Dean, 3 Aug 2026; Owen follow-up
19 Aug 2026.*

- "Good session today" + the single biggest thing now working, in plain benefit terms ("the
  plumbing is proven end to end - normally the part that takes the longest").
- Homework: 2-3 written items max, each with the exact first step and any reassurance needed
  (spend-cap framing for the API key: "worst case in the whole world is a bill the size of the
  cap you set"). Homework that feeds the next session says so: "Upload Campaign 2, ready for us
  to work on together next time".
- Next session date + agenda in one line.
- Anything Guy owes them, stated as Guy's item so they see it tracked ("I'll send it before your
  trial runs out").

**Reusable blocks** (distilled from the Szymon session-1 follow-up, 20 Aug 2026 - lift the
shape, rebuild the words per client):

- **"Two questions to answer whenever suits" (hit reply, or bring them next session)** - the
  forward-scouting block that turns a follow-up into next session's preflight. Each question
  carries its own WHY in benefit language, so answering feels like progress, not admin. The two
  standing ones:
  - *Calendar/email:* "Which calendar and email do you actually live in day to day?" + why
    ("book discovery calls straight into your diary, spot when a lead replies, prep you before
    a meeting"). Phrased as which one runs your life, it flushes out multi-account clients
    (most have 2+) without letting on we've noticed - the answer feeds the wrong-account trap
    check at the connect session.
  - *Note-taker fork:* "Are you using a note-taker on your calls at the moment?" + why it
    matters more than it looks (every transcript feeds Wingguy's memory - meeting prep +
    follow-ups "that sound like you were there"). Then the standard rec, both options with
    their one honest trade-off: **Granola** (nothing joins your calls, best experience, plan we
    need is paid) vs **Fathom** (free covers everything we need, joins as a visible
    participant). Decision rule in one line: often a guest on others' calls -> Granola's
    invisibility is worth a lot; mostly your own calls -> Fathom's fine and free.
- **The front-door habit block** - send the day the connector goes live, and echo until it
  sticks: "Wingguy is now your front door. Any time you're wondering what's next, open Claude
  and ask it" + 2-3 literal prompts in quotes ("Where are we up to?", "What's my homework?").
  Ends "It knows, and it'll answer straight away instead of waiting for me" - trains
  self-serve, which is what frees the 30-minute sessions for real work.
- **Fiddly-step handoff** - when homework is a technical move the client does alone: numbered
  steps in our words first (3 max, exact UI path), THEN the vendor's own guide linked
  ("their own guide with screenshots"), then the ONE safety warning that actually bites
  (LH laptop move: "don't start Linked Helper on the old machine again - running the same
  LinkedIn account from two machines at once is the kind of thing LinkedIn flags"). Verify the
  vendor steps against their live docs before sending, never from memory.
- **"Hold off buying" block** - any purchase where Guy has a code or a better path: name the
  saving, keep the action on Guy's side ("Annual gets you 45% off and I have a promo code worth
  another 10% - I'll send it before your trial runs out").

## 5. The road ahead - the whole journey on one page (STANDARD, every client)
*Canonical version = the one Guy SENT to Szymon Zurek 20 Aug 2026 (his edit of draft
1a019f94aa3445ce - pull the sent copy, not the draft). Refine over time, never rewrite from
scratch.*

**Guy's edit pass (2026-08-20) set the style bar - model it:**
- Opener is ONE line ("Looking forward to our first onboarding this afternoon.") - no
  meta-linking to previous emails ("a different kind of note from the last one" was cut).
- Softer claims: "We should be able to knock over the first two" not "We'll knock over".
- The doctrine touch is a bold lead line "**One taste of that now:**" followed by a bullet with
  one indented sub-bullet - never a prose paragraph.
- Close is lean: "That's the whole road - see you at [time]." (the "engine room" flourish was cut).
- General rule from Guy: **no verbosity - when in doubt, cut.** His edits only ever remove.

The full 8-stage map, benefits-only: **no tool names, no prices, no actions** - those stay in the
step-by-step emails. Stage markers move per client (✅ done / "tomorrow" / 👉 next), so the same
map re-sent in later follow-ups shows them progressing along it.

The stages (REORDERED 2026-08-22 - the engine moved from first to LAST, matching the new journey
order; the canonical Szymon sent copy predates this, so lift its voice but use THIS order):
1 Wingguy in your Claude (the doorway) · 2 Wingguy learns how you work (the interview - "sounds
like you, not a robot") · 3 your calendar (genuinely-free times, never double-booked over your own
life) · 4 your email (drafts as you, threads properly, instant history) · 5 **your meeting
memory - deliberately the longest block on the map, "the sleeper hit"**: follow-ups built from the
exact things people said, "one of the fastest relationship builders there is, and almost nobody
knows about it" · 6 the dress rehearsal (prove the chain, cancel the test together) · 7 Wingguy
in Linkedin (heading wording per Guy 2026-08-20; opening line "A Chrome extension with Wingguy
hooked straight into it."; "does use AI, but a very small amount", their own capped key, pay for
exactly what you use) · 8 the engine (leads flow in, scored overnight) - **last on purpose**: by
then the plumbing is proven and their targeting has settled, "we set it up together when we get
there" as the landing line.

**The standard ending (approved 2026-08-19) - after stage 8, before sign-off:**
"**And after all that - the part that actually matters**" - everything above is just the
plumbing; the real work is what the sessions are for: strategy (who you're going after, why
they'd say yes) · how you run your discovery calls · reading responses and tweaking · the
headspace you take into each meeting · that kind of thing. Then the doctrine touch, three
sentences, never the lecture: "discovery calls get easy the day you stop selling and start
scouting - looking for people worth recommending to the others you know. You can't help
everyone, so you filter for the worthwhile ones - and the people you connect onward don't
forget who did it. It comes back." ("scouting" and "It comes back" deliberately echo the
referral-doctrine tour beats - pre-seeds them, never explains them; the network/team maths
stays for the live penny-drop conversation, NEVER in writing to a new client.) Close: "The
plumbing buys back your time and your memory. What we do with them is where the results come
from."

**When:** default = with the session-1 follow-up; Guy may send it upfront instead (Szymon got it
pre-session, with stages 1-2 marked "tomorrow"). Standalone email, own subject ("The road
ahead - the whole journey on one page"), so clients can find it again.

## Guy's edit pass 2026-08-31 (Roland pre-session) - SIX RULES, apply to every email

Diffed the sent copy against the draft. Guy changed six things; four were correcting a standing
drafting bias. Fold these in BEFORE showing a draft, not after.

1. **Pre-work needs lead time. Under ~24h, there is no homework.** Convert
   "**What I need from you**" into "**What I'll be asking you on the call**" and let them think
   rather than do. Homework with no runway only manufactures another thing they failed to do -
   and for a client already carrying guilt (Roland) that is actively harmful. Keep real pre-work
   for emails sent days ahead.
2. **Sell the LAST step, don't just name it.** The forward-preview section must carry the literal
   thing they will be able to do plus the payoff. Guy replaced "Wingguy inside LinkedIn itself"
   with: type `/wg` in any LinkedIn message box, it reads the past messages and works out what to
   say. Naming a step is not previewing it.
3. **Never re-raise your own past failure.** Guy cut "the bit I tried and failed to show you last
   week". It reads as honesty but it seeds doubt about the thing you are about to install.
   ⚠ Distinct from OWNING a mistake the client is blaming themselves for - that releases them and
   belongs on the call, not in the preview of a new step.
4. **Name the mechanism for technical clients.** Guy added "a link which sets up an account in
   Unipile that makes it all happen". A careful/technical reader will ask how you are getting into
   their mailbox; answer it before they ask and the objection never forms. Skip for non-technical
   clients - it is calibration, not a standard block.
   ⚠ Accuracy note: Unipile hosted auth still walks the client through their provider's OWN consent
   screen, so "instead of OAuth" is loose. The true and better line: they are not approving an app
   we built, and we never see their password.
5. **Sharpen multi-account questions to the real fault line.** "Personal calendar as well as work?"
   beats "most people have more than one" - the invisible personal commitment is what causes the
   double-booking.
6. **"Chrome/Edge extension", never "Chrome extension"** (Edge proven 2026-08-21). Also prefer the
   concrete noun over a vague gesture at it.

Guy did NOT touch: the opener, the benefit sentence under "What we're doing today", the setup-page
paragraph, or the close - so the shape held; the losses were all in selling and calibration.

## 6. Technical install-instruction emails - MORE explicit, not less
*Real example: Dean's extension-delivery email, 31 Aug 2026 - Guy expanded a compact 6-item
numbered list into 7 separate "Step N: [label]" blocks, each its own paragraph.*

**This is the opposite instinct from section 5's "no verbosity - when in doubt, cut."** That rule
governs the SELLING/benefit narrative (road-ahead, teaser bullets, forward-previews) - prose the
client reads to understand value. This section governs a DIFFERENT genre: a literal click-by-click
install walkthrough a non-technical client follows with their hands on the keyboard while reading.
For that genre, more explicit and more broken-out is easier and less scary, not harder. Don't cut
these down to match section 5's instinct.

- **One numbered step per action, each with its own bold mini-header** - "**Step 3: Open Chrome's
  extensions page**" then the one sentence of instruction underneath - not a compressed "3. Type X,
  then Y, then Z" line. A client follows a walkthrough by matching what's on their screen to a step;
  more, smaller steps make that matching easier, never harder.
- **Name the exact thing they'll see on screen, not a generic reference**, whenever the exact name is
  known - e.g. "your 'Dean Hobin's Wingguy Network Accelerator' tab", not "your portal". Naming the
  literal browser-tab title removes the moment of doubt ("wait, which tab?").
- **Keep a warm, human close even after the last technical step** - "Let me know how you go - we are
  just about there :)" - never end cold on the final numbered instruction. The technical steps are
  in service of the relationship, not the other way round.
- Still applies from section 5: name the concrete noun ("chrome://extensions", "Load unpacked"),
  never a vague gesture at the same thing.

