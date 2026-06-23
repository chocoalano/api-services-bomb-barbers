import { supabase } from '../../../lib/supabase';

type BranchServicesQuery = {
  limit?: number | string;
  page?: number | string;
  q?: string;
  search?: string;
};

const DEFAULT_SERVICE_LIMIT = 10;
const MAX_SERVICE_LIMIT = 100;
const MAX_SERVICE_SCAN_LIMIT = 500;

const normalizeLimit = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SERVICE_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter limit harus berupa angka minimal 1');
  }

  return Math.min(Math.floor(parsed), MAX_SERVICE_LIMIT);
};

const normalizePage = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter page harus berupa angka minimal 1');
  }

  return Math.floor(parsed);
};

const normalizeSearch = (query: BranchServicesQuery) => {
  const keyword = (query.q ?? query.search ?? '').trim();
  if (!keyword) return '';

  return keyword
    .replace(/[,*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolvePriceForService = (prices: any[], serviceId: string, branchId: string, regionId?: string | null) => {
  const servicePrices = prices.filter((price) => price.service_id === serviceId);

  return (
    servicePrices.find((price) => price.branch_id === branchId) ||
    (regionId ? servicePrices.find((price) => price.region_id === regionId) : null) ||
    servicePrices.find((price) => price.branch_id === null && price.region_id === null)
  );
};

export class CatalogService {
  static async getBranches() {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .is('deleted_at', null);
      
    if (error) throw new Error('Gagal mengambil daftar cabang');
    return data;
  }

  static async getBranchDetail(branchId: string) {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('id', branchId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new Error('Cabang tidak ditemukan');
    return data;
  }

  static async getBranchBarbers(branchId: string) {
    const { data, error } = await supabase
      .from('barbers')
      .select('*')
      .eq('branch_id', branchId)
      .is('deleted_at', null);

    if (error) throw new Error('Gagal mengambil daftar barber');
    return data;
  }

  static async getActiveServices() {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .is('deleted_at', null);

    if (error) throw new Error('Gagal mengambil daftar layanan');
    return data;
  }

  static async getBranchServices(branchId: string, query: BranchServicesQuery = {}) {
    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const search = normalizeSearch(query);

    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('id, region_id, is_active')
      .eq('id', branchId)
      .is('deleted_at', null)
      .single();

    if (branchError || !branch || branch.is_active === false) {
      throw new Error('Cabang tidak ditemukan atau tidak aktif');
    }

    let serviceQuery = supabase
      .from('services')
      .select('id, name, description, default_duration_min, image_url')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(MAX_SERVICE_SCAN_LIMIT);

    if (search) {
      serviceQuery = serviceQuery.or(`name.ilike.*${search}*,description.ilike.*${search}*`);
    }

    const { data: services, error: serviceError } = await serviceQuery;
    if (serviceError) {
      throw new Error('Gagal mengambil daftar layanan');
    }

    if (!services || services.length === 0) {
      return [];
    }

    const serviceIds = services.map((service: any) => service.id);
    const now = new Date().toISOString();

    const { data: prices, error: priceError } = await supabase
      .from('service_prices')
      .select('service_id, branch_id, region_id, price_amount, effective_from, effective_to')
      .in('service_id', serviceIds)
      .lte('effective_from', now)
      .or(`effective_to.is.null,effective_to.gte.${now}`)
      .order('effective_from', { ascending: false });

    if (priceError) {
      throw new Error('Gagal mengambil harga layanan');
    }

    return services
      .map((service: any) => {
        const price = resolvePriceForService(prices ?? [], service.id, branchId, branch.region_id);
        if (!price) return null;

        return {
          id: service.id,
          name: service.name,
          description: service.description,
          default_duration_min: service.default_duration_min,
          price_amount: price.price_amount,
          image_url: service.image_url || null
        };
      })
      .filter(Boolean)
      .slice((page - 1) * limit, page * limit);
  }

  static async resolveServicePrice(serviceId: string, branchId: string, atDate: Date = new Date()) {
    // 1. Pastikan service aktif dan tidak di-soft delete
    const { data: service } = await supabase
      .from('services')
      .select('is_active, deleted_at')
      .eq('id', serviceId)
      .single();

    if (!service || !service.is_active || service.deleted_at !== null) {
      throw new Error('Layanan tidak ditemukan atau tidak aktif');
    }

    // 2. Dapatkan region_id dari branch
    const { data: branch } = await supabase
      .from('branches')
      .select('region_id')
      .eq('id', branchId)
      .is('deleted_at', null)
      .single();

    if (!branch) {
      throw new Error('Cabang tidak ditemukan');
    }

    const regionId = branch.region_id;
    const dateIso = atDate.toISOString();

    // 3. Ambil semua harga yang sudah efektif (effective_from <= atDate)
    const { data: prices, error } = await supabase
      .from('service_prices')
      .select('*')
      .eq('service_id', serviceId)
      .lte('effective_from', dateIso);

    if (error || !prices || prices.length === 0) {
      throw new Error('Harga layanan tidak tersedia');
    }

    // 4. Filter yang belum expired (effective_to >= atDate OR null)
    const validPrices = prices.filter((p: any) => {
      if (!p.effective_to) return true;
      return new Date(p.effective_to) >= atDate;
    });

    if (validPrices.length === 0) {
      throw new Error('Harga layanan tidak tersedia pada tanggal ini');
    }

    // 5. Resolusi Prioritas
    // P1: Branch Price
    const branchPrice = validPrices.find((p: any) => p.branch_id === branchId);
    if (branchPrice) return branchPrice;

    // P2: Region Price
    if (regionId) {
      const regionPrice = validPrices.find((p: any) => p.region_id === regionId);
      if (regionPrice) return regionPrice;
    }

    // P3: Default Price
    const defaultPrice = validPrices.find((p: any) => p.branch_id === null && p.region_id === null);
    if (defaultPrice) return defaultPrice;

    throw new Error('Tidak ada harga valid yang ditemukan untuk layanan ini');
  }
}
