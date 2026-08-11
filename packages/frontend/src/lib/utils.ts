import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MapService } from '../contexts/Settings';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Lighten a hex color by mixing it toward white by `amount` (0–1).
 * Used to tint the calendar tasks layer a slightly lighter shade than its
 * source calendar so tasks are discernible from that calendar's events.
 * Returns the input unchanged if it isn't a parseable #RGB / #RRGGBB color.
 */
export function lightenHex(color: string, amount = 0.35): string {
  let hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return color;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const toHex = (c: number) => mix(c).toString(16).padStart(2, '0');
  return `#${toHex(parseInt(hex.slice(0, 2), 16))}${toHex(parseInt(hex.slice(2, 4), 16))}${toHex(parseInt(hex.slice(4, 6), 16))}`;
}

/**
 * Darken a hex color by mixing it toward black by `amount` (0–1). Used to tint
 * the calendar journals layer a shade darker than its source calendar (the
 * mirror of lightenHex, which tints the tasks layer lighter).
 */
export function darkenHex(color: string, amount = 0.25): string {
  let hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return color;
  const mix = (c: number) => Math.round(c * (1 - amount));
  const toHex = (c: number) => mix(c).toString(16).padStart(2, '0');
  return `#${toHex(parseInt(hex.slice(0, 2), 16))}${toHex(parseInt(hex.slice(2, 4), 16))}${toHex(parseInt(hex.slice(4, 6), 16))}`;
}

export function buildMapUrl(location: string, service: MapService): string {
  const q = encodeURIComponent(location);
  switch (service) {
    case 'google': return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case 'apple':  return `https://maps.apple.com/?q=${q}`;
    default:       return `https://www.openstreetmap.org/search?query=${q}`;
  }
}
