import { describe, it, expect } from 'vitest';
import { parseVCard, serializeVCard } from '../lib/vcard.js';
import type { ContactJson } from '@dave/shared';

function roundtrip(c: ContactJson): ContactJson {
  return parseVCard(serializeVCard(c));
}

describe('vCard round-trip identity', () => {
  it('minimal contact (uid, name, fullName only)', () => {
    const original: ContactJson = {
      uid: 'rt-minimal',
      version: '4.0',
      name: { prefix: '', given: 'Rita', middle: '', family: 'Morales', suffix: '' },
      fullName: 'Rita Morales',
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
    const rt = roundtrip(original);
    expect(rt.uid).toBe(original.uid);
    expect(rt.fullName).toBe(original.fullName);
    expect(rt.name.given).toBe(original.name.given);
    expect(rt.name.family).toBe(original.name.family);
  });

  it('contact with all scalar fields', () => {
    const original: ContactJson = {
      uid: 'rt-full',
      version: '4.0',
      name: { prefix: 'Dr.', given: 'Sam', middle: 'J.', family: 'Lee', suffix: 'Jr.' },
      fullName: 'Dr. Sam J. Lee Jr.',
      nickname: 'Sammy',
      organization: 'Acme Inc',
      title: 'CEO',
      phones: [{ value: '+15551234567', types: ['WORK'], preferred: true }],
      emails: [{ value: 'sam@acme.com', types: ['WORK'], preferred: false }],
      addresses: [{
        types: ['HOME'],
        street: '10 Elm St',
        city: 'Portland',
        region: 'OR',
        postalCode: '97201',
        country: 'USA',
        preferred: false,
      }],
      urls: ['https://sam.example.com'],
      birthday: '1980-04-01',
      anniversary: '2005-09-15',
      note: 'Works late\nPrefers email',
      photo: null,
      customFields: [],
    };
    const rt = roundtrip(original);

    expect(rt.uid).toBe(original.uid);
    expect(rt.nickname).toBe(original.nickname);
    expect(rt.organization).toBe(original.organization);
    expect(rt.title).toBe(original.title);
    expect(rt.birthday).toBe(original.birthday);
    expect(rt.anniversary).toBe(original.anniversary);
    expect(rt.note).toBe(original.note);
    expect(rt.phones[0]?.value).toBe(original.phones[0]?.value);
    expect(rt.phones[0]?.preferred).toBe(true);
    expect(rt.emails[0]?.value).toBe(original.emails[0]?.value);
    expect(rt.addresses[0]?.street).toBe('10 Elm St');
    expect(rt.addresses[0]?.city).toBe('Portland');
    expect(rt.urls[0]).toBe('https://sam.example.com');
  });

  it('contact with vCard 3.0 photo', () => {
    const original: ContactJson = {
      uid: 'rt-photo-v3',
      version: '3.0',
      name: { prefix: '', given: 'Tia', middle: '', family: 'Cruz', suffix: '' },
      fullName: 'Tia Cruz',
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
      photo: 'data:image/jpeg;base64,/9j/AAAABBBBCCCC',
      customFields: [],
    };
    const rt = roundtrip(original);
    expect(rt.photo).toBe(original.photo);
  });

  it('contact with custom fields', () => {
    const original: ContactJson = {
      uid: 'rt-custom',
      version: '4.0',
      name: { prefix: '', given: 'Uma', middle: '', family: 'Watts', suffix: '' },
      fullName: 'Uma Watts',
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
      customFields: [
        { property: 'X-SIGNAL', value: '+15559999', parameters: {} },
        { property: 'X-MASTODON', value: '@uma@mastodon.social', parameters: { TYPE: 'url' } },
      ],
    };
    const rt = roundtrip(original);
    const signal = rt.customFields.find((f) => f.property === 'X-SIGNAL');
    const mastodon = rt.customFields.find((f) => f.property === 'X-MASTODON');
    expect(signal?.value).toBe('+15559999');
    expect(mastodon?.value).toBe('@uma@mastodon.social');
    expect(mastodon?.parameters['TYPE']).toBe('url');
  });

  it('no-year birthday does not shift', () => {
    const original: ContactJson = {
      uid: 'rt-bday-noyear',
      version: '4.0',
      name: { prefix: '', given: 'Vera', middle: '', family: 'King', suffix: '' },
      fullName: 'Vera King',
      nickname: '', organization: '', title: '',
      phones: [], emails: [], addresses: [], urls: [],
      birthday: '--0315',
      anniversary: null,
      note: '', photo: null, customFields: [],
    };
    expect(roundtrip(original).birthday).toBe('--0315');
  });
});
