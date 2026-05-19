import { describe, it, expect } from 'vitest';
import { parseVCard } from '../lib/vcard.js';

describe('parseVCard – basics', () => {
  it('returns empty contact for empty string', () => {
    const c = parseVCard('');
    expect(c.uid).toBe('');
    expect(c.phones).toEqual([]);
    expect(c.emails).toEqual([]);
  });

  it('does not throw on malformed vCard (no BEGIN)', () => {
    expect(() => parseVCard('NOT A VCARD')).not.toThrow();
  });

  it('parses a minimal vCard 4.0', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Alice Smith',
      'N:Smith;Alice;;;',
      'UID:uid-minimal',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.uid).toBe('uid-minimal');
    expect(c.version).toBe('4.0');
    expect(c.fullName).toBe('Alice Smith');
    expect(c.name.family).toBe('Smith');
    expect(c.name.given).toBe('Alice');
  });

  it('unfolds continuation lines', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Alice',
      'NOTE:This is a very lo',
      ' ng note that wraps',
      'UID:uid-fold',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.note).toBe('This is a very long note that wraps');
  });
});

describe('parseVCard – phones', () => {
  it('parses multiple TEL with types and pref', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Bob',
      'UID:uid-tel',
      'TEL;TYPE=work,pref:+15551111111',
      'TEL;TYPE=home:+15552222222',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.phones).toHaveLength(2);
    expect(c.phones[0]!.preferred).toBe(true);
    expect(c.phones[0]!.types).toContain('WORK');
    expect(c.phones[0]!.types).not.toContain('PREF');
    expect(c.phones[1]!.preferred).toBe(false);
    expect(c.phones[1]!.types).toContain('HOME');
  });

  it('strips tel: URI prefix from vCard 4.0 TEL values', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Carol',
      'UID:uid-tel-uri',
      'TEL;TYPE=cell:tel:+15553333333',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.phones[0]!.value).toBe('+15553333333');
  });

  it('handles vCard 3.0 bare type values (TEL;HOME;WORK:...)', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Dave',
      'UID:uid-bare-type',
      'TEL;HOME;WORK:+15554444444',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.phones[0]!.types).toContain('HOME');
    expect(c.phones[0]!.types).toContain('WORK');
  });
});

describe('parseVCard – emails', () => {
  it('parses multiple EMAIL with preferred', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Eve',
      'UID:uid-email',
      'EMAIL;TYPE=work;PREF=1:eve@work.com',
      'EMAIL;TYPE=home:eve@home.com',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.emails).toHaveLength(2);
    expect(c.emails[0]!.preferred).toBe(true);
    expect(c.emails[0]!.value).toBe('eve@work.com');
    expect(c.emails[1]!.preferred).toBe(false);
  });
});

describe('parseVCard – addresses', () => {
  it('maps ADR fields to the correct positions', () => {
    // ADR: POBox;ExtAddr;Street;City;Region;PostalCode;Country
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Frank',
      'UID:uid-adr',
      'ADR;TYPE=home:;;123 Main St;Springfield;IL;62701;USA',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.addresses).toHaveLength(1);
    const addr = c.addresses[0]!;
    expect(addr.street).toBe('123 Main St');
    expect(addr.city).toBe('Springfield');
    expect(addr.region).toBe('IL');
    expect(addr.postalCode).toBe('62701');
    expect(addr.country).toBe('USA');
    expect(addr.types).toContain('HOME');
  });
});

describe('parseVCard – org / title', () => {
  it('takes only the first ORG unit', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Grace',
      'UID:uid-org',
      'ORG:Acme Corp;Engineering',
      'TITLE:Staff Engineer',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.organization).toBe('Acme Corp');
    expect(c.title).toBe('Staff Engineer');
  });
});

describe('parseVCard – dates', () => {
  it('normalises YYYYMMDD birthday to YYYY-MM-DD', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Henry',
      'UID:uid-bday',
      'BDAY:19850315',
      'END:VCARD',
    ].join('\r\n');

    expect(parseVCard(raw).birthday).toBe('1985-03-15');
  });

  it('keeps --MMDD (no-year) birthday as-is', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Iris',
      'UID:uid-bday-noyear',
      'BDAY:--0315',
      'END:VCARD',
    ].join('\r\n');

    expect(parseVCard(raw).birthday).toBe('--0315');
  });

  it('parses ANNIVERSARY', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Jack',
      'UID:uid-ann',
      'ANNIVERSARY:20100601',
      'END:VCARD',
    ].join('\r\n');

    expect(parseVCard(raw).anniversary).toBe('2010-06-01');
  });
});

describe('parseVCard – note unescaping', () => {
  it('unescapes \\n and \\, in NOTE', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Kim',
      'UID:uid-note',
      'NOTE:Line 1\\nLine 2\\,still line 2',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.note).toBe('Line 1\nLine 2,still line 2');
  });
});

describe('parseVCard – photo', () => {
  it('parses vCard 3.0 ENCODING=b photo as data URI', () => {
    const b64 = 'AAAABBBB';
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Leo',
      'UID:uid-photo-v3',
      `PHOTO;ENCODING=b;TYPE=JPEG:${b64}`,
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.photo).toBe(`data:image/jpeg;base64,${b64}`);
  });

  it('parses vCard 4.0 data URI photo as-is', () => {
    const photo = 'data:image/png;base64,AAAABBBB';
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Mia',
      'UID:uid-photo-v4',
      `PHOTO:${photo}`,
      'END:VCARD',
    ].join('\r\n');

    expect(parseVCard(raw).photo).toBe(photo);
  });

  it('preserves external URL photo as-is', () => {
    const url = 'https://example.com/photo.jpg';
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Nick',
      'UID:uid-photo-url',
      `PHOTO:${url}`,
      'END:VCARD',
    ].join('\r\n');

    expect(parseVCard(raw).photo).toBe(url);
  });
});

describe('parseVCard – custom fields', () => {
  it('collects X-prefixed properties into customFields', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Olivia',
      'UID:uid-custom',
      'X-SIGNAL:+15559999999',
      'X-MASTODON:@olivia@mastodon.social',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    const signal = c.customFields.find((f) => f.property === 'X-SIGNAL');
    const mastodon = c.customFields.find((f) => f.property === 'X-MASTODON');
    expect(signal?.value).toBe('+15559999999');
    expect(mastodon?.value).toBe('@olivia@mastodon.social');
  });
});

describe('parseVCard – grouped properties', () => {
  it('strips group prefix and parses the property', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Pat',
      'UID:uid-group',
      'item1.EMAIL;TYPE=WORK:pat@work.com',
      'END:VCARD',
    ].join('\r\n');

    const c = parseVCard(raw);
    expect(c.emails[0]!.value).toBe('pat@work.com');
    expect(c.emails[0]!.types).toContain('WORK');
  });
});
