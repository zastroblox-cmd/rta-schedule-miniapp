# Schedule migration status

Last updated: 2026-10-21

## Current deployed app
- App: `index.html` on the default branch.
- Current file blob SHA at start of this work: `b5d1a726626abf8979cf1ecdc5997c2a63a1ae37`.
- Current live app architecture contains schedules for second-year law groups only.
- Keep the current dark graphite/blue UI, date navigation, profile/group switcher, class status badges, and current second-year data intact.
- Do not deploy placeholder schedules or let a group without data crash rendering.
- Week anchor required by user: 12–18 Oct 2026 = week Б; 19–25 Oct = week А; alternate weekly thereafter.

## Source PDFs found in project Library
- First year: `ЮФ 1к офо с 05.10(2).pdf` (3 pages; updated schedule from 05.10.2026).
- Second year: `ЮФ 2 к офо с 05.10(2).pdf` (2 pages; current data already in app, but needs comparison against PDF).
- Third year: `ЮФ 3 к офо с 05.10(2).pdf` (2 pages; updated schedule from 05.10.2026).
- Fourth year: user has now uploaded newer/revised `ЮФ 4 к офо с 05.10(3).pdf` (3 pages; актуализированное расписание с 05.10.2026, 5 group columns). This upload supersedes the earlier `(2)` version and is the source of truth.

## Groups to support
- Course 1: Ю600/О-2601, Ю600/О-2602, Ю600/О-2603, Ю600/О-2604.
- Course 2: Ю601/О-2501, Ю602/О-2502, Ю603/О-2503, Ю604/О-2504.
- Course 3: Ю601/О-2401, Ю602/О-2402, Ю603/О-2403, Ю604/О-2404.
- Course 4: Ю601/О-2301, Ю602/О-2302, Ю603/О-2303, Ю604/О-2304, Ю603/О-2305.
- Do not add Ю605/О-2405; it was a prior mistaken entry.

## Known second-year correction to preserve
- For Ю604/О-2504, user flagged Tuesday 13 Oct, Wednesday 14 Oct, and Saturday 24 Oct 2026 as not matching the official schedule. These need direct PDF comparison before calling the migration verified.

## Data conversion requirements
- Preserve lesson title, start/end, lesson type, teacher, room, and date restrictions/exceptions.
- PDF text extraction contains OCR/layout noise; verify group column and day/time visually or from page-level text before coding.
- Regular weekly lessons, one-off dated lessons, date ranges (e.g. “по 23.11”), and exclusions (“кроме ...”) must be represented distinctly.
- Do not treat a date annotation as merely decorative if it changes whether a lesson occurs.
- Validate JavaScript syntax and verify that group switching/rendering still works before publishing app code.

## Verification performed on 2026-10-21
- Fetched the current default-branch `index.html` and checked the last inline JavaScript block with the JavaScript parser: syntax passes.
- Confirmed the deployed app code currently only recognizes the four second-year groups; course 1/3/4 group IDs are not yet integrated. Do not describe the all-course migration as complete.
- All four course PDFs (1st, 2nd, 3rd, 4th) are available. The new fourth-year PDF was extracted to text and rendered to page images for visual checking. It contains five group columns (2301, 2302, 2303, 2304, 2305), a Monday–Thursday timetable, Friday marked `по плану факультета`, and Saturday timetable; date-specific entries and exclusions must be represented as rules, not simply repeated weekly.

## Next work
1. Normalize the new fourth-year PDF by group/day/time, retaining exact teacher, room, lesson type, explicit dates, date ranges and exclusions.
2. Implement date-aware rendering for course 4 without changing course 2 behavior.
3. Add the five fourth-year groups to the selector only after their data is populated and tested.
4. Then continue with courses 1 and 3.
2. Build a machine-readable schedule dataset with explicit date rules.
3. Integrate the dataset with the current renderer without changing the visual design.
4. Test each group/date and only mark a group available when its schedule is actually populated and checked.


## Update 2026-10-21 — draft group preview deployed
- Commit: `9ac968bed0740879d89addb3ca164617aaa7a7af`.
- Added the 13 first-/third-/fourth-year group IDs to the group selector as clearly marked draft previews.
- These groups use empty schedules intentionally; the UI explains that their lessons have not yet been migrated. No classes were fabricated from unverified OCR.
- The four second-year group IDs and their existing schedule definitions were preserved.
- This is a selector/UI preview only, NOT a schedule-data migration. Next: extract/verify PDF rows and replace draft status only after the corresponding group schedule is populated and checked.

- Follow-up fix commit: `c66e9f4281b13c0d792398db432b9ed34fb28fd2`. Reordered draft schedule declarations before the schedule map, added a fallback when resolving a group's schedule, and prevented the draft empty-state message from being overwritten by the Saturday note. JavaScript syntax check passed. Verify the deployed app manually on mobile; GitHub Pages workflow was successful for the earlier deploy but the latest fix's deployment still needs confirmation.


## First-year integration deployed to repository — 2026-10-21
- Added `data/course1-schedule.json`: 100 normalized records across Ю600/О-2601–Ю600/О-2604.
- Added `data/course1-adapter.js`: date-aware resolver for group, weekday, explicit dates, week parity, date limits, and exclusions. The source anomaly `19.12*` remains inactive.
- Updated `index.html` to register all four first-year groups, allow course 1 selection, load the data/adapter, and route first-year date rendering through the adapter.
- Corrected the displayed parity label so 12–18 Oct 2026 is shown as the odd week, consistent with the required week Б anchor.
- Preserved second-year definitions and current visual layout. Inline JavaScript syntax and smoke checks for all four groups on dates 12–14 Oct, 17 Oct, 19 Oct, 24 Oct and 19 Dec passed in the integration environment.
- GitHub Pages deployment for the latest commit must finish successfully and the live page must be checked before declaring the site fully verified.
