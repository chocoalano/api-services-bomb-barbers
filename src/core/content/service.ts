import { supabase } from '../../lib/supabase';

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

    const { data, error } = await supabase
      .from('promotions')
      .select('id, title, subtitle, image_url, target_url, starts_at, ends_at, sort_order, created_at')
      .eq('is_active', true)
      .is('deleted_at', null)
      .not('image_url', 'is', null)
      .neq('image_url', '')
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error('Gagal mengambil daftar banner');
    }

    return data ?? [];
  }

  static async getAfterGallery(query: GalleryQuery = {}) {
    const limit = normalizeLimit(query.limit, 30, 100);

    let galleryQuery = supabase
      .from('barber_portfolios')
      .select(`
        id,
        barber_id,
        image_url,
        caption,
        created_at,
        barbers!inner (
          id,
          branch_id,
          display_name,
          deleted_at
        )
      `)
      .is('barbers.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query.barber_id) {
      galleryQuery = galleryQuery.eq('barber_id', query.barber_id);
    }

    if (query.branch_id) {
      galleryQuery = galleryQuery.eq('barbers.branch_id', query.branch_id);
    }

    const { data, error } = await galleryQuery;

    if (error) {
      throw new Error('Gagal mengambil gallery layanan');
    }

    return (data ?? []).map((item: any) => ({
      id: item.id,
      barber_id: item.barber_id,
      image_url: item.image_url,
      caption: item.caption,
      created_at: item.created_at,
      barber: Array.isArray(item.barbers) ? item.barbers[0] : item.barbers
    }));
  }

  static async getCustomerNotifications(customerId: string, query: NotificationQuery = {}) {
    const limit = normalizeLimit(query.limit, 20, 50);
    const unreadOnly = normalizeBoolean(query.unread_only);
    assertIsoDate(query.before);

    let notificationQuery = supabase
      .from('notifications')
      .select('id, title, body, type, sent_at, read_at, created_at')
      .eq('recipient_type', 'customer')
      .eq('recipient_id', customerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      notificationQuery = notificationQuery.is('read_at', null);
    }

    if (query.before) {
      notificationQuery = notificationQuery.lt('created_at', query.before);
    }

    const { data, error } = await notificationQuery;

    if (error) {
      throw new Error('Gagal mengambil daftar notifikasi');
    }

    const { count, error: countError } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_type', 'customer')
      .eq('recipient_id', customerId)
      .is('read_at', null)
      .is('deleted_at', null);

    if (countError) {
      throw new Error('Gagal menghitung notifikasi belum dibaca');
    }

    return {
      items: (data ?? []).map((item: any) => ({
        ...item,
        is_read: Boolean(item.read_at)
      })),
      unread_count: count ?? 0
    };
  }

  static async markNotificationRead(customerId: string, notificationId: string) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('recipient_id', customerId)
      .eq('recipient_type', 'customer')
      .is('deleted_at', null)
      .select('id, read_at')
      .maybeSingle();

    if (error) throw new Error('Gagal menandai notifikasi sebagai dibaca');
    if (!data) throw new Error('Notifikasi tidak ditemukan atau bukan milik Anda');
    return data;
  }

  static async markAllNotificationsRead(customerId: string) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', customerId)
      .eq('recipient_type', 'customer')
      .is('read_at', null)
      .is('deleted_at', null)
      .select('id');

    if (error) throw new Error('Gagal menandai semua notifikasi sebagai dibaca');
    return { updated_count: (data ?? []).length };
  }
}
