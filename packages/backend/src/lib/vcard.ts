import type {
  ContactJson,
  VCardAddress,
  VCardCustomField,
  VCardEmail,
  VCardName,
  VCardPhone,
} from '@dave/shared';

// re-export for callers that import from this module
export type { ContactJson };

// Standard properties we handle explicitly; everything else → customFields.
const STANDARD_PROPS = new Set([
  'BEGIN', 'END', 'VERSION', 'FN', 'N', 'NICKNAME', 'PHOTO', 'BDAY',
  'ANNIVERSARY', 'GENDER', 'ADR', 'TEL', 'EMAIL', 'IMPP', 'LANG', 'TZ',
  'GEO', 'TITLE', 'ROLE', 'LOGO', 'ORG', 'MEMBER', 'RELATED', 'CATEGORIES',
  'NOTE', 'PRODID', 'REV', 'SOUND', 'UID', 'CLIENTPIDMAP', 'URL', 'KEY',
  'FBURL', 'CALADRURI', 'CALURI', 'SOURCE', 'KIND', 'XML', 'BIRTHPLACE',
  'DEATHPLACE', 'DEATHDATE', 'EXPERTISE', 'HOBBY', 'INTEREST', 'CONTACTURI',
  'ORGDIRECTORY', 'LABEL',
]);

type Params = Record<string, string | string[]>;
type PropEntry = { group: string; property: string; parameters: Params; value: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getParam(params: Params, key: string): string | string[] | undefined {
  return params[key] ?? params[key.toUpperCase()] ?? params[key.toLowerCase()];
}

// Normalize TYPE parameter to an uppercase string array.
function getTypes(params: Params): string[] {
  const raw = getParam(params, 'TYPE');
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.flatMap((t) => t.split(',')).map((t) => t.toUpperCase().trim()).filter(Boolean);
}

// PREF=1 (vCard 4.0) or TYPE=PREF (vCard 3.0).
function isPref(params: Params, types: string[]): boolean {
  const pref = getParam(params, 'PREF');
  if (pref === '1') return true;
  return types.includes('PREF');
}

// Split a structured vCard value on unescaped semicolons, unescaping as we go.
function splitStructured(value: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const nx = value[++i];
      if (nx === ';') cur += ';';
      else if (nx === ',') cur += ',';
      else if (nx === 'n' || nx === 'N') cur += '\n';
      else if (nx === '\\') cur += '\\';
      else cur += `\\${nx}`;
    } else if (value[i] === ';') {
      parts.push(cur);
      cur = '';
    } else {
      cur += value[i];
    }
  }
  parts.push(cur);
  return parts;
}

function unescapeValue(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\;/g, ';')
    .replace(/\\,/g, ',')
    .replace(/\\\\/g, '\\');
}

// ── Field parsers ─────────────────────────────────────────────────────────────

function parseName(value: string): VCardName {
  const p = splitStructured(value);
  return {
    family: p[0] ?? '',
    given:  p[1] ?? '',
    middle: p[2] ?? '',
    prefix: p[3] ?? '',
    suffix: p[4] ?? '',
  };
}

function parseAddress(value: string, params: Params): VCardAddress {
  const p = splitStructured(value);
  const types = getTypes(params);
  return {
    types: types.filter((t) => t !== 'PREF'),
    // ADR: POBox;ExtAddr;Street;City;Region;PostalCode;Country
    street:     p[2] ?? '',
    city:       p[3] ?? '',
    region:     p[4] ?? '',
    postalCode: p[5] ?? '',
    country:    p[6] ?? '',
    preferred: isPref(params, types),
  };
}

function parsePhoto(value: string, params: Params): string | null {
  if (!value) return null;
  // vCard 4.0 data URI or external URL
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  // vCard 3.0: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  const enc = getParam(params, 'ENCODING');
  if (enc && String(enc).toUpperCase() !== 'NONE') {
    const type = String(getParam(params, 'TYPE') ?? 'JPEG').toLowerCase();
    const mimeMap: Record<string, string> = {
      jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp',
    };
    const mime = mimeMap[type] ?? 'image/jpeg';
    return `data:${mime};base64,${value.replace(/\s/g, '')}`;
  }
  // Heuristic: long string without spaces → raw base64
  if (value.length > 100 && !/\s/.test(value.slice(0, 50))) {
    return `data:image/jpeg;base64,${value}`;
  }
  return value;
}

function normalizeDateStr(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  // --MMDD (no year) → keep as-is; callers can handle it
  return v;
}

// ── Main export ───────────────────────────────────────────────────────────────

function emptyContact(): ContactJson {
  return {
    uid: '', version: '4.0',
    name: { prefix: '', given: '', middle: '', family: '', suffix: '' },
    fullName: '', nickname: '', organization: '', title: '',
    phones: [], emails: [], addresses: [], urls: [],
    birthday: null, anniversary: null, note: '', photo: null, customFields: [],
  };
}

// ── Tokenizer (vCard 3.0 + 4.0) ──────────────────────────────────────────────

function tokenize(raw: string): { parsedVcard: PropEntry[]; getProperty(p: string): PropEntry[] } {
  // Unfold continuation lines (RFC 6350 §3.2)
  const unfolded = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);
  const entries: PropEntry[] = [];

  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;

    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);

    // head is GROUP.PROPERTY;PARAM=VAL;...
    const parts = head.split(';');
    let namePart = parts[0]!;

    let group = '';
    const dot = namePart.indexOf('.');
    if (dot >= 0) { group = namePart.slice(0, dot); namePart = namePart.slice(dot + 1); }

    const property = namePart.toUpperCase();
    if (!property || property === 'BEGIN' || property === 'END') continue;

    const parameters: Params = {};
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]!;
      const eq = p.indexOf('=');
      if (eq >= 0) {
        const k = p.slice(0, eq).toUpperCase();
        const v = p.slice(eq + 1);
        const cur = parameters[k];
        parameters[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
      } else if (p) {
        // vCard 3.0 bare type value (e.g. INTERNET, HOME, PREF)
        const cur = parameters['TYPE'];
        parameters['TYPE'] = cur === undefined ? p.toUpperCase()
          : Array.isArray(cur) ? [...cur, p.toUpperCase()] : [cur, p.toUpperCase()];
      }
    }

    entries.push({ group, property, parameters, value });
  }

  return {
    parsedVcard: entries,
    getProperty(prop: string) { return entries.filter((e) => e.property === prop.toUpperCase()); },
  };
}

export function parseVCard(raw: string): ContactJson {
  let parsed: ReturnType<typeof tokenize>;
  try {
    parsed = tokenize(raw);
  } catch {
    return emptyContact();
  }
  if (!parsed.parsedVcard.length) return emptyContact();

  const get = (prop: string): PropEntry[] => parsed.getProperty(prop);

  const uid      = get('UID')[0]?.value ?? '';
  const version  = (get('VERSION')[0]?.value ?? '4.0') as '3.0' | '4.0';
  const fullName = unescapeValue(get('FN')[0]?.value ?? '');
  const name     = get('N')[0] ? parseName(get('N')[0]!.value) : emptyContact().name;
  const nickname = unescapeValue(get('NICKNAME')[0]?.value ?? '');

  const orgProp    = get('ORG')[0];
  const organization = orgProp ? unescapeValue(splitStructured(orgProp.value)[0] ?? '') : '';
  const title      = unescapeValue(get('TITLE')[0]?.value ?? '');

  const phones: VCardPhone[] = get('TEL').map((p) => {
    const types = getTypes(p.parameters);
    // vCard 4.0 TEL values may be tel: URIs
    const value = p.value.replace(/^tel:/i, '');
    return { value, types: types.filter((t) => t !== 'PREF'), preferred: isPref(p.parameters, types) };
  });

  const emails: VCardEmail[] = get('EMAIL').map((p) => {
    const types = getTypes(p.parameters);
    return { value: p.value, types: types.filter((t) => t !== 'PREF'), preferred: isPref(p.parameters, types) };
  });

  const addresses: VCardAddress[] = get('ADR').map((p) => parseAddress(p.value, p.parameters));

  const urls: string[] = get('URL').map((p) => p.value);

  const bdayProp  = get('BDAY')[0];
  const birthday  = bdayProp ? normalizeDateStr(bdayProp.value) : null;

  const annProp      = get('ANNIVERSARY')[0];
  const anniversary  = annProp ? normalizeDateStr(annProp.value) : null;

  const note  = unescapeValue(get('NOTE')[0]?.value ?? '');

  const photoProp = get('PHOTO')[0];
  const photo     = photoProp ? parsePhoto(photoProp.value, photoProp.parameters) : null;

  // Custom fields: any property not in STANDARD_PROPS
  const customFields: VCardCustomField[] = (parsed.parsedVcard as PropEntry[])
    .filter((p) => !STANDARD_PROPS.has(p.property.toUpperCase()))
    .map((p) => ({
      property: p.property,
      value: p.value,
      parameters: Object.fromEntries(
        Object.entries(p.parameters).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
      ),
    }));

  return {
    uid, version, name, fullName, nickname, organization, title,
    phones, emails, addresses, urls, birthday, anniversary, note, photo, customFields,
  };
}

// ── Serializer ────────────────────────────────────────────────────────────────

// Fold a vCard line per RFC 6350: lines over 75 octets get wrapped with CRLF + space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// In structured fields (N, ADR) only backslash, newline, and semicolons need escaping.
function escapeStructured(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;');
}

// Serialize a date back to YYYYMMDD (or --MMDD for no-year).
function serializeDate(iso: string | null): string | null {
  if (!iso) return null;
  // --MMDD or --MM-DD (no-year)
  if (iso.startsWith('--')) return iso.replace(/-/g, (_, i) => (i === 0 ? '-' : ''));
  // YYYY-MM-DD → YYYYMMDD
  return iso.replace(/-/g, '');
}

export function serializeVCard(data: ContactJson): string {
  const lines: string[] = [
    'BEGIN:VCARD',
    `VERSION:${data.version || '3.0'}`,
  ];

  // UID and FN are required by RFC
  lines.push(foldLine(`UID:${data.uid}`));
  lines.push(foldLine(`FN:${escapeText(data.fullName || [data.name.given, data.name.family].filter(Boolean).join(' ') || data.uid)}`));

  // N: family;given;middle;prefix;suffix
  const n = data.name;
  lines.push(foldLine(`N:${escapeStructured(n.family)};${escapeStructured(n.given)};${escapeStructured(n.middle)};${escapeStructured(n.prefix)};${escapeStructured(n.suffix)}`));

  if (data.nickname) lines.push(foldLine(`NICKNAME:${escapeText(data.nickname)}`));
  if (data.organization) lines.push(foldLine(`ORG:${escapeText(data.organization)}`));
  if (data.title) lines.push(foldLine(`TITLE:${escapeText(data.title)}`));

  for (const phone of data.phones) {
    const types = phone.preferred ? [...phone.types, 'PREF'] : phone.types;
    const typePart = types.length ? `;TYPE=${types.join(',')}` : '';
    lines.push(foldLine(`TEL${typePart}:${phone.value}`));
  }

  for (const email of data.emails) {
    const types = email.preferred ? [...email.types, 'PREF'] : email.types;
    const typePart = types.length ? `;TYPE=${types.join(',')}` : '';
    lines.push(foldLine(`EMAIL${typePart}:${email.value}`));
  }

  for (const addr of data.addresses) {
    const types = addr.preferred ? [...addr.types, 'PREF'] : addr.types;
    const typePart = types.length ? `;TYPE=${types.join(',')}` : '';
    // ADR: POBox;ExtAddr;Street;City;Region;PostalCode;Country
    const val = [
      '',
      '',
      escapeStructured(addr.street),
      escapeStructured(addr.city),
      escapeStructured(addr.region),
      escapeStructured(addr.postalCode),
      escapeStructured(addr.country),
    ].join(';');
    lines.push(foldLine(`ADR${typePart}:${val}`));
  }

  for (const url of data.urls) {
    lines.push(foldLine(`URL:${url}`));
  }

  const bday = serializeDate(data.birthday);
  if (bday) lines.push(foldLine(`BDAY:${bday}`));

  const ann = serializeDate(data.anniversary);
  if (ann) lines.push(foldLine(`ANNIVERSARY:${ann}`));

  if (data.note) lines.push(foldLine(`NOTE:${escapeText(data.note)}`));

  if (data.photo) {
    if (data.photo.startsWith('data:')) {
      const m = data.photo.match(/^data:(image\/(\w+));base64,(.+)$/s);
      if (m) {
        const subtype = m[2]!.toUpperCase();
        const b64 = m[3]!.replace(/\s/g, '');
        // vCard 3.0 encoding
        if ((data.version ?? '3.0') === '3.0') {
          lines.push(foldLine(`PHOTO;ENCODING=b;TYPE=${subtype}:${b64}`));
        } else {
          lines.push(foldLine(`PHOTO:data:${m[1]!};base64,${b64}`));
        }
      }
    } else {
      lines.push(foldLine(`PHOTO:${data.photo}`));
    }
  }

  for (const cf of data.customFields) {
    const params = Object.entries(cf.parameters)
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    const paramPart = params ? `;${params}` : '';
    lines.push(foldLine(`${cf.property}${paramPart}:${cf.value}`));
  }

  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}
