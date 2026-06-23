import * as argon2 from 'argon2';
import { supabase } from '../lib/supabase';

const DEMO_PASSWORD = 'password123';
const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';

// UUIDs tetap agar ID tidak berubah setiap kali reset+seed.
// Flutter app bisa menyimpan ID ini tanpa khawatir berubah.
const ID = {
  region: { jakarta: '10000001-0000-4000-8000-000000000001' },
  branch: {
    kedoya: '20000001-0000-4000-8000-000000000001',
    selatan: '20000001-0000-4000-8000-000000000002',
  },
  service: {
    haircut: '30000001-0000-4000-8000-000000000001',
    haircutAndShave: '30000001-0000-4000-8000-000000000002',
    hairColoring: '30000001-0000-4000-8000-000000000003',
    hairSpa: '30000001-0000-4000-8000-000000000004',
    moustacheTrim: '30000001-0000-4000-8000-000000000005',
    faceShave: '30000001-0000-4000-8000-000000000006',
    hairWashing: '30000001-0000-4000-8000-000000000007',
  },
  staff: {
    hq: '40000001-0000-4000-8000-000000000001',
    adminKedoya: '40000001-0000-4000-8000-000000000002',
    adminSelatan: '40000001-0000-4000-8000-000000000003',
    davies: '40000001-0000-4000-8000-000000000004',
    barron: '40000001-0000-4000-8000-000000000005',
    reza: '40000001-0000-4000-8000-000000000006',
    dimas: '40000001-0000-4000-8000-000000000007',
  },
  barber: {
    davies: '50000001-0000-4000-8000-000000000001',
    barron: '50000001-0000-4000-8000-000000000002',
    reza: '50000001-0000-4000-8000-000000000003',
    dimas: '50000001-0000-4000-8000-000000000004',
  },
  customer: {
    raka: '60000001-0000-4000-8000-000000000001',
    dewi: '60000001-0000-4000-8000-000000000002',
    fajar: '60000001-0000-4000-8000-000000000003',
  },
  commissionRule: { global: '70000001-0000-4000-8000-000000000001' },
};

type RecordData = Record<string, any>;

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const atJakartaTime = (date: Date, time: string) =>
  new Date(`${dateOnly(date)}T${time}+07:00`).toISOString();

const applyMatch = (query: any, match: RecordData) => {
  let nextQuery = query;

  for (const [key, value] of Object.entries(match)) {
    nextQuery = value === null ? nextQuery.is(key, null) : nextQuery.eq(key, value);
  }

  return nextQuery;
};

async function findOne(table: string, match: RecordData) {
  const { data, error } = await applyMatch(
    supabase.from(table).select('*'),
    match
  ).limit(1).maybeSingle();

  if (error) throw error;
  return data;
}

async function upsertBy(table: string, match: RecordData, data: RecordData) {
  const existing = await findOne(table, match);

  if (existing) {
    const { id: _id, ...updateData } = data;
    const { data: rows, error } = await applyMatch(
      supabase.from(table).update(updateData).select('*'),
      match
    );

    if (error) throw error;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const { data: inserted, error } = await supabase
    .from(table)
    .insert(data)
    .select('*')
    .single();

  if (error) throw error;
  return inserted;
}

async function upsertRowsBy(table: string, rows: Array<{ match: RecordData; data: RecordData }>) {
  const result = [];

  for (const row of rows) {
    result.push(await upsertBy(table, row.match, row.data));
  }

  return result;
}

async function seedRolesAndPermissions() {
  console.log('Seeding roles and permissions...');

  const roles = await upsertRowsBy('roles', [
    { match: { name: 'super_admin' }, data: { name: 'super_admin' } },
    { match: { name: 'branch_admin' }, data: { name: 'branch_admin' } },
    { match: { name: 'barber' }, data: { name: 'barber' } }
  ]);

  const permissionCodes = [
    'manage_branch',
    'manage_staff',
    'manage_barber',
    'manage_service',
    'manage_appointment',
    'manage_payment',
    'manage_commission',
    'view_audit_log'
  ];

  const permissions = await upsertRowsBy(
    'permissions',
    permissionCodes.map((code) => ({
      match: { code },
      data: { code }
    }))
  );

  const roleByName = Object.fromEntries(roles.map((role: any) => [role.name, role]));
  const permissionByCode = Object.fromEntries(permissions.map((permission: any) => [permission.code, permission]));

  const rolePermissionMap: Record<string, string[]> = {
    super_admin: permissionCodes,
    branch_admin: ['manage_appointment', 'manage_payment', 'manage_commission', 'view_audit_log'],
    barber: []
  };

  for (const [roleName, codes] of Object.entries(rolePermissionMap)) {
    for (const code of codes) {
      await upsertBy('role_permissions', {
        role_id: roleByName[roleName].id,
        permission_id: permissionByCode[code].id
      }, {
        role_id: roleByName[roleName].id,
        permission_id: permissionByCode[code].id
      });
    }
  }

  return roleByName;
}

async function seedRegionsAndBranches() {
  console.log('Seeding regions, branches, photos, and operating hours...');

  const jakarta = await upsertBy('regions', { code: 'JKT' }, {
    id: ID.region.jakarta,
    code: 'JKT',
    name: 'Jakarta'
  });

  // Cabang utama — alamat resmi dari bombbarbershop.com
  const kedoya = await upsertBy('branches', { id: ID.branch.kedoya }, {
    id: ID.branch.kedoya,
    region_id: jakarta.id,
    name: 'Bomb Barbershop Kedoya',
    address: 'Jl. Taman Ratu Indah Blk. BB1 No.3A 3, RT.3/RW.11, Kedoya Utara, Jakarta Barat 11520',
    phone: '6281322096650',
    latitude: -6.186800,
    longitude: 106.752000,
    is_active: true
  });

  // Cabang kedua — demo (sesuai company profile "2+ branches")
  const selatan = await upsertBy('branches', { id: ID.branch.selatan }, {
    id: ID.branch.selatan,
    region_id: jakarta.id,
    name: 'Bomb Barbershop Jakarta Selatan',
    address: 'Jl. Melawai Raya No. 5, Blok M, Kebayoran Baru, Jakarta Selatan 12160',
    phone: '6281322096651',
    latitude: -6.244500,
    longitude: 106.798100,
    is_active: true
  });

  const branches = { kedoya, selatan };

  // Jam operasional: 10:00–21:00 setiap hari (sesuai website bombbarbershop.com)
  for (const branch of Object.values(branches) as any[]) {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await upsertBy('branch_operating_hours', {
        branch_id: branch.id,
        day_of_week: day
      }, {
        branch_id: branch.id,
        day_of_week: day,
        open_time: '10:00:00',
        close_time: '21:00:00'
      });
    }
  }

  await upsertRowsBy('branch_photos', [
    {
      match: { branch_id: kedoya.id, url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp' },
      data: { branch_id: kedoya.id, url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp', sort_order: 1 }
    },
    {
      match: { branch_id: selatan.id, url: 'http://localhost:3000/public/uploads/branches/photo-1503951914875-452162b0f3f1.webp' },
      data: { branch_id: selatan.id, url: 'http://localhost:3000/public/uploads/branches/photo-1503951914875-452162b0f3f1.webp', sort_order: 1 }
    }
  ]);

  return { regions: { jakarta }, branches };
}

async function seedStaff(roleByName: Record<string, any>, branches: Record<string, any>, passwordHash: string) {
  console.log('Seeding staff users, roles, and barber profiles...');

  // Staff: Jordan (owner dari website), Davies & Barron (barbers dari website), + demo staff
  const staffRows = await upsertRowsBy('staff_users', [
    {
      match: { id: ID.staff.hq },
      data: { id: ID.staff.hq, full_name: 'Jordan', email: 'jordan@bombbarbershop.com', phone: '6281322096650', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.adminKedoya },
      data: { id: ID.staff.adminKedoya, full_name: 'Nadia Kedoya Admin', email: 'admin.kedoya@bombbarbershop.com', phone: '6281322096652', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.adminSelatan },
      data: { id: ID.staff.adminSelatan, full_name: 'Reno Selatan Admin', email: 'admin.selatan@bombbarbershop.com', phone: '6281322096653', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.davies },
      data: { id: ID.staff.davies, full_name: 'Davies', email: 'davies@bombbarbershop.com', phone: '6281322096654', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.barron },
      data: { id: ID.staff.barron, full_name: 'Barron', email: 'barron@bombbarbershop.com', phone: '6281322096655', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.reza },
      data: { id: ID.staff.reza, full_name: 'Reza Mahendra', email: 'reza@bombbarbershop.com', phone: '6281322096656', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.dimas },
      data: { id: ID.staff.dimas, full_name: 'Dimas Wicaksono', email: 'dimas@bombbarbershop.com', phone: '6281322096657', password_hash: passwordHash, is_active: true }
    }
  ]);

  const staffByEmail = Object.fromEntries(staffRows.map((staff: any) => [staff.email, staff]));

  await upsertRowsBy('staff_user_roles', [
    {
      match: { staff_user_id: staffByEmail['jordan@bombbarbershop.com'].id, role_id: roleByName.super_admin.id, branch_id: null },
      data: { staff_user_id: staffByEmail['jordan@bombbarbershop.com'].id, role_id: roleByName.super_admin.id, branch_id: null }
    },
    {
      match: { staff_user_id: staffByEmail['admin.kedoya@bombbarbershop.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.kedoya.id },
      data: { staff_user_id: staffByEmail['admin.kedoya@bombbarbershop.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.kedoya.id }
    },
    {
      match: { staff_user_id: staffByEmail['admin.selatan@bombbarbershop.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.selatan.id },
      data: { staff_user_id: staffByEmail['admin.selatan@bombbarbershop.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.selatan.id }
    }
  ]);

  const globalRule = await upsertBy('commission_rules', {
    scope: 'global',
    scope_ref_id: null
  }, {
    id: ID.commissionRule.global,
    scope: 'global',
    scope_ref_id: null,
    barber_pct: '40.00',
    branch_pct: '40.00',
    hq_pct: '20.00',
    tip_to_barber: true,
    effective_from: EFFECTIVE_FROM
  });

  const barbers = await upsertRowsBy('barbers', [
    {
      match: { id: ID.barber.davies },
      data: {
        id: ID.barber.davies,
        staff_user_id: staffByEmail['davies@bombbarbershop.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Davies',
        bio: 'Spesialis haircut presisi, skin fade, dan classic gentleman cut. Berpengalaman 5+ tahun.',
        rating_avg: '4.85',
        rating_count: 124,
        live_status: 'available',
        service_radius_km: 8,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { id: ID.barber.barron },
      data: {
        id: ID.barber.barron,
        staff_user_id: staffByEmail['barron@bombbarbershop.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Barron',
        bio: 'Stylist senior, ahli hair coloring, hair spa treatment, dan grooming transformation.',
        rating_avg: '4.80',
        rating_count: 98,
        live_status: 'available',
        service_radius_km: 10,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { id: ID.barber.reza },
      data: {
        id: ID.barber.reza,
        staff_user_id: staffByEmail['reza@bombbarbershop.com'].id,
        branch_id: branches.selatan.id,
        display_name: 'Reza',
        bio: 'Fokus pada moustache trim, beard grooming, dan face shave dengan teknik straight razor.',
        rating_avg: '4.68',
        rating_count: 87,
        live_status: 'available',
        service_radius_km: 12,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { id: ID.barber.dimas },
      data: {
        id: ID.barber.dimas,
        staff_user_id: staffByEmail['dimas@bombbarbershop.com'].id,
        branch_id: branches.selatan.id,
        display_name: 'Dimas',
        bio: 'Barber serba bisa: haircut, hair washing, dan styling untuk aktivitas profesional harian.',
        rating_avg: '4.72',
        rating_count: 64,
        live_status: 'available',
        service_radius_km: 7,
        default_commission_rule_id: globalRule.id
      }
    }
  ]);

  for (const barber of barbers as any[]) {
    await upsertBy('staff_user_roles', {
      staff_user_id: barber.staff_user_id,
      role_id: roleByName.barber.id,
      branch_id: barber.branch_id
    }, {
      staff_user_id: barber.staff_user_id,
      role_id: roleByName.barber.id,
      branch_id: barber.branch_id
    });
  }

  return {
    staffByEmail,
    barbers: Object.fromEntries((barbers as any[]).map((barber) => [barber.display_name, barber])),
    globalRule
  };
}

async function seedCustomers(passwordHash: string) {
  console.log('Seeding customers...');

  const customers = await upsertRowsBy('customers', [
    {
      match: { id: ID.customer.raka },
      data: { id: ID.customer.raka, full_name: 'Raka Pratama', phone: '6281290001001', email: 'raka.customer@example.com', password_hash: passwordHash, points_balance: 120, is_active: true }
    },
    {
      match: { id: ID.customer.dewi },
      data: { id: ID.customer.dewi, full_name: 'Dewi Lestari', phone: '6281290001002', email: 'dewi.customer@example.com', password_hash: passwordHash, points_balance: 80, is_active: true }
    },
    {
      match: { id: ID.customer.fajar },
      data: { id: ID.customer.fajar, full_name: 'Fajar Nugroho', phone: '6281290001003', email: 'fajar.customer@example.com', password_hash: passwordHash, points_balance: 35, is_active: true }
    }
  ]);

  return Object.fromEntries((customers as any[]).map((customer) => [customer.email, customer]));
}

async function seedServices(regions: Record<string, any>, branches: Record<string, any>) {
  console.log('Seeding services and prices...');

  // Layanan sesuai menu resmi di bombbarbershop.com
  const services = await upsertRowsBy('services', [
    {
      match: { id: ID.service.haircut },
      data: {
        id: ID.service.haircut,
        name: 'Haircut',
        description: 'Potong rambut presisi yang disesuaikan dengan bentuk wajah, gaya personal, dan preferensi grooming.',
        default_duration_min: 45,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1599351431202-1e0f0137899a.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.haircutAndShave },
      data: {
        id: ID.service.haircutAndShave,
        name: 'Haircut & Shave',
        description: 'Paket grooming lengkap: potong rambut profesional dipadukan dengan shave bersih menggunakan straight razor.',
        default_duration_min: 60,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1517832606299-7ae9b720a186.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.hairColoring },
      data: {
        id: ID.service.hairColoring,
        name: 'Hair Coloring',
        description: 'Pewarnaan rambut profesional untuk memperbarui, mempertegas, atau mentransformasi tampilan dengan produk premium.',
        default_duration_min: 90,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1562322140-8baeececf3df.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.hairSpa },
      data: {
        id: ID.service.hairSpa,
        name: 'Hair Spa Treatment',
        description: 'Perawatan intensif rambut dan kulit kepala: deep conditioning, scalp massage, dan treatment nutrisi.',
        default_duration_min: 60,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1622287162716-f311baa1a2b8.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.moustacheTrim },
      data: {
        id: ID.service.moustacheTrim,
        name: 'Moustache Trim',
        description: 'Rapikan kumis dan janggut dengan presisi menggunakan teknik barbering klasik dan garis natural.',
        default_duration_min: 30,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1621605815971-fbc98d665033.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.faceShave },
      data: {
        id: ID.service.faceShave,
        name: 'Face Shave',
        description: 'Cukur wajah bersih dengan straight razor, hot towel treatment, dan after-shave balm premium.',
        default_duration_min: 30,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1605497788044-5a32c7078486.webp',
        is_active: true
      }
    },
    {
      match: { id: ID.service.hairWashing },
      data: {
        id: ID.service.hairWashing,
        name: 'Hair Washing',
        description: 'Keramas dengan shampoo premium, tonic perawatan ringan, blow dry, dan styling untuk aktivitas harian.',
        default_duration_min: 25,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1522337360788-8b13dee7a37e.webp',
        is_active: true
      }
    }
  ]);

  const byName = Object.fromEntries((services as any[]).map((service) => [service.name, service]));

  // Harga default sesuai website bombbarbershop.com (dalam rupiah)
  const defaultPrices: Record<string, number> = {
    'Haircut': 300000,
    'Haircut & Shave': 400000,
    'Hair Coloring': 400000,
    'Hair Spa Treatment': 380000,
    'Moustache Trim': 350000,
    'Face Shave': 200000,
    'Hair Washing': 240000
  };

  for (const [serviceName, price] of Object.entries(defaultPrices)) {
    await upsertBy('service_prices', {
      service_id: byName[serviceName].id,
      branch_id: null,
      region_id: null
    }, {
      service_id: byName[serviceName].id,
      branch_id: null,
      region_id: null,
      price_amount: price,
      effective_from: EFFECTIVE_FROM,
      effective_to: null
    });
  }

  // Hair Coloring bisa mencapai Rp500k (range 400k–500k dari website) di cabang Selatan
  await upsertRowsBy('service_prices', [
    {
      match: { service_id: byName['Hair Coloring'].id, branch_id: branches.selatan.id },
      data: {
        service_id: byName['Hair Coloring'].id,
        branch_id: branches.selatan.id,
        region_id: null,
        price_amount: 500000,
        effective_from: EFFECTIVE_FROM,
        effective_to: null
      }
    }
  ]);

  return byName;
}

async function seedProducts(branches: Record<string, any>) {
  console.log('Seeding products and branch inventory...');

  const products = await upsertRowsBy('products', [
    {
      match: { sku: 'BB-POMADE-MATTE-75' },
      data: { sku: 'BB-POMADE-MATTE-75', name: 'Bomb Matte Pomade 75g', description: 'Pomade matte finish untuk daily styling pria.', base_price: 95000 }
    },
    {
      match: { sku: 'BB-HAIRTONIC-100' },
      data: { sku: 'BB-HAIRTONIC-100', name: 'Bomb Hair Tonic 100ml', description: 'Hair tonic ringan untuk perawatan setelah haircut.', base_price: 75000 }
    },
    {
      match: { sku: 'BB-SHAMPOO-250' },
      data: { sku: 'BB-SHAMPOO-250', name: 'Bomb Daily Shampoo 250ml', description: 'Shampoo premium harian untuk rambut pria.', base_price: 110000 }
    }
  ]);

  for (const branch of Object.values(branches) as any[]) {
    for (const [index, product] of (products as any[]).entries()) {
      await upsertBy('branch_inventory', {
        branch_id: branch.id,
        product_id: product.id
      }, {
        branch_id: branch.id,
        product_id: product.id,
        quantity_on_hand: 20 + index * 8,
        reorder_level: 8
      });
    }
  }

  return Object.fromEntries((products as any[]).map((product) => [product.sku, product]));
}

async function seedContent(branches: Record<string, any>, barbers: Record<string, any>, customers: Record<string, any>) {
  console.log('Seeding banners, gallery, and notifications...');

  await upsertRowsBy('promotions', [
    {
      match: { title: 'Crafting Style. Building Confidence.' },
      data: {
        title: 'Crafting Style. Building Confidence.',
        subtitle: 'Haircut presisi mulai Rp300.000 di Bomb Barbershop. Booking langsung dari aplikasi.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1503951914875-452162b0f3f1.webp',
        target_url: '/booking',
        is_active: true,
        sort_order: 1,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    },
    {
      match: { title: 'Haircut & Shave Experience' },
      data: {
        title: 'Haircut & Shave Experience',
        subtitle: 'Paket grooming lengkap dengan straight razor. Rp400.000 di cabang Kedoya.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1622287162716-f311baa1a2b8.webp',
        target_url: `/branches/${branches.kedoya.id}/services`,
        is_active: true,
        sort_order: 2,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    },
    {
      match: { title: 'Hair Coloring by Barron' },
      data: {
        title: 'Hair Coloring by Barron',
        subtitle: 'Transformasi warna rambut dengan stylist senior. Konsultasi gratis sebelum treatment.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1621605815971-fbc98d665033.webp',
        target_url: '/services?search=coloring',
        is_active: true,
        sort_order: 3,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    }
  ]);

  await upsertRowsBy('barber_portfolios', [
    {
      match: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp' },
      data: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp', caption: 'Clean haircut presisi dengan finishing natural.' }
    },
    {
      match: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp' },
      data: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp', caption: 'Classic gentleman cut — rapi untuk kebutuhan profesional.' }
    },
    {
      match: { barber_id: barbers['Barron'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp' },
      data: { barber_id: barbers['Barron'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp', caption: 'Hair coloring transformation — hasil natural dan tahan lama.' }
    },
    {
      match: { barber_id: barbers['Reza'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp' },
      data: { barber_id: barbers['Reza'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp', caption: 'Moustache trim presisi dengan garis wajah yang tegas.' }
    }
  ]);

  const raka = customers['raka.customer@example.com'];
  await upsertRowsBy('notifications', [
    {
      match: { recipient_id: raka.id, type: 'promo', title: 'Haircut & Shave — Grooming Terlengkap' },
      data: {
        user_id: raka.id,
        recipient_id: raka.id,
        recipient_type: 'customer',
        type: 'promo',
        title: 'Haircut & Shave — Grooming Terlengkap',
        message: 'Coba paket Haircut & Shave bersama Davies di Bomb Barbershop Kedoya. Rp400.000 all-in.',
        body: 'Coba paket Haircut & Shave bersama Davies di Bomb Barbershop Kedoya. Rp400.000 all-in.',
        is_read: false,
        sent_at: new Date().toISOString()
      }
    }
  ]);
}

async function seedOperationalData(context: {
  branches: Record<string, any>;
  barbers: Record<string, any>;
  customers: Record<string, any>;
  services: Record<string, any>;
  products: Record<string, any>;
  globalRule: any;
  staffByEmail: Record<string, any>;
}) {
  console.log('Seeding appointments, payments, reviews, and operational reports...');

  const { branches, barbers, customers, services, products, globalRule, staffByEmail } = context;
  const now = new Date();
  const yesterday = addDays(now, -1);
  const tomorrow = addDays(now, 1);
  const nextDay = addDays(now, 2);

  // Appointment selesai kemarin: Raka — Haircut + Moustache Trim di Kedoya oleh Davies
  const completedAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['raka.customer@example.com'].id,
    scheduled_at: atJakartaTime(yesterday, '14:00:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Davies'].id,
    customer_id: customers['raka.customer@example.com'].id,
    source: 'online_booking',
    status: 'completed',
    scheduled_at: atJakartaTime(yesterday, '14:00:00'),
    queue_position: null,
    checked_in_at: atJakartaTime(yesterday, '13:55:00'),
    started_at: atJakartaTime(yesterday, '14:03:00'),
    completed_at: atJakartaTime(yesterday, '15:20:00'),
    customer_media_urls: []
  });

  await upsertRowsBy('appointment_services', [
    {
      match: { appointment_id: completedAppointment.id, service_id: services['Haircut'].id },
      data: { appointment_id: completedAppointment.id, service_id: services['Haircut'].id, price_amount: 300000, duration_min: 45 }
    },
    {
      match: { appointment_id: completedAppointment.id, service_id: services['Moustache Trim'].id },
      data: { appointment_id: completedAppointment.id, service_id: services['Moustache Trim'].id, price_amount: 350000, duration_min: 30 }
    }
  ]);

  await upsertBy('appointment_products', {
    appointment_id: completedAppointment.id,
    product_id: products['BB-POMADE-MATTE-75'].id
  }, {
    appointment_id: completedAppointment.id,
    product_id: products['BB-POMADE-MATTE-75'].id,
    quantity: 1,
    unit_price: 95000
  });

  // service_amount: 300k + 350k = 650k; product: 95k; service_fee: 5k; delivery_fee: 0 (in-store); tip: 50k
  // total: 650k + 95k + 5k + 0 + 50k = 800k
  const payment = await upsertBy('payments', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    branch_id: branches.kedoya.id,
    total_amount: 800000,
    service_amount: 650000,
    product_amount: 95000,
    service_fee: 5000,
    delivery_fee: 0,
    discount_amount: 0,
    tip_amount: 50000,
    method: 'qris',
    status: 'paid',
    gateway_reference: 'QRIS-DEMO-0001',
    paid_at: atJakartaTime(yesterday, '15:23:00')
  });

  await upsertBy('invoices', { payment_id: payment.id }, {
    payment_id: payment.id,
    invoice_number: `INV-${dateOnly(yesterday).replace(/-/g, '')}-0001`,
    issued_at: atJakartaTime(yesterday, '15:24:00'),
    pdf_url: null
  });

  // Komisi dari service amount 650k: barber 40% = 260k, branch 40% = 260k, HQ 20% = 130k; tip 50k ke barber
  await upsertBy('commission_entries', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    commission_rule_id: globalRule.id,
    base_amount: 650000,
    barber_share: 260000,
    branch_share: 260000,
    hq_share: 130000,
    tip_amount: 50000,
    calculated_at: atJakartaTime(yesterday, '15:25:00')
  });

  await upsertBy('reviews', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    customer_id: customers['raka.customer@example.com'].id,
    barber_id: barbers['Davies'].id,
    rating: '5.00',
    comment: 'Haircut dan moustache trim rapi banget. Davies sangat profesional dan detail.'
  });

  // Appointment aktif hari ini: Dewi — Hair Washing di Kedoya oleh Barron (walk-in)
  const inQueueAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['dewi.customer@example.com'].id,
    scheduled_at: atJakartaTime(now, '10:30:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Barron'].id,
    customer_id: customers['dewi.customer@example.com'].id,
    source: 'walk_in',
    status: 'in_queue',
    scheduled_at: atJakartaTime(now, '10:30:00'),
    queue_position: 1,
    checked_in_at: atJakartaTime(now, '10:25:00'),
    customer_media_urls: []
  });

  await upsertBy('appointment_services', {
    appointment_id: inQueueAppointment.id,
    service_id: services['Hair Washing'].id
  }, {
    appointment_id: inQueueAppointment.id,
    service_id: services['Hair Washing'].id,
    price_amount: 240000,
    duration_min: 25
  });

  await upsertBy('check_ins', { appointment_id: inQueueAppointment.id }, {
    appointment_id: inQueueAppointment.id,
    method: 'manual',
    location_lat: -6.186800,
    location_lng: 106.752000,
    checked_in_at: atJakartaTime(now, '10:25:00')
  });

  await upsertBy('barbers', { id: barbers['Barron'].id }, { live_status: 'serving' });

  // Appointment confirmed besok: Fajar — Haircut & Shave di Kedoya oleh Davies
  const confirmedAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['fajar.customer@example.com'].id,
    scheduled_at: atJakartaTime(tomorrow, '11:00:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Davies'].id,
    customer_id: customers['fajar.customer@example.com'].id,
    source: 'online_booking',
    status: 'confirmed',
    scheduled_at: atJakartaTime(tomorrow, '11:00:00'),
    queue_position: 2,
    customer_media_urls: [
      'http://localhost:3000/public/uploads/appointments/photo-1517832606299-7ae9b720a186.webp'
    ]
  });

  await upsertBy('appointment_services', {
    appointment_id: confirmedAppointment.id,
    service_id: services['Haircut & Shave'].id
  }, {
    appointment_id: confirmedAppointment.id,
    service_id: services['Haircut & Shave'].id,
    price_amount: 400000,
    duration_min: 60
  });

  await upsertBy('tracking_sessions', { appointment_id: confirmedAppointment.id }, {
    appointment_id: confirmedAppointment.id,
    status: 'active',
    consent_given_at: new Date().toISOString(),
    expires_at: atJakartaTime(tomorrow, '13:00:00')
  });

  // Appointment pending lusa: Raka — Hair Coloring di Selatan oleh Reza
  const pendingAppointment = await upsertBy('appointments', {
    branch_id: branches.selatan.id,
    customer_id: customers['raka.customer@example.com'].id,
    scheduled_at: atJakartaTime(nextDay, '13:00:00')
  }, {
    branch_id: branches.selatan.id,
    barber_id: barbers['Reza'].id,
    customer_id: customers['raka.customer@example.com'].id,
    source: 'online_booking',
    status: 'pending',
    scheduled_at: atJakartaTime(nextDay, '13:00:00'),
    queue_position: 1,
    customer_media_urls: []
  });

  await upsertBy('appointment_services', {
    appointment_id: pendingAppointment.id,
    service_id: services['Hair Coloring'].id
  }, {
    appointment_id: pendingAppointment.id,
    service_id: services['Hair Coloring'].id,
    price_amount: 500000,
    duration_min: 90
  });

  await upsertBy('cash_drawer_sessions', {
    branch_id: branches.kedoya.id,
    opened_at: atJakartaTime(now, '09:45:00')
  }, {
    branch_id: branches.kedoya.id,
    opened_at: atJakartaTime(now, '09:45:00'),
    closed_at: null,
    starting_cash: 2000000,
    ending_cash: null,
    expected_cash: 2240000,
    difference: null,
    status: 'open'
  });

  await upsertBy('branch_expenses', {
    branch_id: branches.kedoya.id,
    expense_date: dateOnly(now),
    description: 'Pembelian produk perawatan rambut dan towel harian'
  }, {
    branch_id: branches.kedoya.id,
    expense_date: dateOnly(now),
    amount: 450000,
    description: 'Pembelian produk perawatan rambut dan towel harian'
  });

  await upsertBy('daily_branch_summaries', {
    branch_id: branches.kedoya.id,
    summary_date: dateOnly(yesterday)
  }, {
    branch_id: branches.kedoya.id,
    summary_date: dateOnly(yesterday),
    total_revenue: 800000,
    total_appointments: 1,
    walk_in_count: 0,
    booking_count: 1,
    no_show_count: 0,
    hq_share_total: 130000,
    branch_share_total: 260000
  });

  await upsertBy('barber_daily_stats', {
    barber_id: barbers['Davies'].id,
    branch_id: branches.kedoya.id,
    summary_date: dateOnly(yesterday)
  }, {
    barber_id: barbers['Davies'].id,
    branch_id: branches.kedoya.id,
    summary_date: dateOnly(yesterday),
    heads_count: 1,
    revenue: 650000,
    commission_earned: 310000,
    avg_rating: '5.00'
  });

  await upsertRowsBy('audit_logs', [
    {
      match: { entity_type: 'payment', entity_id: payment.id, action: 'payment_paid' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.kedoya@bombbarbershop.com'].id,
        action: 'payment_paid',
        entity_type: 'payment',
        entity_id: payment.id,
        before: { status: 'pending' },
        after: { status: 'paid', total_amount: 800000, service_fee: 5000, delivery_fee: 0, method: 'qris' }
      }
    },
    {
      match: { entity_type: 'appointment', entity_id: completedAppointment.id, action: 'appointment_completed' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.kedoya@bombbarbershop.com'].id,
        action: 'appointment_completed',
        entity_type: 'appointment',
        entity_id: completedAppointment.id,
        before: { status: 'in_service' },
        after: { status: 'completed' }
      }
    }
  ]);

  const fajar = customers['fajar.customer@example.com'];
  await upsertBy('notifications', {
    recipient_id: fajar.id,
    type: 'booking_confirmed',
    title: 'Booking kamu sudah dikonfirmasi'
  }, {
    user_id: fajar.id,
    recipient_id: fajar.id,
    recipient_type: 'customer',
    type: 'booking_confirmed',
    title: 'Booking kamu sudah dikonfirmasi',
    message: 'Haircut & Shave di Bomb Barbershop Kedoya sudah dikonfirmasi untuk besok pukul 11.00 bersama Davies.',
    body: 'Haircut & Shave di Bomb Barbershop Kedoya sudah dikonfirmasi untuk besok pukul 11.00 bersama Davies.',
    is_read: false,
    sent_at: new Date().toISOString()
  });
}

async function main() {
  const isStarter = process.argv.includes('--starter');
  console.log(`Seeding Bomb Barbershop${isStarter ? ' (starter — tanpa data appointment)' : ''}...\n`);

  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const roleByName = await seedRolesAndPermissions();
  const { regions, branches } = await seedRegionsAndBranches();
  const { staffByEmail, barbers, globalRule } = await seedStaff(roleByName, branches, passwordHash);
  const customers = await seedCustomers(passwordHash);
  const services = await seedServices(regions, branches);
  const products = await seedProducts(branches);

  await seedContent(branches, barbers, customers);

  if (!isStarter) {
    await seedOperationalData({
      branches,
      barbers,
      customers,
      services,
      products,
      globalRule,
      staffByEmail
    });
  } else {
    console.log('Skipping operational data (appointments, payments, reviews).');
  }

  console.log('\nSeeding completed successfully.');
  console.log('Demo password for all seeded staff and customers:', DEMO_PASSWORD);
  console.log('\nDemo credentials:');
  console.log('  HQ Owner  : jordan@bombbarbershop.com');
  console.log('  Admin     : admin.kedoya@bombbarbershop.com');
  console.log('  Barber    : davies@bombbarbershop.com / barron@bombbarbershop.com');
  console.log('  Customer  : raka.customer@example.com');
  console.log('  Password  :', DEMO_PASSWORD);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
