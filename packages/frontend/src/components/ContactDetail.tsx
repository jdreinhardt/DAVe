import { Mail, Phone, MapPin, Globe, Cake, StickyNote, Tag, User } from 'lucide-react';
import type { Contact, VCardAddress, VCardEmail, VCardPhone } from '@dave/shared';
import { cn } from '../lib/utils';

interface ContactDetailProps {
  contact: Contact;
}

export default function ContactDetail({ contact }: ContactDetailProps) {
  const { data } = contact;

  const displayName =
    data.fullName ||
    [data.name.prefix, data.name.given, data.name.middle, data.name.family, data.name.suffix]
      .filter(Boolean)
      .join(' ') ||
    '(No name)';

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Avatar contact={contact} size="lg" />
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground leading-tight">{displayName}</h2>
          {data.title && <p className="text-sm text-muted-foreground mt-0.5">{data.title}</p>}
          {data.organization && (
            <p className="text-sm text-muted-foreground">{data.organization}</p>
          )}
          {data.nickname && (
            <p className="text-xs text-muted-foreground italic mt-0.5">"{data.nickname}"</p>
          )}
        </div>
      </div>

      {/* Phones */}
      {data.phones.length > 0 && (
        <Section icon={<Phone className="h-4 w-4" />} title="Phone">
          {data.phones.map((p, i) => (
            <FieldRow key={i} label={typeLabel(p.types, 'Phone')} preferred={p.preferred}>
              <a
                href={`tel:${p.value}`}
                className="text-primary hover:underline"
              >
                {p.value}
              </a>
            </FieldRow>
          ))}
        </Section>
      )}

      {/* Emails */}
      {data.emails.length > 0 && (
        <Section icon={<Mail className="h-4 w-4" />} title="Email">
          {data.emails.map((e, i) => (
            <FieldRow key={i} label={typeLabel(e.types, 'Email')} preferred={e.preferred}>
              <a
                href={`mailto:${e.value}`}
                className="text-primary hover:underline break-all"
              >
                {e.value}
              </a>
            </FieldRow>
          ))}
        </Section>
      )}

      {/* Addresses */}
      {data.addresses.length > 0 && (
        <Section icon={<MapPin className="h-4 w-4" />} title="Address">
          {data.addresses.map((a, i) => (
            <FieldRow key={i} label={typeLabel(a.types, 'Address')} preferred={a.preferred}>
              <AddressBlock address={a} />
            </FieldRow>
          ))}
        </Section>
      )}

      {/* URLs */}
      {data.urls.length > 0 && (
        <Section icon={<Globe className="h-4 w-4" />} title="Website">
          {data.urls.map((url, i) => (
            <FieldRow key={i}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {url}
              </a>
            </FieldRow>
          ))}
        </Section>
      )}

      {/* Personal dates */}
      {(data.birthday || data.anniversary) && (
        <Section icon={<Cake className="h-4 w-4" />} title="Important dates">
          {data.birthday && <FieldRow label="Birthday">{formatDate(data.birthday)}</FieldRow>}
          {data.anniversary && (
            <FieldRow label="Anniversary">{formatDate(data.anniversary)}</FieldRow>
          )}
        </Section>
      )}

      {/* Note */}
      {data.note && (
        <Section icon={<StickyNote className="h-4 w-4" />} title="Note">
          <p className="text-sm text-foreground whitespace-pre-wrap">{data.note}</p>
        </Section>
      )}

      {/* Custom fields */}
      {data.customFields.length > 0 && (
        <Section icon={<Tag className="h-4 w-4" />} title="Custom fields">
          {data.customFields.map((f, i) => (
            <FieldRow key={i} label={f.property}>
              <span className="text-sm text-foreground break-all">{f.value}</span>
            </FieldRow>
          ))}
        </Section>
      )}

      {/* Footer meta */}
      <p className="text-xs text-muted-foreground/60 pt-2 border-t border-border">
        vCard {data.version} · {contact.addressBookId}
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="pl-5 space-y-2">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  preferred,
  children,
}: {
  label?: string;
  preferred?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {label !== undefined && (
        <span
          className={cn(
            'text-xs rounded px-1.5 py-0.5 shrink-0 mt-0.5',
            preferred
              ? 'bg-primary/10 text-primary font-medium'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {label}
        </span>
      )}
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

function AddressBlock({ address }: { address: VCardAddress }) {
  const lines = [
    address.street,
    [address.city, address.region, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
  return (
    <address className="not-italic text-sm text-foreground leading-relaxed">
      {lines.map((l, i) => (
        <span key={i}>
          {l}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </address>
  );
}

// ── Exported avatar (reused in list) ─────────────────────────────────────────

export function Avatar({
  contact,
  size = 'md',
}: {
  contact: Contact;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { data } = contact;
  const sizeClass = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }[
    size
  ];

  if (data.photo) {
    return (
      <img
        src={data.photo}
        alt=""
        className={cn('rounded-full object-cover shrink-0 bg-muted', sizeClass)}
      />
    );
  }

  const initials = getInitials(data.name.given, data.name.family, data.fullName);
  return (
    <div
      className={cn(
        'rounded-full shrink-0 flex items-center justify-center font-semibold',
        'bg-primary/10 text-primary select-none',
        sizeClass,
      )}
    >
      {initials || <User className="h-1/2 w-1/2" />}
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getInitials(given: string, family: string, fullName: string): string {
  if (given || family) {
    return [(given[0] ?? ''), (family[0] ?? '')].join('').toUpperCase();
  }
  const words = fullName.trim().split(/\s+/);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  return (fullName[0] ?? '').toUpperCase();
}

function typeLabel(types: string[], fallback: string): string {
  if (types.length === 0) return fallback;
  // Map common uppercase type codes to friendly labels
  const friendly: Record<string, string> = {
    HOME: 'Home', WORK: 'Work', CELL: 'Mobile', MOBILE: 'Mobile',
    VOICE: 'Voice', FAX: 'Fax', OTHER: 'Other',
  };
  return types.map((t) => friendly[t] ?? t).join(' / ');
}

function formatDate(iso: string): string {
  // Handle partial dates like ----04-15 (no year)
  if (iso.startsWith('--')) {
    const m = iso.match(/--(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(2000, parseInt(m[1]!) - 1, parseInt(m[2]!));
      return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    }
    return iso;
  }
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// Re-export helpers used by the list
export { getInitials };
