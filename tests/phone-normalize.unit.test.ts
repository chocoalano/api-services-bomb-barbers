import { describe, expect, it } from 'bun:test';
import { normalizePhone } from '../src/lib/phone';

describe('normalizePhone', () => {
  it('mengubah prefiks 0 menjadi +62', () => {
    expect(normalizePhone('08123456789')).toBe('+628123456789');
  });

  it('mempertahankan bentuk +62', () => {
    expect(normalizePhone('+628123456789')).toBe('+628123456789');
  });

  it('menambahkan + pada prefiks 62', () => {
    expect(normalizePhone('628123456789')).toBe('+628123456789');
  });

  it('membuang spasi, tanda hubung, dan kurung', () => {
    expect(normalizePhone('0812-3456-789')).toBe('+628123456789');
    expect(normalizePhone('(0812) 3456 789')).toBe('+628123456789');
    expect(normalizePhone(' +62 812 3456 789 ')).toBe('+628123456789');
  });

  it('semua format lokal untuk nomor sama menyatu ke satu nilai kanonik', () => {
    const canonical = '+628123456789';
    expect(normalizePhone('08123456789')).toBe(canonical);
    expect(normalizePhone('628123456789')).toBe(canonical);
    expect(normalizePhone('+62 812 345 6789')).toBe(canonical);
  });

  it('mengembalikan string kosong untuk input kosong/null', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('mempertahankan nomor internasional non-ID apa adanya', () => {
    expect(normalizePhone('+1 202 555 0143')).toBe('+12025550143');
  });
});
