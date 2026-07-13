import { describe, expect, it } from 'bun:test';
import { parseDbTime, toSqlUtc } from '../src/db/procedures';

describe('DB datetime helpers', () => {
  it('mem-parse ISO timestamptz dengan offset tanpa menghasilkan Invalid Date', () => {
    const date = parseDbTime('2026-06-25T10:00:00+07:00');

    expect(date.getTime()).not.toBeNaN();
    expect(date.toISOString()).toBe('2026-06-25T03:00:00.000Z');
  });

  it('mem-parse ISO UTC tanpa menambahkan suffix Z ganda', () => {
    const date = parseDbTime('2026-06-25T03:00:00.000Z');

    expect(date.getTime()).not.toBeNaN();
    expect(date.toISOString()).toBe('2026-06-25T03:00:00.000Z');
  });

  it('menganggap DATETIME MySQL tanpa timezone sebagai UTC', () => {
    const date = parseDbTime('2026-06-25 03:00:00.123456');

    expect(date.getTime()).not.toBeNaN();
    expect(date.toISOString()).toBe('2026-06-25T03:00:00.123Z');
  });

  it('menolak Date invalid sebelum diformat untuk query SQL', () => {
    expect(() => toSqlUtc(new Date('invalid'))).toThrow('Tanggal/waktu tidak valid');
  });
});
