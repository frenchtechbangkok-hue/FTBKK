/**
 * Visits that come from the site's own emails. Mail apps send no referrer, so Cloudflare Web
 * Analytics counts a click in an email as "Direct or unknown", and it drops query strings, so UTM
 * tags never reach its figures either. Instead every link to the public site in an email gets
 * `utm_source=ftbkk&utm_medium=email&utm_campaign=<which email>` (tagEmailLinks, called by
 * renderEmail), and the Worker counts those visits itself (src/lib/email-visits.ts) before
 * redirecting to the same address without the tags. Pure functions, unit tested.
 */

export const UTM_SOURCE = 'ftbkk';
export const UTM_MEDIUM = 'email';
/** Campaign of an email that doesn't say which one it is. */
export const OTHER_CAMPAIGN = 'other';

/** A campaign name safe for a URL and the report: lowercase letters, digits, dots and dashes. */
export function campaignSlug(s: string, max = 60) {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\{name\}/g, '')
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || OTHER_CAMPAIGN
  );
}

/** Paths never tagged: files, the admin (team emails) and the API (one-click links). */
const SKIP = /^\/(api|admin|media|_astro)(\/|$)/;

/** The site's address and its www / bare twin. */
export function siteHosts(host: string) {
  const bare = host.replace(/^www\./, '');
  return [bare, `www.${bare}`];
}

/** The link with the email's tags, or unchanged when it isn't a page of the site. */
export function tagUrl(url: string, campaign: string, hosts: string[]) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/^https?:$/.test(u.protocol) || !hosts.includes(u.host) || SKIP.test(u.pathname)) return url;
  // A link already tagged by hand keeps its own tags.
  if ([...u.searchParams.keys()].some((k) => k.startsWith('utm_'))) return url;
  u.searchParams.set('utm_source', UTM_SOURCE);
  u.searchParams.set('utm_medium', UTM_MEDIUM);
  u.searchParams.set('utm_campaign', campaignSlug(campaign));
  return u.toString();
}

const unescapeAttr = (s: string) => s.replace(/&amp;/g, '&');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Tags every href="…" pointing at the site in an HTML email. */
export function tagHtmlLinks(html: string, campaign: string, hosts: string[]) {
  return html.replace(/href="([^"]*)"/g, (all, href: string) => {
    const tagged = tagUrl(unescapeAttr(href), campaign, hosts);
    return tagged === unescapeAttr(href) ? all : `href="${escapeAttr(tagged)}"`;
  });
}

/** Tags every address of the site written out in a plain-text email. */
export function tagTextLinks(text: string, campaign: string, hosts: string[]) {
  return text.replace(/https?:\/\/[^\s<>"'()]+/g, (match) => {
    // A full stop or comma after an address ends the sentence, not the address.
    const tail = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
    const url = tail ? match.slice(0, -tail.length) : match;
    return tagUrl(url, campaign, hosts) + tail;
  });
}

/**
 * A visit from one of the site's emails: the campaign, the page, and the same address without the
 * tags (where the Worker redirects). Null for any other address, including other sites' emails
 * that use utm_medium=email with their own source.
 */
export function readEmailVisit(url: URL) {
  if (url.searchParams.get('utm_source') !== UTM_SOURCE) return null;
  if (url.searchParams.get('utm_medium') !== UTM_MEDIUM) return null;
  const campaign = campaignSlug(url.searchParams.get('utm_campaign') ?? '', 80);
  const clean = new URL(url);
  for (const k of [...clean.searchParams.keys()])
    if (k.startsWith('utm_')) clean.searchParams.delete(k);
  return {
    campaign,
    path: (url.pathname.replace(/(.)\/+$/, '$1') || '/').slice(0, 200),
    clean: clean.toString(),
  };
}

/**
 * Mail security scanners (Outlook Safe Links, corporate gateways) and link previews open links
 * before the person does: those aren't visits.
 */
export function looksLikeBot(userAgent: string | null) {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|scan|python|curl|wget|httpclient|okhttp|java\/|go-http|headless|phantom|monitor|proofpoint|mimecast|barracuda|safelinks/i.test(
    userAgent,
  );
}

/** How a campaign shows in the report: an email of the site, an event or a community email. */
export function campaignLabel(campaign: string, templates: Record<string, { label: string }>) {
  if (campaign === OTHER_CAMPAIGN) return 'Other emails';
  const t = templates[campaign];
  if (t) return t.label;
  const words = (s: string) => s.replace(/-/g, ' ');
  if (campaign.startsWith('event-')) return `Event email: ${words(campaign.slice(6))}`;
  if (campaign.startsWith('community-')) return `Community email: ${words(campaign.slice(10))}`;
  return words(campaign);
}
