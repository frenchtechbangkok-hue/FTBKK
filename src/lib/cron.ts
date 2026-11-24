import { runDirectoryJobs, sendModeratorDigest } from './cron-directory';
import { TZ } from './format';
import { sendEventReminders, sendFeedbackRequests, weeklyBackup } from './cron-events';
import { runMemberRenewals } from './members';
import { getSettings } from './settings';
import { runSocialPosts } from './social';
import { runNewsletters } from './newsletters';

const weekdayIn = (now: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);

/** The daily jobs run at 02:00 UTC = 09:00 Asia/Bangkok. */
export const DAILY_HOUR_UTC = 2;

/** Minutes between two cron runs (the cron in wrangler.jsonc fires every 5 minutes). */
export const CRON_EVERY_MINUTES = 5;

/** Whether this run is the one that does the daily jobs (the first run of 02:00 UTC). */
export const isDailyRun = (now: Date) =>
  now.getUTCHours() === DAILY_HOUR_UTC && now.getUTCMinutes() < CRON_EVERY_MINUTES;

/**
 * Scheduled jobs. The cron fires every 5 minutes (wrangler.jsonc): newsletters and social media
 * posts go out at their time, the rest once a day at 09:00 Bangkok. Each job is isolated so one
 * failure doesn't stop the others.
 */
export async function runScheduled(_env: Env, now: Date): Promise<void> {
  const often: [string, () => Promise<unknown>][] = [
    ['social-posts', () => runSocialPosts(now)],
    ['newsletters', () => runNewsletters(now)],
  ];
  const daily: [string, () => Promise<unknown>][] = [
    ['event-reminders', () => sendEventReminders(now)],
    ['event-feedback', () => sendFeedbackRequests(now)],
    ['directory', () => runDirectoryJobs(now)],
    // Its own job, so a failing directory step never holds back the Monday summary.
    [
      'weekly-summary',
      async () =>
        weekdayIn(now) === 'Mon'
          ? (await sendModeratorDigest(now))
            ? 'sent'
            : 'nothing to say'
          : 'not Monday',
    ],
    // Yearly reconfirmation, only once membership is open (emails must reach everyone).
    [
      'member-renewals',
      async () => ((await getSettings()).memberSignupOpen ? runMemberRenewals(now) : 'off'),
    ],
    ['backup', () => weeklyBackup(now)],
  ];
  const jobs = isDailyRun(now) ? [...often, ...daily] : often;
  for (const [name, job] of jobs) {
    try {
      console.log(`[cron] ${name}`, JSON.stringify(await job()));
    } catch (e) {
      console.error(`[cron] ${name} failed`, e);
    }
  }
}
