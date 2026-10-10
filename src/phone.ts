import { ValidationError } from './errors.js';

/**
 * Normalizes a Pakistani mobile number to the 03XXXXXXXXX format couriers expect.
 * Accepts spaces, dashes, brackets, +92, 0092 and 92 prefixes.
 *
 * normalizePhone('+92 300-1234567') === '03001234567'
 */
export function normalizePhone(input: string, field = 'customer.phone'): string {
  const digits = input.replace(/[^\d+]/g, '');

  let local: string;
  if (digits.startsWith('+92')) local = '0' + digits.slice(3);
  else if (digits.startsWith('0092')) local = '0' + digits.slice(4);
  else if (digits.startsWith('92') && digits.length === 12) local = '0' + digits.slice(2);
  else if (digits.startsWith('3') && digits.length === 10) local = '0' + digits;
  else local = digits;

  if (!/^03\d{9}$/.test(local)) {
    throw new ValidationError(field, `"${input}" is not a valid Pakistani mobile number (expected 03XXXXXXXXX)`);
  }
  return local;
}

/** Like {@link normalizePhone} but returns undefined instead of throwing. */
export function tryNormalizePhone(input: string): string | undefined {
  try {
    return normalizePhone(input);
  } catch {
    return undefined;
  }
}
