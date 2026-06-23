import { supabase } from '../../../lib/supabase';
import { MediaService } from '../../../core/media/service';

export class BarberPortfolioService {
  static async upload({ staffId, file, caption }: { staffId: string; file: File; caption?: string }) {
    const { data: barber, error: barberError } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .single();

    if (barberError || !barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    const media = await MediaService.uploadContentImage({
      uploaderId: staffId,
      file,
      category: 'portfolio'
    });

    const { data: portfolio, error } = await supabase
      .from('barber_portfolios')
      .insert({
        barber_id: barber.id,
        image_url: media.public_url,
        caption: caption?.trim() || null
      })
      .select('id, barber_id, image_url, caption, created_at')
      .single();

    if (error) {
      throw new Error('Gagal menyimpan portfolio: ' + error.message);
    }

    return portfolio;
  }

  static async list(staffId: string, query: { page?: any; limit?: any } = {}) {
    const { data: barber, error: barberError } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .single();

    if (barberError || !barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

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
      supabase.from('barber_portfolios').select('*', { count: 'exact', head: true }).eq('barber_id', barber.id),
      supabase.from('barber_portfolios').select('id, barber_id, image_url, caption, created_at').eq('barber_id', barber.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1)
    ]);

    if (dataResult.error) throw new Error('Gagal mengambil portfolio');
    const total = countResult.count ?? 0;
    return { data: dataResult.data ?? [], meta: { page, limit, total, total_pages: Math.ceil(total / limit) } };
  }

  static async remove(staffId: string, portfolioId: string) {
    const { data: barber } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .single();

    if (!barber) throw new Error('Profil barber tidak ditemukan');

    const { error } = await supabase
      .from('barber_portfolios')
      .delete()
      .eq('id', portfolioId)
      .eq('barber_id', barber.id);

    if (error) throw new Error('Gagal menghapus portfolio');
    return true;
  }
}
