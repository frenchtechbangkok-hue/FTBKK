import type { APIRoute } from 'astro';
import { csvCell } from '../../../lib/csv';
import { loadTrafficReport } from '../../../lib/reports';

// Admin only (guarded in middleware). Reports > Website traffic as a CSV, with the page's period:
// ?table=pages (most viewed pages) or, by default, visits, page views and requests per week,
// month or year.
export const GET: APIRoute = async ({ url }) => {
  const { period, report: r, error } = await loadTrafficReport(url);
  const p = r?.pageloads.data;
  if (!r || !p) {
    return new Response(error ?? r?.pageloads.error ?? 'Cloudflare is not connected.', {
      status: 503,
    });
  }
  const pages = url.searchParams.get('table') === 'pages';
  const w = r.worker.data;
  const lines: unknown[][] = pages
    ? [['Page', 'Page views'], ...p.tops.pages]
    : [
        [r.unit[0]!.toUpperCase() + r.unit.slice(1), 'Visits', 'Page views', 'Requests'],
        ...r.buckets.map((b, i) => [
          b.key,
          p.visitsSeries[i] ?? 0,
          p.viewsSeries[i] ?? 0,
          w ? (w.series[i] ?? 0) : '',
        ]),
      ];
  const body = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="traffic-${pages ? 'pages' : 'visits'}-${period.fromInput}-to-${period.toInput}.csv"`,
    },
  });
};
