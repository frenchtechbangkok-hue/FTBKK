import { describe, expect, it } from 'vitest';
import { EDGE_HEADER, PUBLIC_PAGE, edgeSafe } from '../src/lib/edge-cache';

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
