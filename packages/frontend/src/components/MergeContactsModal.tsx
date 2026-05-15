import { useState, useMemo } from 'react';
import { GitMerge } from 'lucide-react';
import type { Contact, ContactJson } from '@dave/shared';
import { Avatar } from './ContactDetail';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScalarField = 'fullName' | 'nickname' | 'organization' | 'title' | 'note' | 'birthday' | 'anniversary' | 'photo';

const SCALAR_FIELDS: Array<{
  id: ScalarField;
  label: string;
  getValue: (d: ContactJson) => string | null;
}> = [
  { id: 'fullName',     label: 'Name',         getValue: (d) => d.fullName || null },
  { id: 'nickname',     label: 'Nickname',      getValue: (d) => d.nickname || null },
  { id: 'organization', label: 'Organization',  getValue: (d) => d.organization || null },
  { id: 'title',        label: 'Title',         getValue: (d) => d.title || null },
  { id: 'birthday',     label: 'Birthday',      getValue: (d) => d.birthday || null },
  { id: 'anniversary',  label: 'Anniversary',   getValue: (d) => d.anniversary || null },
  { id: 'note',         label: 'Note',          getValue: (d) => d.note || null },
  { id: 'photo',        label: 'Photo',         getValue: (d) => (d.photo ? '(has photo)' : null) },
];

// ── Merge logic ───────────────────────────────────────────────────────────────

// Exported so tests can cover it without rendering the modal.
export function mergeContactData(
  contacts: [ContactJson, ContactJson],
  primaryIdx: 0 | 1,
  choices: Partial<Record<ScalarField, 0 | 1>>,
): ContactJson {
  const primary = contacts[primaryIdx];
  const secondary = contacts[primaryIdx === 0 ? 1 : 0];

  // For fields without an explicit user choice: prefer whichever contact has a
  // non-empty value. If both have a value (a real conflict), the primary wins by
  // default; the user can override via the conflict-resolution UI.
  const fieldHasValue: Record<ScalarField, (d: ContactJson) => boolean> = {
    fullName:     (d) => !!d.fullName,
    nickname:     (d) => !!d.nickname,
    organization: (d) => !!d.organization,
    title:        (d) => !!d.title,
    note:         (d) => !!d.note,
    birthday:     (d) => !!d.birthday,
    anniversary:  (d) => !!d.anniversary,
    photo:        (d) => !!d.photo,
  };

  const pickFrom = (field: ScalarField): ContactJson => {
    if (choices[field] !== undefined) return contacts[choices[field]!];
    // No explicit choice: if the primary is empty but the secondary isn't, use the secondary.
    if (!fieldHasValue[field](primary) && fieldHasValue[field](secondary)) return secondary;
    return primary;
  };

  const mergePhones = () => {
    const all = [...primary.phones];
    for (const p of secondary.phones) {
      if (!all.some((x) => x.value === p.value)) all.push(p);
    }
    return all;
  };

  const mergeEmails = () => {
    const all = [...primary.emails];
    for (const e of secondary.emails) {
      if (!all.some((x) => x.value.toLowerCase() === e.value.toLowerCase())) all.push(e);
    }
    return all;
  };

  const mergeAddresses = () => {
    const key = (a: (typeof primary.addresses)[number]) =>
      `${a.street}|${a.city}|${a.postalCode}`.toLowerCase();
    const all = [...primary.addresses];
    for (const a of secondary.addresses) {
      if (!all.some((x) => key(x) === key(a))) all.push(a);
    }
    return all;
  };

  const mergeUrls = () => [...new Set([...primary.urls, ...secondary.urls])];

  const mergeCustomFields = () => {
    const all = [...primary.customFields];
    for (const cf of secondary.customFields) {
      if (!all.some((x) => x.property === cf.property && x.value === cf.value)) all.push(cf);
    }
    return all;
  };

  const nameContact = pickFrom('fullName');

  return {
    ...primary,
    fullName: nameContact.fullName,
    name: nameContact.name,
    nickname: pickFrom('nickname').nickname,
    organization: pickFrom('organization').organization,
    title: pickFrom('title').title,
    note: pickFrom('note').note,
    birthday: pickFrom('birthday').birthday,
    anniversary: pickFrom('anniversary').anniversary,
    photo: pickFrom('photo').photo,
    phones: mergePhones(),
    emails: mergeEmails(),
    addresses: mergeAddresses(),
    urls: mergeUrls(),
    customFields: mergeCustomFields(),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  contacts: [Contact, Contact];
  onConfirm: (mergedData: ContactJson, primary: Contact, secondary: Contact) => void;
  onCancel: () => void;
  merging: boolean;
}

export default function MergeContactsModal({ contacts, onConfirm, onCancel, merging }: Props) {
  const [primaryIdx, setPrimaryIdx] = useState<0 | 1>(0);
  const [choices, setChoices] = useState<Partial<Record<ScalarField, 0 | 1>>>({});

  const handleSetPrimary = (idx: 0 | 1) => {
    setPrimaryIdx(idx);
    setChoices({});
  };

  const conflicts = useMemo(
    () =>
      SCALAR_FIELDS.filter(({ getValue }) => {
        const v0 = getValue(contacts[0].data);
        const v1 = getValue(contacts[1].data);
        return v0 !== null && v1 !== null && v0 !== v1;
      }),
    [contacts],
  );

  const mergedCounts = useMemo(() => {
    const d0 = contacts[0].data;
    const d1 = contacts[1].data;
    const phones = new Set([...d0.phones.map((p) => p.value), ...d1.phones.map((p) => p.value)]).size;
    const emails = new Set([
      ...d0.emails.map((e) => e.value.toLowerCase()),
      ...d1.emails.map((e) => e.value.toLowerCase()),
    ]).size;
    const addrKey = (a: (typeof d0.addresses)[number]) =>
      `${a.street}|${a.city}|${a.postalCode}`.toLowerCase();
    const addresses =
      d0.addresses.length +
      d1.addresses.filter((a) => !d0.addresses.some((x) => addrKey(x) === addrKey(a))).length;
    const urls = new Set([...d0.urls, ...d1.urls]).size;
    return { phones, emails, addresses, urls };
  }, [contacts]);

  const displayName = (c: Contact) =>
    c.data.fullName ||
    [c.data.name.given, c.data.name.family].filter(Boolean).join(' ') ||
    '(No name)';

  const handleConfirm = () => {
    const merged = mergeContactData([contacts[0].data, contacts[1].data], primaryIdx, choices);
    onConfirm(merged, contacts[primaryIdx], contacts[primaryIdx === 0 ? 1 : 0]);
  };

  const hasMergedArrays =
    mergedCounts.phones > 0 ||
    mergedCounts.emails > 0 ||
    mergedCounts.addresses > 0 ||
    mergedCounts.urls > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Merge contacts
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose the primary record to keep, then resolve any conflicts.
            Phones, emails, and addresses are always combined.
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Primary contact selection */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Primary record</p>
            <div className="grid grid-cols-2 gap-3">
              {contacts.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSetPrimary(idx as 0 | 1)}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                    primaryIdx === idx
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/30 hover:bg-muted',
                  )}
                >
                  <Avatar contact={c} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{displayName(c)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.data.emails[0]?.value || c.data.phones[0]?.value || ' '}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'h-4 w-4 rounded-full border-2 shrink-0',
                      primaryIdx === idx ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              The other contact will be deleted after merging.
            </p>
          </div>

          {/* Conflict resolution */}
          {conflicts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Resolve conflicts ({conflicts.length})
              </p>
              <div className="space-y-2">
                {conflicts.map(({ id, label, getValue }) => {
                  const v0 = getValue(contacts[0].data)!;
                  const v1 = getValue(contacts[1].data)!;
                  const chosen = choices[id] ?? primaryIdx;

                  return (
                    <div key={id} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground mb-2">{label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([v0, v1] as const).map((val, vIdx) => (
                          <button
                            key={vIdx}
                            type="button"
                            onClick={() =>
                              setChoices((prev) => ({ ...prev, [id]: vIdx as 0 | 1 }))
                            }
                            className={cn(
                              'text-left rounded-md border px-3 py-2 text-sm transition-colors',
                              chosen === vIdx
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border hover:border-primary/30 hover:bg-muted text-muted-foreground',
                            )}
                          >
                            {id === 'photo' ? (
                              <span className="flex items-center gap-2">
                                <Avatar contact={contacts[vIdx as 0 | 1]} size="sm" />
                                <span className="truncate">{displayName(contacts[vIdx as 0 | 1])}</span>
                              </span>
                            ) : id === 'note' ? (
                              <span className="line-clamp-3 whitespace-pre-wrap">{val}</span>
                            ) : (
                              <span className="truncate block">{val}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Merged array fields summary */}
          {hasMergedArrays && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Combined fields</p>
              <div className="flex flex-wrap gap-2">
                {mergedCounts.phones > 0 && (
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {mergedCounts.phones} phone{mergedCounts.phones !== 1 ? 's' : ''}
                  </span>
                )}
                {mergedCounts.emails > 0 && (
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {mergedCounts.emails} email{mergedCounts.emails !== 1 ? 's' : ''}
                  </span>
                )}
                {mergedCounts.addresses > 0 && (
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {mergedCounts.addresses} address{mergedCounts.addresses !== 1 ? 'es' : ''}
                  </span>
                )}
                {mergedCounts.urls > 0 && (
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {mergedCounts.urls} URL{mergedCounts.urls !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={merging}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={merging}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {merging ? 'Merging…' : 'Merge contacts'}
          </button>
        </div>
      </div>
    </div>
  );
}
