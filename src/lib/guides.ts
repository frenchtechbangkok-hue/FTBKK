import type { AstroGlobal } from 'astro';
import { checkAdmin } from './auth';
import type { Settings } from './settings';

/**
 * The two Thailand guides can be put online or kept offline from Admin > Website > Guide pages,
 * so the board can check the content first. Offline, the page answers 404 to the public and its
 * links leave the header, footer, sitemap and the other guide; a logged-in admin still sees it,
 * with a "not online" banner.
 */
export const GUIDES = {
  '/founders-guide': { key: 'foundersGuideOnline', label: "Founder's Guide" },
  '/expand-to-thailand': { key: 'expansionGuideOnline', label: 'Expanding to Thailand' },
} as const satisfies Record<string, { key: keyof Settings; label: string }>;
export type GuidePath = keyof typeof GUIDES;

const isGuide = (href: string): href is GuidePath => href in GUIDES;

/** False only for a guide that is switched off; every other link is always shown. */
export const linkOnline = (settings: Settings, href: string) =>
  !isGuide(href) || settings[GUIDES[href].key];

/**
 * How a guide page should render: 'online', 'preview' (offline, seen by an admin) or 'hidden'
 * (offline, seen by the public: the page rewrites to 404). Admins are recognised by the Access
 * login cookie that /admin sets for the whole site.
 */
export async function guideMode(
  astro: AstroGlobal,
  settings: Settings,
  path: GuidePath,
): Promise<'online' | 'preview' | 'hidden'> {
  if (settings[GUIDES[path].key]) return 'online';
  const check = await checkAdmin(astro.request);
  return 'email' in check ? 'preview' : 'hidden';
}
