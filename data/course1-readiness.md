# First-year schedule migration — readiness audit

Updated: 2026-10-21

## Scope
Source named in the previous preparation pass: `ЮФ 1к офо с 05.10(7).pdf`.
Target groups:
- Ю600/О-2601
- Ю600/О-2602
- Ю600/О-2603
- Ю600/О-2604

The prior local preparation report stated that the normalized draft contained 100 lesson records across these four groups. This document records review blockers; it is not itself the schedule dataset.

## Findings requiring explicit handling
- A Thursday entry for group Ю600/О-2603 contains the printed date `19.12*`. 19 December 2026 is a Saturday, so do not activate or silently change this exception without checking the source page.
- Dates `14.09` and `28.09` appear earlier than the PDF's stated update date (05.10.2026). Preserve them as source annotations until their meaning is confirmed.
- An Economics room annotation appears as `218В+`. Do not strip the plus sign or infer its meaning without source confirmation.
- The previous validator reported 27 warnings for manual attention. A clean schema/calendar test does not resolve these source ambiguities.

## Integration gate
Do not connect these groups to the live schedule renderer until all of the following are true:
1. The machine-readable schedule file and adapter are committed alongside this audit.
2. Each source row is checked against the correct group column, weekday, pair time, teacher, room, and date rule.
3. Date-specific lessons, ranges, and exclusions are encoded as rules rather than repeated as ordinary weekly lessons.
4. The unresolved `19.12*` entry is either confirmed from the source or explicitly kept inactive.
5. The existing second-year schedule, date navigation, week anchor (12–18 Oct 2026 = week Б; 19–25 Oct = week А), and group switcher pass regression checks.
6. A published build is manually checked on mobile before the group is described as available.

## Current status
Audit documentation only. No first-year schedule data has been activated by this change. This branch deliberately does not modify `index.html` or existing second-year data.
