/**
 * Transcript provider seam — WHICH capture tool feeds a coach's transcripts into the store.
 *
 * Mirrors calendarProvider.activeProvider: per-coach `Transcript Provider` roster field wins,
 * then env TRANSCRIPT_PROVIDER, then 'fathom' (today's behaviour for every existing client).
 *
 * Providers:
 *   fathom  = Fathom bot/API (poll + webhook) — the existing pipe, untouched.
 *   granola = Granola personal note-taker (webhook push -> granolaIngestService). The client
 *             captures locally (no bot), Granola generates the note, its webhook tells us.
 *   zoom    = reserved: Zoom My Notes — no public API yet (see memory transcript-provider-strategy);
 *             selecting it today means "transcripts arrive via the manual import door only".
 *
 * The selection is deliberately ADVISORY for ingest: an inbound Granola webhook for a client is
 * processed as long as they carry Granola credentials, even if their roster field still says
 * Fathom — a real transcript arriving is never refused over configuration lag. Where the field
 * IS load-bearing is anything that actively goes out and does work per provider (polls, health
 * checks, onboarding prompts).
 */

function activeTranscriptProvider(coach) {
  const p = (coach && coach.transcriptProvider) || process.env.TRANSCRIPT_PROVIDER || 'fathom';
  return String(p).trim().toLowerCase();
}

module.exports = { activeTranscriptProvider };
