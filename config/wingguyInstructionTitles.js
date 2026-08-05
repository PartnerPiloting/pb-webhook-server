/**
 * Plain-English names for Wingguy instructions, keyed by rule_key.
 *
 * WHY THIS FILE EXISTS: the rules store has no title column - `warm-reply-gtm` is a key, not a
 * name a client should ever read. The setup page's "How your Wingguy works" section needs every
 * instruction to introduce itself like a person, so the names live here, hand-written.
 *
 * `title` is what the client sees in the list. `gist` is the one-line summary under it - written
 * only where it can be stated confidently from the rule's actual content; an instruction with no
 * gist just shows its title (the body is one tap away, so a missing gist beats a wrong one).
 *
 * Unmapped keys fall back to a prettified key via titleFor(), so a new rule never breaks the page
 * - it just shows up plainer until someone names it here.
 */

const TITLES = {
  // --- The two guardrails (foundation, locked) -------------------------------------------------
  'draft-first-workflow': {
    title: 'Nothing is sent without you seeing it',
    gist: 'Every email is shown to you as a draft first - writing the real thing is the last step, never the first.',
  },
  'outbound-email-hard-checks': {
    title: 'Every email is copied to your records',
    gist: 'The checks every outbound email must pass, including the copy that keeps the conversation on the person\'s file.',
  },

  // --- Shared method: everywhere ----------------------------------------------------------------
  'writing-voice-foundation': { title: 'How a message earns a reply', gist: 'The writing craft every message follows - grounded, specific, human.' },
  'message-polish': { title: 'The final polish', gist: 'The last pass every draft gets before it reaches you.' },
  'messages-plant-the-seed': { title: 'Plant the seed, don\'t make the case', gist: 'The big shift lands in conversation - messages only hint at it.' },
  'mirror-their-energy': { title: 'Match their energy', gist: 'Never three paragraphs to someone who sent one line.' },
  'no-repeat-set-pieces': { title: 'Never send the same set piece twice', gist: 'If they\'ve already had the deck, they don\'t get it again.' },
  'pitch-language-recommend': { title: 'Recommend, never sell', gist: 'The language stays about people recommending each other - the moment it sounds like selling, the idea is lost.' },
  'proactive-close': { title: 'Every message ends with a reason to reply', gist: 'The close is a question that names the format and the purpose.' },
  'profile-hook-craft': { title: 'Say something true about them', gist: 'Read the profile properly and find the one genuine detail - never parrot their headline.' },
  'reason-to-meet-again': { title: 'Give every conversation a reason to continue', gist: 'Goodwill with nothing attached to it decays.' },
  'network-context-principle': { title: 'They already have a network', gist: 'Senior people have a passive network - what\'s on offer is building one deliberately. Confusing the two is an insult.' },
  'day-aware-signoff': { title: 'Sign off knowing what day it is', gist: 'A Friday afternoon doesn\'t read like a Monday morning.' },
  'weekend-signoff': { title: 'The weekend line', gist: 'How messages drafted near the weekend close.' },
  'campaign-detection': { title: 'Knowing which campaign a thread belongs to', gist: 'How Wingguy works out which of your campaigns a conversation is part of.' },
  'default-explainer-asset': { title: 'Your default "here\'s what I do" link', gist: 'The one piece Wingguy reaches for when someone asks what you do.' },
  'two-way-mechanic': { title: 'The two-way mechanic', gist: 'The two questions under every conversation: the offer, and the inversion. Then the pause.' },
  'core-framing-inversion': { title: 'The penny-drop framing', gist: 'Stop being a better solo networker - stop being solo at all.' },
  'staying-in-touch-ladder': { title: 'The three rungs of staying in touch', gist: 'Three ways to keep a good conversation alive, in order of what you can honestly deliver.' },

  // --- Shared method: reaching out --------------------------------------------------------------
  'post-connection-message': { title: 'The thanks-for-connecting message', gist: 'Three short lines: something true from their profile, a seed of your idea, a question.' },
  'message-success-criteria': { title: 'What a good message achieves', gist: 'Gets a reply, moves toward a call, plants the seed - and never feels like it could have been sent to anyone.' },
  'outreach-core-objective': { title: 'The job of every outreach message', gist: 'Assess and advance - never teach, never solve, never lecture.' },

  // --- Shared method: when they reply -----------------------------------------------------------
  'warm-reply-gtm': { title: 'Warm reply from a collaboration-native person', gist: 'They already think in partnerships - go straight to the meeting.' },
  'warm-reply-mindset-match': { title: 'Warm reply asking "what do you do?"', gist: 'Answer the question in one clean sentence, plant the idea, no model-dump.' },

  // --- Shared method: getting it in the diary ---------------------------------------------------
  'invite-before-promise': { title: 'The invite is the commitment', gist: 'Once a time is agreed, the calendar invite goes out before anything else.' },
  'offer-times-only-after-agreed': { title: 'Times come after the yes', gist: 'Slots are offered once a meeting is actually agreed, not as a pressure move.' },
  'time-offer-connecting-line': { title: 'The line above the times', gist: 'Slot lists always open with a real question, never a bare list of dates.' },
  'timezone-playbook': { title: 'Getting timezones right', gist: 'Times written to people are on their clock; your calendar stays on yours.' },
  'call-objectives': { title: 'The two non-negotiable moves', gist: 'Every first call: the genuine introduction offer, and the inversion question - then the pause.' },
  'pre-call-research': { title: 'The homework before every call', gist: 'What Wingguy digs up first - past emails, the transcript, and the strongest reason this person would benefit.' },
  'call-conduct': { title: 'How to carry yourself on the call', gist: 'Lead with generosity, guide rather than lecture, keep direction without force.' },
  'call-signals-patterns': { title: 'The patterns to watch for', gist: 'Builder trap, overthinking, low urgency, busy-but-no-advocates - and what each one means.' },

  // --- Shared method: after a call --------------------------------------------------------------
  'three-call-structure': { title: 'The three-call structure', gist: 'Discover, share and connect, decide - one job per call, never mixed.' },
  'call1-discovery': { title: 'Call one - discovery', gist: 'A real conversation, not an interview. Listen for how they think, book call two before hanging up.' },
  'advocacy-argument': { title: 'The case for advocacy', gist: 'Six beats that make the case for advocates over contacts - in your own sentences.' },
  'live-introduction-demo': { title: 'The live demonstration', gist: 'Every second call includes a real introduction, made by email - proof beats explanation.' },
  'followup-email-structure': { title: 'The follow-up email after call one', gist: 'A mirror, not a content dump: promise first, their words next, your manifesto before any links.' },

  // --- Shared method: following up --------------------------------------------------------------
  'deferral-capture': { title: 'When someone says "maybe later"', gist: 'A vague timeframe becomes a real date with a reminder attached, so nobody quietly goes cold.' },
  'followup-brief': { title: 'The daily follow-up brief', gist: 'How your follow-up list is presented each day.' },
  'introduction-emails': { title: 'How introductions are written', gist: 'The shape of an introduction email - who each person is, and why they should connect.' },
  'quote-them-back': { title: 'Quote them back', gist: 'Follow-ups use their own words from the call, not a summary of them.' },
  'reconnection-formula': { title: 'Reconnecting after a gap', gist: 'How to restart a conversation that went quiet without making it awkward.' },
  'reengagement-values-post': { title: 'Re-engaging around something they shared', gist: 'Using something they posted or said as the honest reason to reconnect.' },
  'reminder-discipline': { title: 'Reminder discipline', gist: 'How follow-up reminders are set and kept honest.' },

  // --- Starter-kit scaffolds a client may hold as their own -------------------------------------
  'booking-defaults': { title: 'Your booking defaults', gist: 'Your standing meeting room, length, earliest start, and how your week fills up.' },
  'call2-scaffold': { title: 'Call two - your story', gist: 'The four beats of your origin story - written by you during onboarding.' },
  'campaign-markers': { title: 'Your campaign markers', gist: 'The giveaway phrases that identify which campaign a thread belongs to. Starts empty on purpose.' },
  'closing-question': { title: 'How you close a message', gist: 'Always a question, always keeping your chosen purpose in it.' },
  'default-explainer-choice': { title: 'Which explainer is yours', gist: 'Naming the one "here\'s what I do" piece Wingguy sends on your behalf.' },
  'email-html-format': { title: 'How your emails are laid out', gist: 'The locked visual shell - font, spacing, links - your words go inside it.' },
  'introduction-emails-html': { title: 'How your introductions are laid out', gist: 'The callout-block layout that makes an introduction scannable in seconds.' },
  'framing-angles-scaffold': { title: 'Your framing angles', gist: 'One angle per audience you target - written by you.' },
  'lead-evaluation': { title: 'How you evaluate a lead', gist: 'Your lens for deciding how much to invest in a conversation.' },
  'linkedin-message-style': { title: 'LinkedIn message style', gist: 'Shorter and more conversational than email - one idea per message.' },
  'manifesto-scaffold': { title: 'Your manifesto', gist: 'Your definitive articulation of what you\'re building - quotable short form and longer unpacking.' },
  'message-avoid-list': { title: 'What to keep out of messages', gist: 'No teaching in DMs, no explaining the system, no stacked compliments.' },
  'message-structure': { title: 'How long a message gets to be', gist: 'Two short paragraphs, maximum. No walls of text.' },
  'message-tone': { title: 'The tone of your outreach', gist: 'Peer-level, calm, no hype, no selling language.' },
  'objections-scaffold': { title: 'Your objections library', gist: 'Real questions from real conversations, captured as patterns - built by you over time.' },
  'opening-lines': { title: 'How messages open', gist: 'Specific and grounded - never a generic compliment.' },
  'outreach-timing': { title: 'When messages go out', gist: 'Tuesday to Thursday mornings, their local time - never Mondays, never Fridays.' },
  'red-flags': { title: 'Red flags', gist: 'The patterns that predict a poor fit, however well the first conversation goes.' },
  'stage-reading': { title: 'Reading where the conversation is', gist: 'Handshake, pitched-but-quiet, or replied - worked out before drafting, never assumed.' },
  'targeting-scaffold': { title: 'Your targeting', gist: 'Who you\'re for, where they cluster, and the hook per market - defined by you.' },
  'warm-path-first': { title: 'Warm path first', gist: 'Before spending a cold credit, check who could make the introduction.' },
  'asset-library-scaffold': { title: 'Your asset library', gist: 'The links you send, each with rules for when it earns its place.' },
  'pre-call-brief-format': { title: 'Your pre-call cheat sheet', gist: 'The prep note Wingguy emails you before a call.' },
};

/** Title for any rule_key, mapped or not. Never returns a kebab-case key to a human. */
function titleFor(ruleKey) {
  const hit = TITLES[ruleKey];
  if (hit) return hit.title;
  const words = String(ruleKey || '').replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function gistFor(ruleKey) {
  const hit = TITLES[ruleKey];
  return (hit && hit.gist) || '';
}

module.exports = { TITLES, titleFor, gistFor };
