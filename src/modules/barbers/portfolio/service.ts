import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { barbers, barberPortfolios } from '../../../db/schema';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { MediaService } from '../../../core/media/service';

async function resolveBarberId(staffId: string): Promise<string> {
  const [barber] = await db
    .select({ id: barbers.id })
    .from(barbers)
    .where(and(eq(barbers.staffUserId, staffId), isNull(barbers.deletedAt)))
    .limit(1);
  if (!barber) throw new Error('Profil barber tidak ditemukan');
  return barber.id;
}

const PORTFOLIO_COLUMNS = {
  id: barberPortfolios.id,
  barber_id: barberPortfolios.barberId,
  image_url: barberPortfolios.imageUrl,
  caption: barberPortfolios.caption,
  created_at: barberPortfolios.createdAt
};

export class BarberPortfolioService {
  static async upload({ staffId, file, caption }: { staffId: string; file: File; caption?: string }) {
    const barberId = await resolveBarberId(staffId);

    const media = await MediaService.uploadContentImage({
      uploaderId: staffId,
      file,
      category: 'portfolio'
    });

    const id = randomUUID();
    await db.insert(barberPortfolios).values({
      id,
      barberId,
      imageUrl: media.public_url,
      caption: caption?.trim() || null
    });

    const [portfolio] = await db.select(PORTFOLIO_COLUMNS).from(barberPortfolios).where(eq(barberPortfolios.id, id)).limit(1);
    return portfolio;
  }

  static async list(staffId: string, query: { page?: any; limit?: any } = {}) {
    const barberId = await resolveBarberId(staffId);

    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const rawLimit = query?.limit;
    const rawPage = query?.page;

    const limit = (() => {
      if (rawLimit === undefined || rawLimit === null || rawLimit === '') return DEFAULT_LIMIT;
      const n = Number(rawLimit);
      if (!Number.isFinite(n) || n < 1) throw new Error('Parameter limit harus berupa angka minimal 1');
      return Math.min(Math.floor(n), MAX_LIMIT);
    })();
    const page = (() => {
      if (rawPage === undefined || rawPage === null || rawPage === '') return 1;
      const n = Number(rawPage);
      if (!Number.isFinite(n) || n < 1) throw new Error('Parameter page harus berupa angka minimal 1');
      return Math.floor(n);
    })();
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(barberPortfolios).where(eq(barberPortfolios.barberId, barberId)),
      db
        .select(PORTFOLIO_COLUMNS)
        .from(barberPortfolios)
        .where(eq(barberPortfolios.barberId, barberId))
        .orderBy(desc(barberPortfolios.createdAt))
        .limit(limit)
        .offset(offset)
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return { data: dataResult, meta: { page, limit, total, total_pages: Math.ceil(total / limit) } };
  }

  static async remove(staffId: string, portfolioId: string) {
    const barberId = await resolveBarberId(staffId);

    await db
      .delete(barberPortfolios)
      .where(and(eq(barberPortfolios.id, portfolioId), eq(barberPortfolios.barberId, barberId)));

    return true;
  }
}
