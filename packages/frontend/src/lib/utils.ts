import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MapService } from '../contexts/Settings';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function buildMapUrl(location: string, service: MapService): string {
  const q = encodeURIComponent(location);
  switch (service) {
    case 'google': return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case 'apple':  return `https://maps.apple.com/?q=${q}`;
    default:       return `https://www.openstreetmap.org/search?query=${q}`;
  }
}
