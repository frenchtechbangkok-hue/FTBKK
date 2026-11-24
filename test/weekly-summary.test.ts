import { describe, expect, it } from 'vitest';
import { newMembersCount, withNewMembers } from '../src/lib/cron-directory';
import { newMemberLine } from '../src/lib/members';
import type { Member } from '../src/db/schema';

const member = (over: Partial<Member>): Member =>
  ({
    name: 'Camille Martin',
    email: 'camille@example.com',
    profileType: 'founder',
    company: 'Siam Robotics',
    jobTitle: 'CEO',
    howHeard: 'LinkedIn',
    memberSince: new Date('2026-11-18T05:00:00Z'),
    ...over,
  }) as Member;

describe('weekly summary: new members', () => {
  it('describes each new member on one line', () => {
    expect(newMemberLine(member({}))).toBe(
      'New member: Camille Martin (camille@example.com), CEO, Siam Robotics. Founder or co-founder, heard of us via LinkedIn, joined 18 November 2026.',
    );
    expect(
      newMemberLine(
        member({ company: null, jobTitle: null, howHeard: null, profileType: 'student' }),
      ),
    ).toBe('New member: Camille Martin (camille@example.com). Student, joined 18 November 2026.');
  });

  it('counts them in words', () => {
    expect(newMembersCount(0)).toBe('no new member');
    expect(newMembersCount(1)).toBe('1 new member');
    expect(newMembersCount(3)).toBe('3 new members');
  });

  it('adds the list to a text saved before it existed', () => {
    const old = { subject: 'S', body: 'Hi\n\n{renewals}', buttonLabel: 'Go' };
    expect(withNewMembers(old)!.body).toBe('Hi\n\n{renewals}\n\n{new-members}');
    const recent = { ...old, body: '{new-members}\n\n{renewals}' };
    expect(withNewMembers(recent)).toBe(recent);
    expect(withNewMembers(null)).toBeNull();
  });
});
