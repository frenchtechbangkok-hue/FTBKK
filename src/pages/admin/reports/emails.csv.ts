import type { APIRoute } from 'astro';
import { toDateInput } from '../../../lib/admin';
import { csvCell } from '../../../lib/csv';
import { loadEmailReport } from '../../../lib/reports';

// Admin only (guarded in middleware). Reports > Emails as a CSV, with the page's period:
// ?table=subjects (figures per email subject) or, by default, emails sent, delivered, opened and
// clicked per week, month or year.
export const GET: APIRoute = async ({ url }) => {
  const { period, report: r, error } = await loadEmailReport(url);
  if (!r) return new Response(error ?? 'No email figures yet.', { status: 503 });
  const subjects = url.searchParams.get('table') === 'subjects';
  const lines: unknown[][] = subjects
    ? [
        ['Subject', 'First sent', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Bounced', 'Spam'],
        ...r.subjects.map((s) => [
          s.subject,
          toDateInput(s.firstSent),
          s.sent,
          s.delivered,
          s.opened,
          s.clicked,
          s.bounced,
          s.complained,
        ]),
      ]
    : [
        [r.unit[0]!.toUpperCase() + r.unit.slice(1), 'Sent', 'Delivered', 'Opened', 'Clicked'],
        ...r.buckets.map((b, i) => [
          b.key,
          r.sentSeries[i] ?? 0,
          r.deliveredSeries[i] ?? 0,
          r.openedSeries[i] ?? 0,
          r.clickedSeries[i] ?? 0,
        ]),
      ];
  const body = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="emails-${subjects ? 'by-email' : 'over-time'}-${period.fromInput}-to-${period.toInput}.csv"`,
    },
  });
};
