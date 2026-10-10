import { ValidationError } from './errors.js';
import { normalizePhone } from './phone.js';
import type { ShipmentInput } from './types.js';

/** Catches the mistakes couriers reject with unhelpful messages, before any network call. */
export function validateShipment(s: ShipmentInput): void {
  requireText('orderRef', s.orderRef);
  requireText('customer.name', s.customer?.name);
  requireText('customer.address', s.customer?.address);
  requireText('customer.phone', s.customer?.phone);
  normalizePhone(s.customer.phone); // throws a ValidationError for anything that isn't a PK mobile

  if (s.customer.city === undefined || s.customer.city === null || String(s.customer.city).trim() === '') {
    throw new ValidationError('customer.city', 'is required');
  }
  if (!Number.isFinite(s.codAmount) || s.codAmount < 0) {
    throw new ValidationError('codAmount', 'must be 0 or more (PKR)');
  }
  if (!Number.isInteger(s.codAmount)) {
    throw new ValidationError('codAmount', 'must be a whole number of rupees');
  }
  if (!Number.isFinite(s.weightGrams) || s.weightGrams <= 0) {
    throw new ValidationError('weightGrams', 'must be greater than 0');
  }
  if (s.pieces !== undefined && (!Number.isInteger(s.pieces) || s.pieces < 1)) {
    throw new ValidationError('pieces', 'must be a whole number, at least 1');
  }
}

function requireText(field: string, value: string | undefined): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(field, 'is required');
  }
}

/** Parses courier dates like "2026-10-10 14:32:00", "10/10/2026 2:32 PM" or ISO strings. Falls back to the input. */
export function toIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();

  // "YYYY-MM-DD HH:mm(:ss)" is local Pakistan time (UTC+5) at both couriers.
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}+05:00`;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) return text;

  // "DD/MM/YYYY" with optional time
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(text);
  if (dmy) {
    const [, d, mo, y, hRaw, mi, s, ampm] = dmy;
    if (!hRaw) return `${y}-${pad(mo!)}-${pad(d!)}`;
    let h = Number(hRaw);
    if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${y}-${pad(mo!)}-${pad(d!)}T${pad(String(h))}:${mi}:${s ?? '00'}+05:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text))) return text;
  return text;
}

function pad(v: string): string {
  return v.padStart(2, '0');
}
