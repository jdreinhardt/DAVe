import { useState } from 'react';
import type { ContactJson, VCardPhone, VCardEmail } from '@dave/shared';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BulkEditConfig =
  | { field: 'organization' | 'title' | 'nickname' | 'note'; op: 'clear' }
  | { field: 'organization' | 'title' | 'nickname' | 'note'; op: 'set'; value: string }
  | { field: 'birthday' | 'anniversary'; op: 'clear' }
  | { field: 'birthday' | 'anniversary'; op: 'set'; value: string }
  | { field: 'photo'; op: 'clear' }
  | { field: 'addresses'; op: 'clear' }
  | { field: 'phones'; op: 'clear' }
  | { field: 'phones'; op: 'add'; value: VCardPhone }
  | { field: 'emails'; op: 'clear' }
  | { field: 'emails'; op: 'add'; value: VCardEmail }
  | { field: 'urls'; op: 'clear' }
  | { field: 'urls'; op: 'add'; value: string };

export function applyBulkEdit(data: ContactJson, config: BulkEditConfig): ContactJson {
  const d = { ...data };
  const { field } = config;
  if (field === 'organization') {
    d.organization = config.op === 'set' ? config.value : '';
  } else if (field === 'title') {
    d.title = config.op === 'set' ? config.value : '';
  } else if (field === 'nickname') {
    d.nickname = config.op === 'set' ? config.value : '';
  } else if (field === 'note') {
    d.note = config.op === 'set' ? config.value : '';
  } else if (field === 'birthday') {
    d.birthday = config.op === 'set' ? config.value : null;
  } else if (field === 'anniversary') {
    d.anniversary = config.op === 'set' ? config.value : null;
  } else if (field === 'photo') {
    d.photo = null;
  } else if (field === 'addresses') {
    d.addresses = [];
  } else if (field === 'phones') {
    d.phones = config.op === 'clear' ? [] : [...d.phones, config.value];
  } else if (field === 'emails') {
    d.emails = config.op === 'clear' ? [] : [...d.emails, config.value];
  } else if (field === 'urls') {
    d.urls = config.op === 'clear' ? [] : [...d.urls, config.value];
  }
  return d;
}

// ── Field metadata ────────────────────────────────────────────────────────────

type FieldId =
  | 'organization' | 'title' | 'nickname' | 'note'
  | 'birthday' | 'anniversary' | 'photo'
  | 'phones' | 'emails' | 'urls' | 'addresses';

type Op = 'clear' | 'set' | 'add';

const FIELD_DEFS: Array<{ id: FieldId; label: string; ops: Op[] }> = [
  { id: 'organization', label: 'Organization', ops: ['clear', 'set'] },
  { id: 'title',        label: 'Title',        ops: ['clear', 'set'] },
  { id: 'nickname',     label: 'Nickname',     ops: ['clear', 'set'] },
  { id: 'note',         label: 'Note',         ops: ['clear', 'set'] },
  { id: 'birthday',     label: 'Birthday',     ops: ['clear', 'set'] },
  { id: 'anniversary',  label: 'Anniversary',  ops: ['clear', 'set'] },
  { id: 'photo',        label: 'Photo',        ops: ['clear'] },
  { id: 'phones',       label: 'Phones',       ops: ['clear', 'add'] },
  { id: 'emails',       label: 'Emails',       ops: ['clear', 'add'] },
  { id: 'urls',         label: 'URLs',         ops: ['clear', 'add'] },
  { id: 'addresses',    label: 'Addresses',    ops: ['clear'] },
];

const PHONE_TYPES = ['CELL', 'VOICE', 'HOME', 'WORK', 'FAX', 'PAGER', 'OTHER'];
const EMAIL_TYPES = ['INTERNET', 'HOME', 'WORK', 'OTHER'];

const opLabel = (o: Op) => {
  if (o === 'set') return 'Set to…';
  if (o === 'add') return 'Add new';
  return 'Clear';
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  count: number;
  onApply: (config: BulkEditConfig) => void;
  onCancel: () => void;
  applying: boolean;
}

export default function BulkEditModal({ count, onApply, onCancel, applying }: Props) {
  const [fieldId, setFieldId] = useState<FieldId>('organization');
  const [op, setOp] = useState<Op>('clear');
  const [textValue, setTextValue] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [phoneValue, setPhoneValue] = useState<VCardPhone>({ value: '', types: ['CELL'], preferred: false });
  const [emailValue, setEmailValue] = useState<VCardEmail>({ value: '', types: ['INTERNET'], preferred: false });
  const [urlValue, setUrlValue] = useState('');

  const fieldDef = FIELD_DEFS.find((f) => f.id === fieldId)!;

  const handleFieldChange = (id: FieldId) => {
    setFieldId(id);
    const def = FIELD_DEFS.find((f) => f.id === id)!;
    setOp(def.ops[0] ?? 'clear');
    setTextValue('');
    setDateValue('');
    setPhoneValue({ value: '', types: ['CELL'], preferred: false });
    setEmailValue({ value: '', types: ['INTERNET'], preferred: false });
    setUrlValue('');
  };

  const buildConfig = (): BulkEditConfig | null => {
    if (fieldId === 'organization' || fieldId === 'title' || fieldId === 'nickname' || fieldId === 'note') {
      if (op === 'clear') return { field: fieldId, op: 'clear' };
      if (op === 'set') return { field: fieldId, op: 'set', value: textValue };
    }
    if (fieldId === 'birthday' || fieldId === 'anniversary') {
      if (op === 'clear') return { field: fieldId, op: 'clear' };
      if (op === 'set') return { field: fieldId, op: 'set', value: dateValue };
    }
    if (fieldId === 'photo') return { field: 'photo', op: 'clear' };
    if (fieldId === 'addresses') return { field: 'addresses', op: 'clear' };
    if (fieldId === 'phones') {
      if (op === 'clear') return { field: 'phones', op: 'clear' };
      if (op === 'add') return { field: 'phones', op: 'add', value: phoneValue };
    }
    if (fieldId === 'emails') {
      if (op === 'clear') return { field: 'emails', op: 'clear' };
      if (op === 'add') return { field: 'emails', op: 'add', value: emailValue };
    }
    if (fieldId === 'urls') {
      if (op === 'clear') return { field: 'urls', op: 'clear' };
      if (op === 'add') return { field: 'urls', op: 'add', value: urlValue };
    }
    return null;
  };

  const isInvalid = (() => {
    if (op === 'clear') return false;
    if (['organization', 'title', 'nickname', 'note'].includes(fieldId)) return !textValue.trim();
    if (['birthday', 'anniversary'].includes(fieldId)) return !dateValue;
    if (fieldId === 'phones') return !phoneValue.value.trim();
    if (fieldId === 'emails') return !emailValue.value.trim();
    if (fieldId === 'urls') return !urlValue.trim();
    return false;
  })();

  const handleApply = () => {
    const config = buildConfig();
    if (config) onApply(config);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-sm font-semibold">
          Edit {count} contact{count !== 1 ? 's' : ''}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          Changes apply to all selected contacts.
        </p>

        <div className="space-y-3">
          {/* Field selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Field</label>
            <select
              value={fieldId}
              onChange={(e) => handleFieldChange(e.target.value as FieldId)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {FIELD_DEFS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Op selector — hidden when only one option */}
          {fieldDef.ops.length > 1 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <div className="mt-1 flex gap-2">
                {fieldDef.ops.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOp(o)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-1.5 text-xs',
                      op === o
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background hover:bg-muted text-foreground',
                    )}
                  >
                    {opLabel(o)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Value input */}
          {op !== 'clear' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Value</label>
              <div className="mt-1 space-y-1.5">
                {(fieldId === 'organization' || fieldId === 'title' || fieldId === 'nickname') && (
                  <input
                    type="text"
                    value={textValue}
                    onChange={(e) => setTextValue(e.target.value)}
                    placeholder={fieldDef.label}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
                {fieldId === 'note' && (
                  <textarea
                    value={textValue}
                    onChange={(e) => setTextValue(e.target.value)}
                    rows={3}
                    placeholder="Note…"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                )}
                {(fieldId === 'birthday' || fieldId === 'anniversary') && (
                  <input
                    type="date"
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
                {fieldId === 'phones' && (
                  <>
                    <input
                      type="tel"
                      value={phoneValue.value}
                      onChange={(e) => setPhoneValue((p) => ({ ...p, value: e.target.value }))}
                      placeholder="Phone number"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <select
                      value={phoneValue.types[0] ?? 'CELL'}
                      onChange={(e) => setPhoneValue((p) => ({ ...p, types: [e.target.value] }))}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {PHONE_TYPES.map((t) => (
                        <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                      ))}
                    </select>
                  </>
                )}
                {fieldId === 'emails' && (
                  <>
                    <input
                      type="email"
                      value={emailValue.value}
                      onChange={(e) => setEmailValue((p) => ({ ...p, value: e.target.value }))}
                      placeholder="Email address"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <select
                      value={emailValue.types[0] ?? 'INTERNET'}
                      onChange={(e) => setEmailValue((p) => ({ ...p, types: [e.target.value] }))}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {EMAIL_TYPES.map((t) => (
                        <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                      ))}
                    </select>
                  </>
                )}
                {fieldId === 'urls' && (
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    placeholder="https://…"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
            </div>
          )}

          {op === 'clear' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Clears {fieldDef.label.toLowerCase()} for all {count} contacts.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || isInvalid}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
