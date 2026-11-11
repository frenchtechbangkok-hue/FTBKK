import { describe, expect, it } from 'vitest';
import {
  EDGE_HEADER,
  PUBLIC_PAGE,
  edgeSafe,
  oldLinkRedirect,
  privatePage,
  publicPageHeaders,
} from '../src/lib/edge-cache';

const HOST = 'french-tech-bangkok.com';
const req = (url = `https://${HOST}/events`) => new Request(url);
const page = (status = 200, extra: Record<string, string> = {}) =>
  new Response('x', {
    status,
    headers: { 'Cache-Control': PUBLIC_PAGE.browser, [EDGE_HEADER]: PUBLIC_PAGE.edge, ...extra },
  });
const cc = (r: Response) => r.headers.get('Cache-Control');

describe('edgeSafe', () => {
  it('lets public pages of the public address be shared at the edge', () => {
    const r = page();
    expect(edgeSafe(req(), r, HOST)).toBe(r);
    const media = new Response('x', {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
    expect(edgeSafe(req(`https://${HOST}/media/a.jpg`), media, HOST)).toBe(media);
  });

  it('never shares answers without a Cache-Control header (no 2-hour guess)', () => {
    const r = edgeSafe(req(`https://${HOST}/api/thing`), new Response('{}'), HOST);
    expect(cc(r)).toBe('private, no-store');
  });

  it('never shares redirects, errors or not-found pages', () => {
    for (const status of [301, 302, 404, 500]) {
      const r = edgeSafe(req(), page(status), HOST);
      expect(cc(r), String(status)).toBe('private, no-store');
      expect(r.headers.has(EDGE_HEADER)).toBe(false);
    }
    const redirect = Response.redirect(`https://${HOST}/events`, 301);
    expect(cc(edgeSafe(req(`https://www.${HOST}/events`), redirect, HOST))).toBe(
      'private, no-store',
    );
  });

  it('never stores what the www, workers.dev or preview addresses get', () => {
    for (const host of [`www.${HOST}`, 'ft-bkk-site.frenchtechbangkok.workers.dev']) {
      const r = edgeSafe(req(`https://${host}/events`), page(), HOST);
      expect(cc(r), host).toBe('private, no-store');
      expect(r.headers.has(EDGE_HEADER)).toBe(false);
    }
  });

  it('keeps private pages private and leaves their body alone', async () => {
    const own = new Response('mine', { headers: { 'Cache-Control': 'private, no-store' } });
    expect(edgeSafe(req(), own, HOST)).toBe(own);
    const r = edgeSafe(req(), page(200, { 'Cache-Control': 'private' }), HOST);
    expect(cc(r)).toBe('private, no-store');
    expect(r.headers.has(EDGE_HEADER)).toBe(false);
    expect(await r.text()).toBe('x');
  });
});

describe('oldLinkRedirect', () => {
  it('lets the edge keep the 301 of an old Wix link on the public address only', () => {
    const r = oldLinkRedirect('/blog/hello', true);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('/blog/hello');
    expect(edgeSafe(req(`https://${HOST}/post/hello`), r, HOST)).toBe(r);
    const www = edgeSafe(
      req(`https://www.${HOST}/post/hello`),
      oldLinkRedirect('/blog/hello', true),
      HOST,
    );
    expect(cc(www)).toBe('private, no-store');
    expect(www.headers.has(EDGE_HEADER)).toBe(false);
  });

  it('never keeps the www redirect or a moved admin screen', () => {
    const r = oldLinkRedirect(`https://${HOST}/events`, false);
    expect(cc(edgeSafe(req(), r, HOST))).toBe('private, no-store');
    expect(r.headers.has(EDGE_HEADER)).toBe(false);
  });
});

describe('publicPageHeaders', () => {
  const html = (headers: Record<string, string> = {}, status = 200) =>
    new Response('<p>x</p>', {
      status,
      headers: { 'Content-Type': 'text/html', ...headers },
    });

  it('marks public HTML pages for the edge, for GET and HEAD (curl -I)', () => {
    for (const method of ['GET', 'HEAD']) {
      const r = html();
      publicPageHeaders(new Request(`https://${HOST}/events`, { method }), r);
      expect(cc(r), method).toBe(PUBLIC_PAGE.browser);
      expect(r.headers.get(EDGE_HEADER)).toBe(PUBLIC_PAGE.edge);
      expect(edgeSafe(req(), r, HOST)).toBe(r);
    }
  });

  it('leaves pages that chose privatePage, other answers and admins alone', () => {
    const own = html();
    privatePage({ response: { headers: own.headers } });
    publicPageHeaders(req(), own);
    expect(cc(own)).toBe('private, no-store');

    const json = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    publicPageHeaders(req(), json);
    expect(cc(json)).toBeNull();

    const missing = html({}, 404);
    publicPageHeaders(req(), missing);
    expect(cc(missing)).toBeNull();

    const post = html();
    publicPageHeaders(new Request(`https://${HOST}/join`, { method: 'POST' }), post);
    expect(cc(post)).toBeNull();

    const admin = html();
    publicPageHeaders(
      new Request(`https://${HOST}/founders-guide`, {
        headers: { Cookie: 'a=1; CF_Authorization=tok' },
      }),
      admin,
    );
    expect(cc(admin)).toBe('private, no-store');
    expect(admin.headers.has(EDGE_HEADER)).toBe(false);
  });
});
