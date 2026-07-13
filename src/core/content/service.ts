import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { promotions, barberPortfolios, barbers, notifications } from '../../db/schema';
import { and, or, eq, ne, isNull, isNotNull, lte, gte, lt, asc, desc, sql, type SQL } from 'drizzle-orm';

type ListQuery = {
  limit?: number | string;
};

type NotificationQuery = ListQuery & {
  before?: string;
  unread_only?: boolean | string;
};

type GalleryQuery = ListQuery & {
  barber_id?: string;
  branch_id?: string;
};

const normalizeLimit = (value: number | string | undefined, fallback = 20, max = 50) => {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter limit harus berupa angka minimal 1');
  }

  return Math.min(Math.floor(parsed), max);
};

const normalizeBoolean = (value: boolean | string | undefined) => {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  return value.toLowerCase() === 'true';
};

const assertIsoDate = (value?: string) => {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('Parameter before harus berupa timestamp ISO yang valid');
  }
};

export class ContentService {
  static async getActiveBanners(query: ListQuery = {}) {
    const limit = normalizeLimit(query.limit, 10, 30);
    const now = new Date().toISOString();

    const data = snakeKeys(
      await db
        .select({
          id: promotions.id,
          title: promotions.title,
          subtitle: promotions.subtitle,
          image_url: promotions.imageUrl,
          target_url: promotions.targetUrl,
          starts_at: promotions.startsAt,
          ends_at: promotions.endsAt,
          sort_order: promotions.sortOrder,
          created_at: promotions.createdAt
        })
        .from(promotions)
        .where(
          and(
            eq(promotions.isActive, true),
            isNull(promotions.deletedAt),
            isNotNull(promotions.imageUrl),
            ne(promotions.imageUrl, ''),
            or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
            or(isNull(promotions.endsAt), gte(promotions.endsAt, now))
          )
        )
        .orderBy(asc(promotions.sortOrder), desc(promotions.createdAt))
        .limit(limit)
    );

    return data ?? [];
  }

  static async getAfterGallery(query: GalleryQuery = {}) {
    const limit = normalizeLimit(query.limit, 30, 100);

    const conds: SQL[] = [isNull(barbers.deletedAt)];
    if (query.barber_id) conds.push(eq(barberPortfolios.barberId, query.barber_id));
    if (query.branch_id) conds.push(eq(barbers.branchId, query.branch_id));

    const rows = await db
      .select({
        id: barberPortfolios.id,
        barberId: barberPortfolios.barberId,
        imageUrl: barberPortfolios.imageUrl,
        caption: barberPortfolios.caption,
        createdAt: barberPortfolios.createdAt,
        barberIdRef: barbers.id,
        branchId: barbers.branchId,
        displayName: barbers.displayName,
        deletedAt: barbers.deletedAt
      })
      .from(barberPortfolios)
      .innerJoin(barbers, eq(barberPortfolios.barberId, barbers.id))
      .where(and(...conds))
      .orderBy(desc(barberPortfolios.createdAt))
      .limit(limit);

    return rows.map((item) => ({
      id: item.id,
      barber_id: item.barberId,
      image_url: item.imageUrl,
      caption: item.caption,
      created_at: item.createdAt,
      barber: {
        id: item.barberIdRef,
        branch_id: item.branchId,
        display_name: item.displayName,
        deleted_at: item.deletedAt
      }
    }));
  }

  static async getCustomerNotifications(customerId: string, query: NotificationQuery = {}) {
    const limit = normalizeLimit(query.limit, 20, 50);
    const unreadOnly = normalizeBoolean(query.unread_only);
    assertIsoDate(query.before);

    const conds: SQL[] = [
      eq(notifications.recipientType, 'customer'),
      eq(notifications.recipientId, customerId),
      isNull(notifications.deletedAt)
    ];
    if (unreadOnly) conds.push(isNull(notifications.readAt));
    if (query.before) conds.push(lt(notifications.createdAt, query.before));

    const data = snakeKeys(
      await db
        .select({
          id: notifications.id,
          title: notifications.title,
          body: notifications.body,
          type: notifications.type,
          sent_at: notifications.sentAt,
          read_at: notifications.readAt,
          created_at: notifications.createdAt
        })
        .from(notifications)
        .where(and(...conds))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
    );

    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientType, 'customer'),
          eq(notifications.recipientId, customerId),
          isNull(notifications.readAt),
          isNull(notifications.deletedAt)
        )
      );

    return {
      items: (data ?? []).map((item: any) => ({
        ...item,
        is_read: Boolean(item.read_at)
      })),
      unread_count: Number(countRows[0]?.count ?? 0)
    };
  }

  static async markNotificationRead(customerId: string, notificationId: string) {
    await db
      .update(notifications)
      .set({ readAt: toDbDate(new Date()) })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, customerId),
          eq(notifications.recipientType, 'customer'),
          isNull(notifications.deletedAt)
        )
      );

    const [data] = await db
      .select({ id: notifications.id, read_at: notifications.readAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, customerId),
          eq(notifications.recipientType, 'customer'),
          isNull(notifications.deletedAt)
        )
      )
      .limit(1);

    if (!data) throw new Error('Notifikasi tidak ditemukan atau bukan milik Anda');
    return data;
  }

  static async markAllNotificationsRead(customerId: string) {
    const res: any = await db
      .update(notifications)
      .set({ readAt: toDbDate(new Date()) })
      .where(
        and(
          eq(notifications.recipientId, customerId),
          eq(notifications.recipientType, 'customer'),
          isNull(notifications.readAt),
          isNull(notifications.deletedAt)
        )
      );

    const updated = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    return { updated_count: updated };
  }
}
