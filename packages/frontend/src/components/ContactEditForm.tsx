import { useState, useRef } from 'react';
import { Plus, Trash2, Camera, X, UserRound } from 'lucide-react';
import type {
  AddressBook,
  ContactJson,
  VCardAddress,
  VCardCustomField,
  VCardEmail,
  VCardPhone,
} from '@dave/shared';
import { cn } from '../lib/utils';
import PhotoCropModal from './PhotoCropModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactEditFormProps {
  initial: ContactJson;
  addressBooks: AddressBook[];
  selectedAddressBookId: string;
  onAddressBookChange: (id: string) => void;
  onSave: (data: ContactJson) => void;
  onCancel: () => void;
  saving: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export function emptyContactJson(): ContactJson {
  return {
    uid: '',
    version: '3.0',
    name: { prefix: '', given: '', middle: '', family: '', suffix: '' },
    fullName: '',
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

const PHONE_TYPES = ['CELL', 'HOME', 'WORK', 'VOICE', 'FAX', 'OTHER'];
const EMAIL_TYPES = ['HOME', 'WORK', 'OTHER'];
const ADDRESS_TYPES = ['HOME', 'WORK', 'OTHER'];

// ── Main component ────────────────────────────────────────────────────────────

export default function ContactEditForm({
  initial,
  addressBooks,
  selectedAddressBookId,
  onAddressBookChange,
  onSave,
  onCancel,
  saving,
}: ContactEditFormProps) {
  const [data, setData] = useState<ContactJson>(() => ({ ...initial }));
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // True when the user has manually typed in the Display name field, meaning we
  // should stop overwriting it when given/family name fields change.
  // Also true on load if the stored fullName doesn't match the auto-derived value
  // (e.g. includes a prefix, or was set to something entirely different).
  const [fullNameCustomized, setFullNameCustomized] = useState(
    () =>
      !!initial.fullName &&
      initial.fullName !== [initial.name.given, initial.name.family].filter(Boolean).join(' '),
  );

  const set = <K extends keyof ContactJson>(key: K, value: ContactJson[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  // ── Phones ────────────────────────────────────────────────────────────────

  const addPhone = () =>
    set('phones', [...data.phones, { value: '', types: ['CELL'], preferred: false }]);

  const updatePhone = (i: number, patch: Partial<VCardPhone>) =>
    set('phones', data.phones.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const removePhone = (i: number) =>
    set('phones', data.phones.filter((_, idx) => idx !== i));

  // ── Emails ────────────────────────────────────────────────────────────────

  const addEmail = () =>
    set('emails', [...data.emails, { value: '', types: ['HOME'], preferred: false }]);

  const updateEmail = (i: number, patch: Partial<VCardEmail>) =>
    set('emails', data.emails.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const removeEmail = (i: number) =>
    set('emails', data.emails.filter((_, idx) => idx !== i));

  // ── Addresses ─────────────────────────────────────────────────────────────

  const addAddress = () =>
    set('addresses', [
      ...data.addresses,
      { types: ['HOME'], street: '', city: '', region: '', postalCode: '', country: '', preferred: false },
    ]);

  const updateAddress = (i: number, patch: Partial<VCardAddress>) =>
    set('addresses', data.addresses.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const removeAddress = (i: number) =>
    set('addresses', data.addresses.filter((_, idx) => idx !== i));

  // ── URLs ──────────────────────────────────────────────────────────────────

  const addUrl = () => set('urls', [...data.urls, '']);
  const updateUrl = (i: number, v: string) =>
    set('urls', data.urls.map((u, idx) => (idx === i ? v : u)));
  const removeUrl = (i: number) =>
    set('urls', data.urls.filter((_, idx) => idx !== i));

  // ── Custom fields ─────────────────────────────────────────────────────────

  const addCustomField = () =>
    set('customFields', [...data.customFields, { property: 'X-', value: '', parameters: {} }]);

  const updateCustomField = (i: number, patch: Partial<VCardCustomField>) =>
    set('customFields', data.customFields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const removeCustomField = (i: number) =>
    set('customFields', data.customFields.filter((_, idx) => idx !== i));

  // ── Photo ─────────────────────────────────────────────────────────────────

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected after crop cancel
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Auto-compute FN from name parts if blank
    const fullName = data.fullName.trim() ||
      [data.name.prefix, data.name.given, data.name.middle, data.name.family, data.name.suffix]
        .filter(Boolean).join(' ');
    onSave({ ...data, fullName });
  };

  return (
    <>
      {cropSrc && (
        <PhotoCropModal
          imageSrc={cropSrc}
          onSave={(uri) => { set('photo', uri); setCropSrc(null); }}
          onCancel={() => setCropSrc(null)}
        />
      )}

      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Address book selector (only show when creating) */}
          {addressBooks.length > 1 && (
            <FormSection title="Address book">
              <select
                value={selectedAddressBookId}
                onChange={(e) => onAddressBookChange(e.target.value)}
                className={inputCls}
              >
                {addressBooks.map((ab) => (
                  <option key={ab.id} value={ab.id}>{ab.displayName}</option>
                ))}
              </select>
            </FormSection>
          )}

          {/* Photo */}
          <FormSection title="Photo">
            <div className="flex items-center gap-4">
              {data.photo ? (
                <img
                  src={data.photo}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center border border-border">
                  <UserRound className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className={cn('flex items-center gap-1.5', outlineBtnCls)}
                >
                  <Camera className="h-3.5 w-3.5" />
                  {data.photo ? 'Change photo' : 'Add photo'}
                </button>
                {data.photo && (
                  <button
                    type="button"
                    onClick={() => set('photo', null)}
                    className="flex items-center gap-1.5 text-sm text-destructive hover:underline"
                  >
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoFileChange}
              />
            </div>
          </FormSection>

          {/* Name */}
          <FormSection title="Name">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className={labelCls}>Display name</label>
                <input
                  type="text"
                  placeholder="Full name (auto-computed if blank)"
                  value={data.fullName}
                  onChange={(e) => {
                    set('fullName', e.target.value);
                    setFullNameCustomized(true);
                  }}
                  className={inputCls}
                />
              </div>
              {([
                ['given', 'First'],
                ['family', 'Last'],
                ['middle', 'Middle'],
                ['prefix', 'Prefix (Dr., Mr., …)'],
                ['suffix', 'Suffix (Jr., III, …)'],
              ] as const).map(([field, placeholder]) => (
                <div key={field}>
                  <label className={labelCls}>{placeholder}</label>
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={data.name[field]}
                    onChange={(e) => {
                      const newName = { ...data.name, [field]: e.target.value };
                      setData((d) => {
                        const next = { ...d, name: newName };
                        if (!fullNameCustomized && (field === 'given' || field === 'family')) {
                          next.fullName = [newName.given, newName.family].filter(Boolean).join(' ');
                        }
                        return next;
                      });
                    }}
                    className={inputCls}
                  />
                </div>
              ))}
              <div>
                <label className={labelCls}>Nickname</label>
                <input
                  type="text"
                  placeholder="Nickname"
                  value={data.nickname}
                  onChange={(e) => set('nickname', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </FormSection>

          {/* Work */}
          <FormSection title="Work">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Organization</label>
                <input
                  type="text"
                  placeholder="Company"
                  value={data.organization}
                  onChange={(e) => set('organization', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Title</label>
                <input
                  type="text"
                  placeholder="Job title"
                  value={data.title}
                  onChange={(e) => set('title', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </FormSection>

          {/* Phones */}
          <FormSection
            title="Phone"
            action={<AddRowButton onClick={addPhone} />}
          >
            {data.phones.map((p, i) => (
              <div key={i} className="flex gap-2 items-start">
                <TypeSelect
                  options={PHONE_TYPES}
                  value={p.types[0] ?? 'CELL'}
                  onChange={(t) => updatePhone(i, { types: [t] })}
                />
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={p.value}
                  onChange={(e) => updatePhone(i, { value: e.target.value })}
                  className={cn(inputCls, 'flex-1')}
                />
                <label className="flex items-center gap-1 text-xs text-muted-foreground mt-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.preferred}
                    onChange={(e) => updatePhone(i, { preferred: e.target.checked })}
                    className="accent-primary"
                  />
                  Pref
                </label>
                <RemoveButton onClick={() => removePhone(i)} />
              </div>
            ))}
          </FormSection>

          {/* Emails */}
          <FormSection
            title="Email"
            action={<AddRowButton onClick={addEmail} />}
          >
            {data.emails.map((e, i) => (
              <div key={i} className="flex gap-2 items-start">
                <TypeSelect
                  options={EMAIL_TYPES}
                  value={e.types[0] ?? 'HOME'}
                  onChange={(t) => updateEmail(i, { types: [t] })}
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={e.value}
                  onChange={(ev) => updateEmail(i, { value: ev.target.value })}
                  className={cn(inputCls, 'flex-1')}
                />
                <label className="flex items-center gap-1 text-xs text-muted-foreground mt-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={e.preferred}
                    onChange={(ev) => updateEmail(i, { preferred: ev.target.checked })}
                    className="accent-primary"
                  />
                  Pref
                </label>
                <RemoveButton onClick={() => removeEmail(i)} />
              </div>
            ))}
          </FormSection>

          {/* Addresses */}
          <FormSection
            title="Address"
            action={<AddRowButton onClick={addAddress} />}
          >
            {data.addresses.map((a, i) => (
              <div key={i} className="space-y-2 border border-border rounded-md p-3">
                <div className="flex gap-2 items-center">
                  <TypeSelect
                    options={ADDRESS_TYPES}
                    value={a.types[0] ?? 'HOME'}
                    onChange={(t) => updateAddress(i, { types: [t] })}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      checked={a.preferred}
                      onChange={(e) => updateAddress(i, { preferred: e.target.checked })}
                      className="accent-primary"
                    />
                    Preferred
                  </label>
                  <RemoveButton onClick={() => removeAddress(i)} />
                </div>
                <input
                  type="text"
                  placeholder="Street"
                  value={a.street}
                  onChange={(e) => updateAddress(i, { street: e.target.value })}
                  className={inputCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={a.city}
                    onChange={(e) => updateAddress(i, { city: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="State / Region"
                    value={a.region}
                    onChange={(e) => updateAddress(i, { region: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="Postal code"
                    value={a.postalCode}
                    onChange={(e) => updateAddress(i, { postalCode: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="Country"
                    value={a.country}
                    onChange={(e) => updateAddress(i, { country: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
            ))}
          </FormSection>

          {/* URLs */}
          <FormSection
            title="Website"
            action={<AddRowButton onClick={addUrl} />}
          >
            {data.urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => updateUrl(i, e.target.value)}
                  className={cn(inputCls, 'flex-1')}
                />
                <RemoveButton onClick={() => removeUrl(i)} />
              </div>
            ))}
          </FormSection>

          {/* Dates */}
          <FormSection title="Important dates">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Birthday</label>
                <input
                  type="date"
                  value={data.birthday ?? ''}
                  onChange={(e) => set('birthday', e.target.value || null)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Anniversary</label>
                <input
                  type="date"
                  value={data.anniversary ?? ''}
                  onChange={(e) => set('anniversary', e.target.value || null)}
                  className={inputCls}
                />
              </div>
            </div>
          </FormSection>

          {/* Note */}
          <FormSection title="Note">
            <textarea
              rows={3}
              placeholder="Notes…"
              value={data.note}
              onChange={(e) => set('note', e.target.value)}
              className={cn(inputCls, 'resize-y')}
            />
          </FormSection>

          {/* Custom fields */}
          <FormSection
            title="Custom fields"
            action={<AddRowButton onClick={addCustomField} />}
          >
            {data.customFields.map((cf, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  type="text"
                  placeholder="X-PROPERTY"
                  value={cf.property}
                  onChange={(e) => updateCustomField(i, { property: e.target.value.toUpperCase() })}
                  className={cn(inputCls, 'w-36 shrink-0 font-mono text-xs')}
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={cf.value}
                  onChange={(e) => updateCustomField(i, { value: e.target.value })}
                  className={cn(inputCls, 'flex-1')}
                />
                <RemoveButton onClick={() => removeCustomField(i)} />
              </div>
            ))}
          </FormSection>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex gap-2 justify-end bg-background">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={cn(outlineBtnCls, 'px-4')}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TypeSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring shrink-0',
      )}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {capitalize(o)}
        </option>
      ))}
    </select>
  );
}

function AddRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <Plus className="h-3 w-3" /> Add
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');

const labelCls = 'block text-xs text-muted-foreground mb-0.5';

const outlineBtnCls = [
  'rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted',
  'text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');

function capitalize(s: string): string {
  if (!s) return s;
  const friendly: Record<string, string> = {
    CELL: 'Mobile', HOME: 'Home', WORK: 'Work', VOICE: 'Voice',
    FAX: 'Fax', OTHER: 'Other',
  };
  return friendly[s] ?? s.charAt(0) + s.slice(1).toLowerCase();
}
