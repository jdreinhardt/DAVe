import { describe, it, expect } from 'vitest';
import { serializeVCard } from '../lib/vcard.js';
import type { ContactJson } from '@dave/shared';

function base(): ContactJson {
  return {
    uid: 'test-uid-1',
    version: '4.0',
    name: { prefix: '', given: 'Alice', middle: '', family: 'Smith', suffix: '' },
    fullName: 'Alice Smith',
    nickname: '',
    organization: '',
    title: '',
    phones: [],
    emails: [],
    addresses: [],
    urls: [],
    birthday: null,
    anniversary: null,
    note: '',
    photo: null,
    customFields: [],
  };
}

describe('serializeVCard – structure', () => {
  it('produces BEGIN:VCARD and END:VCARD', () => {
    const out = serializeVCard(base());
    expect(out).toContain('BEGIN:VCARD');
    expect(out).toContain('END:VCARD');
  });

  it('ends with CRLF', () => {
    expect(serializeVCard(base())).toMatch(/\r\n$/);
  });

  it('includes VERSION', () => {
    expect(serializeVCard(base())).toContain('VERSION:4.0');
  });

  it('falls back to uid for FN when fullName and name are empty', () => {
    const c = base();
    c.fullName = '';
    c.name = { prefix: '', given: '', middle: '', family: '', suffix: '' };
    expect(serializeVCard(c)).toContain('FN:test-uid-1');
  });
});

describe('serializeVCard – line folding', () => {
  it('folds lines longer than 75 characters', () => {
    const c = base();
    c.note = 'A'.repeat(200);
    const out = serializeVCard(c);
    const noteLines = out.split('\r\n').filter((l) => l.startsWith('NOTE') || l.startsWith(' A'));
    // All lines (including continuations) should be <= 75 chars
    for (const line of noteLines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});

describe('serializeVCard – phones', () => {
  it('serializes preferred phone with PREF type', () => {
    const c = base();
    c.phones = [{ value: '+15551234567', types: ['WORK'], preferred: true }];
    const out = serializeVCard(c);
    expect(out).toContain('TEL;TYPE=WORK,PREF:+15551234567');
  });

  it('serializes non-preferred phone without PREF', () => {
    const c = base();
    c.phones = [{ value: '+15559876543', types: ['HOME'], preferred: false }];
    const out = serializeVCard(c);
    expect(out).toContain('TEL;TYPE=HOME:+15559876543');
    expect(out).not.toContain('PREF');
  });
});

describe('serializeVCard – addresses', () => {
  it('maps address fields to correct ADR semicolon positions', () => {
    const c = base();
    c.addresses = [{
      types: ['HOME'],
      street: '123 Main St',
      city: 'Springfield',
      region: 'IL',
      postalCode: '62701',
      country: 'USA',
      preferred: false,
    }];
    const out = serializeVCard(c);
    // ADR: POBox;ExtAddr;Street;City;Region;PostalCode;Country
    expect(out).toContain('ADR;TYPE=HOME:;;123 Main St;Springfield;IL;62701;USA');
  });
});

describe('serializeVCard – dates', () => {
  it('serializes YYYY-MM-DD birthday as YYYYMMDD', () => {
    const c = base();
    c.birthday = '1985-03-15';
    expect(serializeVCard(c)).toContain('BDAY:19850315');
  });

  it('serializes --MMDD (no-year) birthday as --MMDD', () => {
    const c = base();
    c.birthday = '--0315';
    expect(serializeVCard(c)).toContain('BDAY:--0315');
  });

  it('serializes anniversary', () => {
    const c = base();
    c.anniversary = '2010-06-01';
    expect(serializeVCard(c)).toContain('ANNIVERSARY:20100601');
  });
});

describe('serializeVCard – photo', () => {
  it('serializes vCard 3.0 photo as ENCODING=b', () => {
    const c = base();
    c.version = '3.0';
    c.photo = 'data:image/jpeg;base64,AAAABBBB';
    const out = serializeVCard(c);
    expect(out).toContain('PHOTO;ENCODING=b;TYPE=JPEG:AAAABBBB');
  });

  it('serializes vCard 4.0 photo as data URI', () => {
    const c = base();
    c.version = '4.0';
    c.photo = 'data:image/jpeg;base64,AAAABBBB';
    const out = serializeVCard(c);
    expect(out).toContain('PHOTO:data:image/jpeg;base64,AAAABBBB');
  });

  it('serializes an external URL photo as a plain URL', () => {
    const c = base();
    c.photo = 'https://example.com/photo.jpg';
    expect(serializeVCard(c)).toContain('PHOTO:https://example.com/photo.jpg');
  });
});

describe('serializeVCard – custom fields', () => {
  it('round-trips custom field with parameters', () => {
    const c = base();
    c.customFields = [{ property: 'X-SIGNAL', value: '+15559999', parameters: { TYPE: 'cell' } }];
    const out = serializeVCard(c);
    expect(out).toContain('X-SIGNAL;TYPE=cell:+15559999');
  });
});
