/**
 * WC2026 Cron Sync Worker
 *
 * Runs every minute via Cloudflare Cron Trigger.
 * Checks if any match is within a live window (10 min before kickoff to
 * 3 hours after kickoff). If yes, calls /sync-matches on the Pages site.
 * If no, does nothing — zero DB impact.
 *
 * This replaces the pg_cron job that was hammering the Supabase Nano instance.
 */

interface Env {
  SYNC_URL: string;
  DATA_URL: string;
  WC26_WEBHOOK_SECRET: string;
}

interface Match {
  id: string;
  date: string;
  time: string;
}

interface DataJson {
  group_matches: Record<string, Match[]>;
  ko_matches: Match[];
}

/** Parse "13:00 UTC-6" style time into a UTC epoch ms */
function parseKickoffUtc(date: string, time: string): number {
  const m = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/.exec(time.trim());
  if (!m) return new Date(`${date}T00:00:00Z`).getTime();
  const hh = m[1];
  const mm = m[2];
  const offsetSign = m[3].startsWith('-') ? '-' : '+';
  const offsetHours = m[3].replace(/^[+-]/, '').padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00${offsetSign}${offsetHours}:00`).getTime();
}

/** Check if any match is within the live window */
function isWithinMatchWindow(matches: Match[], now: number): boolean {
  const BEFORE_KICKOFF = 10 * 60 * 1000; // 10 minutes before
  const AFTER_KICKOFF = 3 * 60 * 60 * 1000; // 3 hours after (covers extra time + penalties)

  for (const match of matches) {
    const kickoff = parseKickoffUtc(match.date, match.time);
    if (now >= kickoff - BEFORE_KICKOFF && now <= kickoff + AFTER_KICKOFF) {
      return true;
    }
  }
  return false;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = event.scheduledTime;

    // Fetch the match schedule (CDN-cached, fast)
    const res = await fetch(env.DATA_URL, {
      headers: { 'User-Agent': 'wc26-cron-sync/1.0' },
    });
    if (!res.ok) {
      console.error(`Failed to fetch data.json: ${res.status}`);
      return;
    }

    const data: DataJson = await res.json();

    // Flatten all matches
    const allMatches: Match[] = [
      ...Object.values(data.group_matches).flat(),
      ...data.ko_matches,
    ];

    // Check if we're in a match window
    if (!isWithinMatchWindow(allMatches, now)) {
      // No match is live — do nothing
      return;
    }

    // A match is live — call sync-matches
    const syncRes = await fetch(env.SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wc26-secret': env.WC26_WEBHOOK_SECRET,
      },
      body: '{}',
    });

    if (!syncRes.ok) {
      console.error(`sync-matches returned ${syncRes.status}: ${await syncRes.text()}`);
    }
  },

  // Also support manual trigger via HTTP for testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const now = Date.now();
    const res = await fetch(env.DATA_URL, {
      headers: { 'User-Agent': 'wc26-cron-sync/1.0' },
    });
    if (!res.ok) {
      return new Response(`Failed to fetch data.json: ${res.status}`, { status: 502 });
    }
    const data: DataJson = await res.json();
    const allMatches: Match[] = [
      ...Object.values(data.group_matches).flat(),
      ...data.ko_matches,
    ];
    const inWindow = isWithinMatchWindow(allMatches, now);

    if (inWindow) {
      const syncRes = await fetch(env.SYNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wc26-secret': env.WC26_WEBHOOK_SECRET,
        },
        body: '{}',
      });
      return new Response(
        JSON.stringify({ triggered: true, syncStatus: syncRes.status }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ triggered: false, reason: 'no match in window', now: new Date(now).toISOString() }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
};
