import { describe, it, expect } from 'vitest';
import { parseEntry } from '../lib/entryParser.js';

const COL_URL = 'http://dav.test/dav.php/calendars/alice/tasks/';
const OBJ_URL = `${COL_URL}todo-1.ics`;
const USER_ID = 'alice';
const ETAG = '"abc123"';

const VTODO_FULL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:todo-1
SUMMARY:Buy groceries
DESCRIPTION:Milk\\, eggs\\, bread
STATUS:NEEDS-ACTION
PRIORITY:5
PERCENT-COMPLETE:25
DTSTART:20240115T090000Z
DUE:20240116T090000Z
CATEGORIES:shopping,errands
RELATED-TO;RELTYPE=PARENT:parent-uid-999
END:VTODO
END:VCALENDAR`;

const VTODO_MINIMAL = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-min
SUMMARY:Minimal task
END:VTODO
END:VCALENDAR`;

const VJOURNAL_WITH_DTSTART = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VJOURNAL
UID:journal-1
SUMMARY:Meeting notes
DESCRIPTION:Discussed roadmap
DTSTART:20240201T000000Z
CATEGORIES:work
END:VJOURNAL
END:VCALENDAR`;

const VJOURNAL_NO_DTSTART = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VJOURNAL
UID:note-1
SUMMARY:Random note
DESCRIPTION:Something I wanted to remember
END:VJOURNAL
END:VCALENDAR`;

const VEVENT = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Team standup
DTSTART:20240115T100000Z
DTEND:20240115T103000Z
END:VEVENT
END:VCALENDAR`;

describe('parseEntry — VTODO', () => {
  it('parses all standard fields', () => {
    const entry = parseEntry(VTODO_FULL, OBJ_URL, COL_URL, USER_ID, ETAG);
    expect(entry).not.toBeNull();
    expect(entry!.componentType).toBe('VTODO');
    expect(entry!.uid).toBe('todo-1');
    expect(entry!.summary).toBe('Buy groceries');
    expect(entry!.status).toBe('NEEDS-ACTION');
    expect(entry!.priority).toBe(5);
    expect(entry!.percentComplete).toBe(25);
    expect(entry!.userId).toBe(USER_ID);
    expect(entry!.collectionUrl).toBe(COL_URL);
    expect(entry!.objectUrl).toBe(OBJ_URL);
    expect(entry!.etag).toBe(ETAG);
  });

  it('parses DTSTART and DUE as Unix ms', () => {
    const entry = parseEntry(VTODO_FULL, OBJ_URL, COL_URL, USER_ID, ETAG)!;
    expect(entry.dtstart).toBeTypeOf('number');
    expect(entry.due).toBeTypeOf('number');
    expect(entry.dtstart_present).toBe(true);
    // 2024-01-15T09:00:00Z
    expect(entry.dtstart).toBe(new Date('2024-01-15T09:00:00Z').getTime());
    expect(entry.due).toBe(new Date('2024-01-16T09:00:00Z').getTime());
  });

  it('extracts categories', () => {
    const entry = parseEntry(VTODO_FULL, OBJ_URL, COL_URL, USER_ID, ETAG)!;
    expect(entry.categories).toContain('shopping');
    expect(entry.categories).toContain('errands');
  });

  it('extracts RELATED-TO relations', () => {
    const entry = parseEntry(VTODO_FULL, OBJ_URL, COL_URL, USER_ID, ETAG)!;
    expect(entry.relations).toHaveLength(1);
    const rel = entry.relations[0];
    expect(rel?.relatedUid).toBe('parent-uid-999');
    expect(rel?.reltype).toBe('PARENT');
  });

  it('handles a minimal VTODO with no optional fields', () => {
    const entry = parseEntry(VTODO_MINIMAL, OBJ_URL, COL_URL, USER_ID, ETAG);
    expect(entry).not.toBeNull();
    expect(entry!.uid).toBe('todo-min');
    expect(entry!.status).toBeNull();
    expect(entry!.priority).toBeNull();
    expect(entry!.dtstart).toBeNull();
    expect(entry!.due).toBeNull();
    expect(entry!.dtstart_present).toBe(false);
    expect(entry!.categories).toEqual([]);
    expect(entry!.relations).toEqual([]);
  });
});

describe('parseEntry — VJOURNAL', () => {
  it('parses a journal (has DTSTART) — dtstart_present = true', () => {
    const entry = parseEntry(VJOURNAL_WITH_DTSTART, OBJ_URL, COL_URL, USER_ID, ETAG);
    expect(entry).not.toBeNull();
    expect(entry!.componentType).toBe('VJOURNAL');
    expect(entry!.dtstart_present).toBe(true);
    expect(entry!.dtstart).toBe(new Date('2024-02-01T00:00:00Z').getTime());
    expect(entry!.due).toBeNull(); // VJOURNAL never has due
  });

  it('parses a note (no DTSTART) — dtstart_present = false', () => {
    const entry = parseEntry(VJOURNAL_NO_DTSTART, OBJ_URL, COL_URL, USER_ID, ETAG);
    expect(entry).not.toBeNull();
    expect(entry!.componentType).toBe('VJOURNAL');
    expect(entry!.dtstart_present).toBe(false);
    expect(entry!.dtstart).toBeNull();
  });
});

describe('parseEntry — skip cases', () => {
  it('returns null for VEVENT', () => {
    expect(parseEntry(VEVENT, OBJ_URL, COL_URL, USER_ID, ETAG)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseEntry('', OBJ_URL, COL_URL, USER_ID, ETAG)).toBeNull();
  });

  it('returns null for malformed ICS', () => {
    expect(parseEntry('not valid ics', OBJ_URL, COL_URL, USER_ID, ETAG)).toBeNull();
  });

  it('returns null for VCALENDAR with no VTODO or VJOURNAL', () => {
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR`;
    expect(parseEntry(ics, OBJ_URL, COL_URL, USER_ID, ETAG)).toBeNull();
  });
});
