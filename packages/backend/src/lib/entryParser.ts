import { createRequire } from 'node:module';

const _req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICAL = _req('ical.js') as any;

export interface ParsedRelation {
  relatedUid: string;
  reltype: string;
}

export interface ParsedEntry {
  userId: string;
  collectionUrl: string;
  objectUrl: string;
  componentType: 'VTODO' | 'VJOURNAL';
  uid: string;
  etag: string;
  summary: string;
  description: string;
  status: string | null;
  priority: number | null;
  dtstart: number | null;      // Unix ms
  due: number | null;          // Unix ms; VTODO only
  completed: number | null;    // Unix ms
  percentComplete: number | null;
  lastModified: number | null; // Unix ms; from LAST-MODIFIED
  dtstart_present: boolean;
  rawIcs: string;
  categories: string[];
  relations: ParsedRelation[];
  lastSyncedAt: number;        // Unix ms
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function icalDateToMs(prop: any): number | null {
  if (!prop) return null;
  try {
    const val = prop.getFirstValue?.();
    if (!val) return null;
    if (typeof val.toUnixTime === 'function') {
      return (val.toUnixTime() as number) * 1000;
    }
  } catch {
    // ignore
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCategories(comp: any): string[] {
  const cats: string[] = [];
  const catProps = comp.getAllProperties('categories') as unknown[];
  for (const prop of catProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prop as any;
    const vals = p.getValues?.();
    if (Array.isArray(vals)) {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) cats.push(v.trim());
      }
    } else if (typeof vals === 'string' && vals.trim()) {
      // Baikal sometimes returns a single comma-joined string.
      cats.push(...vals.split(',').map((s: string) => s.trim()).filter(Boolean));
    }
  }
  return [...new Set(cats)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRelations(comp: any): ParsedRelation[] {
  const relations: ParsedRelation[] = [];
  const relProps = comp.getAllProperties('related-to') as unknown[];
  for (const prop of relProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prop as any;
    const relatedUid = p.getFirstValue?.();
    if (typeof relatedUid !== 'string' || !relatedUid.trim()) continue;
    const reltype = String(p.getParameter?.('reltype') ?? 'UNKNOWN').toUpperCase();
    relations.push({ relatedUid: relatedUid.trim(), reltype });
  }
  return relations;
}

function coerceInt(v: unknown): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Parse a raw ICS string into a normalized cache entry.
 * Returns null for VEVENT or unrecognized components so callers can skip them.
 */
export function parseEntry(
  rawIcs: string,
  objectUrl: string,
  collectionUrl: string,
  userId: string,
  etag: string,
): ParsedEntry | null {
  if (!rawIcs?.trim()) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try {
    jcal = ICAL.parse(rawIcs);
  } catch {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vcal = new ICAL.Component(jcal) as any;
  const vtodo = vcal.getFirstSubcomponent('vtodo');
  const vjournal = vcal.getFirstSubcomponent('vjournal');
  const comp = vtodo ?? vjournal;
  if (!comp) return null;

  const componentType: 'VTODO' | 'VJOURNAL' = vtodo ? 'VTODO' : 'VJOURNAL';

  const uid = comp.getFirstPropertyValue('uid') ?? '';
  if (!uid) return null;

  const summary = comp.getFirstPropertyValue('summary') ?? '';
  const description = comp.getFirstPropertyValue('description') ?? '';

  const dtstart = icalDateToMs(comp.getFirstProperty('dtstart'));

  return {
    userId,
    collectionUrl,
    objectUrl,
    componentType,
    uid: typeof uid === 'string' ? uid : String(uid),
    etag,
    summary: typeof summary === 'string' ? summary : String(summary),
    description: typeof description === 'string' ? description : String(description),
    status: (() => {
      const s = comp.getFirstPropertyValue('status');
      return typeof s === 'string' ? s.toUpperCase() : null;
    })(),
    priority: coerceInt(comp.getFirstPropertyValue('priority')),
    dtstart,
    due: componentType === 'VTODO' ? icalDateToMs(comp.getFirstProperty('due')) : null,
    completed: icalDateToMs(comp.getFirstProperty('completed')),
    percentComplete: coerceInt(comp.getFirstPropertyValue('percent-complete')),
    lastModified: icalDateToMs(comp.getFirstProperty('last-modified')),
    dtstart_present: dtstart !== null,
    rawIcs,
    categories: extractCategories(comp),
    relations: extractRelations(comp),
    lastSyncedAt: Date.now(),
  };
}
