import { db } from '../../../lib/db';
import { customers } from '../../../db/schema';
import { and, isNull, or, like, asc } from 'drizzle-orm';

export class CustomerSearchService {
  /**
   * Mencari customer berdasarkan nama atau nomor telepon (case-insensitive, partial match).
   * Collation utf8mb4 default MySQL sudah case-insensitive, jadi LIKE = ILIKE.
   */
  static async searchCustomers(query: string, limit: number = 10) {
    const sanitized = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${sanitized}%`;
    const resolvedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    const data = await db
      .select({
        id: customers.id,
        full_name: customers.fullName,
        phone: customers.phone,
        email: customers.email
      })
      .from(customers)
      .where(
        and(
          isNull(customers.deletedAt),
          or(like(customers.fullName, pattern), like(customers.phone, pattern))
        )
      )
      .orderBy(asc(customers.fullName))
      .limit(resolvedLimit);

    return data.map((c) => ({
      id: c.id,
      full_name: c.full_name,
      phone: c.phone ?? null,
      email: c.email ?? null
    }));
  }
}
