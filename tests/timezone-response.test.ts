import { describe, expect, it } from 'bun:test';
import { createSuccessResponse, createErrorResponse } from '../src/shared/response';
import { toJakartaIsoString, toJakartaResponse } from '../src/shared/timezone';

describe('Asia/Jakarta response timezone', () => {
  it('mengubah ISO UTC menjadi ISO Asia/Jakarta pada response API', () => {
    const response = createSuccessResponse('ok', {
      scheduled_at: '2026-06-25T03:00:00.000Z',
      nested: {
        created_at: '2026-06-25 03:00:00.123456'
      }
    });

    expect(response.data.scheduled_at).toBe('2026-06-25T10:00:00.000+07:00');
    expect(response.data.nested.created_at).toBe('2026-06-25T10:00:00.123+07:00');
  });

  it('mengubah error payload timestamp tanpa mengubah date-only', () => {
    const response = createErrorResponse(
      'Validasi gagal',
      { retry_at: '2026-06-25T03:00:00.000Z', summary_date: '2026-06-25' },
      null,
      null,
      { skipLog: true }
    );

    expect((response.errors as any).retry_at).toBe('2026-06-25T10:00:00.000+07:00');
    expect((response.errors as any).summary_date).toBe('2026-06-25');
  });

  it('menjaga timestamp offset Jakarta tetap di offset Jakarta', () => {
    expect(toJakartaIsoString('2026-06-25T10:00:00+07:00')).toBe('2026-06-25T10:00:00.000+07:00');
  });

  it('menormalisasi props Inertia secara rekursif', () => {
    const props = toJakartaResponse({
      user: { updated_at: new Date('2026-06-25T03:00:00.000Z') },
      items: [{ paid_at: '2026-06-25T03:30:00.000Z' }]
    }) as any;

    expect(props.user.updated_at).toBe('2026-06-25T10:00:00.000+07:00');
    expect(props.items[0].paid_at).toBe('2026-06-25T10:30:00.000+07:00');
  });
});
