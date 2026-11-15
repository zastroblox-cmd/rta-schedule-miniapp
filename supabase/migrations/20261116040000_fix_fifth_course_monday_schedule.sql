-- Correct two fifth-course Monday rows against the official 05.10.2026 schedule PDF.
-- The migration is idempotent so it can be applied after the live hotfix without duplicate logs/rows.

do $$
declare
  target_row public.schedule_entries%rowtype;
  before_json jsonb;
  after_json jsonb;
  group_2207 bigint;
  inserted_row public.schedule_entries%rowtype;
begin
  -- Tс02/О-2206 has no Monday 08:30–10:00 lesson in the source PDF.
  for target_row in
    select e.*
    from public.schedule_entries e
    join public.student_groups g on g.id = e.group_id
    join public.courses c on c.id = g.course_id
    where g.group_code = 'Тс02/О-2206'
      and c.direction = 'customs'
      and c.course_number = 5
      and e.entry_kind = 'recurring'
      and e.weekday = 1
      and e.starts_at = '08:30:00'
      and e.ends_at = '10:00:00'
      and e.subject = 'Применение технических средств таможенного контроля при проведении таможенного контроля'
      and e.source_label = 'TD_5_k_2j_potok_s_05.10.pdf'
  loop
    insert into public.schedule_change_log(schedule_entry_id, group_id, action, before_data, after_data, reason)
    values (target_row.id, target_row.group_id, 'delete', to_jsonb(target_row), null,
      'Аудит по официальному PDF TD_5_k_2j_potok_s_05.10.pdf: для Тс02/О-2206 по понедельникам 08:30–10:00 занятия нет; удалена ошибочная общая запись.');
    delete from public.schedule_entries where id = target_row.id;
  end loop;

  -- Tс02/О-2207 has this subject only on 05.10, 19.10 and 02.11.
  select to_jsonb(e) into before_json
  from public.schedule_entries e
  join public.student_groups g on g.id = e.group_id
  join public.courses c on c.id = g.course_id
  where g.group_code = 'Тс02/О-2207'
    and c.direction = 'customs'
    and c.course_number = 5
    and e.entry_kind = 'recurring'
    and e.weekday = 1
    and e.starts_at = '08:30:00'
    and e.ends_at = '10:00:00'
    and e.subject = 'Применение технических средств таможенного контроля при проведении таможенного контроля'
    and e.source_label = 'TD_5_k_2j_potok_s_05.10.pdf'
    and (e.valid_to is distinct from date '2026-11-02'
      or not (e.excluded_dates @> array[date '2026-10-12', date '2026-10-26']::date[])
      or coalesce(e.notes, '') not like '%Сверено с официальным PDF 16.11.2026%')
  limit 1;

  if before_json is not null then
    update public.schedule_entries e
      set valid_to = '2026-11-02',
          excluded_dates = array[date '2026-10-12', date '2026-10-26']::date[],
          notes = concat_ws(' | ', nullif(e.notes, ''),
            'Сверено с официальным PDF 16.11.2026: технические средства только 05.10, 19.10 и 02.11; 16.11 — отдельное занятие по инспекционно-досмотровым комплексам.')
      from public.student_groups g, public.courses c
      where e.group_id = g.id and g.course_id = c.id
        and g.group_code = 'Тс02/О-2207'
        and c.direction = 'customs' and c.course_number = 5
        and e.entry_kind = 'recurring' and e.weekday = 1
        and e.starts_at = '08:30:00' and e.ends_at = '10:00:00'
        and e.subject = 'Применение технических средств таможенного контроля при проведении таможенного контроля'
        and e.source_label = 'TD_5_k_2j_potok_s_05.10.pdf'
      returning to_jsonb(e) into after_json;

    insert into public.schedule_change_log(schedule_entry_id, group_id, action, before_data, after_data, reason)
    select (before_json->>'id')::bigint, (before_json->>'group_id')::bigint, 'update', before_json, after_json,
      'Аудит по официальному PDF TD_5_k_2j_potok_s_05.10.pdf: ограничены даты повторяющейся записи и исключены 12.10 и 26.10.'
    where after_json is not null;
  end if;

  -- Restore the distinct one-off lesson on 16.11 for Tс02/О-2207.
  select g.id into group_2207
  from public.student_groups g
  join public.courses c on c.id = g.course_id
  where g.group_code = 'Тс02/О-2207' and c.direction = 'customs' and c.course_number = 5
  limit 1;

  if group_2207 is not null and not exists (
    select 1 from public.schedule_entries e
    where e.group_id = group_2207 and e.entry_kind = 'date_override'
      and e.schedule_date = '2026-11-16'
      and e.starts_at = '08:30:00' and e.ends_at = '10:00:00'
      and e.subject = 'Применение инспекционно-досмотровых комплексов'
  ) then
    insert into public.schedule_entries(
      group_id, entry_kind, weekday, week_type, schedule_date, starts_at, ends_at,
      subject, teacher, room, lesson_type, notes, source_label, valid_from, valid_to, excluded_dates
    ) values (
      group_2207, 'date_override', null, null, '2026-11-16', '08:30:00', '10:00:00',
      'Применение инспекционно-досмотровых комплексов', 'доц. В.А. Кузьминов',
      'уточняется накануне', 'П/з. д/в.',
      'Разовое занятие 16.11.2026 по официальному PDF; аудитория отмечена звёздочкой и согласуется накануне.',
      'TD_5_k_2j_potok_s_05.10.pdf', null, null, '{}'::date[]
    ) returning * into inserted_row;

    insert into public.schedule_change_log(schedule_entry_id, group_id, action, before_data, after_data, reason)
    values (inserted_row.id, group_2207, 'insert', null, to_jsonb(inserted_row),
      'Восстановлена отдельная дата 16.11.2026 по официальному PDF: Применение инспекционно-досмотровых комплексов, Тс02/О-2207.');
  end if;
end $$;
