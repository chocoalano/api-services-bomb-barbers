import * as argon2 from 'argon2';
import { supabase } from '../lib/supabase';

const DEMO_PASSWORD = 'password123';
const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';

// UUIDs tetap agar ID tidak berubah setiap kali reset+seed.
// Flutter app bisa menyimpan ID ini tanpa khawatir berubah.
const ID = {
  region: { jakarta: '10000001-0000-4000-8000-000000000001' },
  branch: { ancol: '20000001-0000-4000-8000-000000000001', utara: '20000001-0000-4000-8000-000000000002' },
  service: {
    premiumHaircut: '30000001-0000-4000-8000-000000000001',
    executiveHaircut: '30000001-0000-4000-8000-000000000002',
    skinFade: '30000001-0000-4000-8000-000000000003',
    beardTrim: '30000001-0000-4000-8000-000000000004',
    hairWashStyling: '30000001-0000-4000-8000-000000000005',
    hairColoringConsultation: '30000001-0000-4000-8000-000000000006',
    kidsHaircut: '30000001-0000-4000-8000-000000000007',
  },
  staff: {
    hq: '40000001-0000-4000-8000-000000000001',
    adminAncol: '40000001-0000-4000-8000-000000000002',
    adminUtara: '40000001-0000-4000-8000-000000000003',
    budi: '40000001-0000-4000-8000-000000000004',
    andi: '40000001-0000-4000-8000-000000000005',
    reza: '40000001-0000-4000-8000-000000000006',
    dimas: '40000001-0000-4000-8000-000000000007',
  },
  barber: {
    budi: '50000001-0000-4000-8000-000000000001',
    andi: '50000001-0000-4000-8000-000000000002',
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
    // Never overwrite the primary key — strip `id` from update payload
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

  const ancol = await upsertBy('branches', { name: 'Bomb Barbershop Jakarta Ancol' }, {
    id: ID.branch.ancol,
    region_id: jakarta.id,
    name: 'Bomb Barbershop Jakarta Ancol',
    address: 'Jl. Lodan Raya No. 1, Jakarta Utara',
    phone: '021-22770012',
    latitude: -6.175796912710608,
    longitude: 106.59936380485594,
    is_active: true
  });

  const utara = await upsertBy('branches', { name: 'Bomb Barbershop Jakarta Utara' }, {
    id: ID.branch.utara,
    region_id: jakarta.id,
    name: 'Bomb Barbershop Jakarta Utara',
    address: 'Jl. Boulevard Raya, Kelapa Gading, Jakarta Utara',
    phone: '021-22770088',
    latitude: -6.175796912710608,
    longitude: 106.59936380485594,
    is_active: true
  });

  const branches = { ancol, utara };

  for (const branch of Object.values(branches) as any[]) {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await upsertBy('branch_operating_hours', {
        branch_id: branch.id,
        day_of_week: day
      }, {
        branch_id: branch.id,
        day_of_week: day,
        open_time: day === 0 ? '10:00:00' : '09:00:00',
        close_time: [5, 6].includes(day) ? '22:00:00' : '21:00:00'
      });
    }
  }

  await upsertRowsBy('branch_photos', [
    {
      match: { branch_id: ancol.id, url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp' },
      data: { branch_id: ancol.id, url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp', sort_order: 1 }
    },
    {
      match: { branch_id: utara.id, url: 'http://localhost:3000/public/uploads/branches/photo-1503951914875-452162b0f3f1.webp' },
      data: { branch_id: utara.id, url: 'http://localhost:3000/public/uploads/branches/photo-1503951914875-452162b0f3f1.webp', sort_order: 1 }
    }
  ]);

  return { regions: { jakarta }, branches };
}

async function seedStaff(roleByName: Record<string, any>, branches: Record<string, any>, passwordHash: string) {
  console.log('Seeding staff users, roles, and barber profiles...');

  const staffRows = await upsertRowsBy('staff_users', [
    {
      match: { email: 'hq@bombbarbers.com' },
      data: { id: ID.staff.hq, full_name: 'HQ Super Admin', email: 'hq@bombbarbers.com', phone: '628110000001', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'admin.ancol@bombbarbers.com' },
      data: { id: ID.staff.adminAncol, full_name: 'Nadia Ancol Admin', email: 'admin.ancol@bombbarbers.com', phone: '628110000101', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'admin.utara@bombbarbers.com' },
      data: { id: ID.staff.adminUtara, full_name: 'Reno Utara Admin', email: 'admin.utara@bombbarbers.com', phone: '628110000102', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'budi@bombbarbers.com' },
      data: { id: ID.staff.budi, full_name: 'Budi Santoso', email: 'budi@bombbarbers.com', phone: '628110001001', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'andi@bombbarbers.com' },
      data: { id: ID.staff.andi, full_name: 'Andi Pratama', email: 'andi@bombbarbers.com', phone: '628110001002', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'reza@bombbarbers.com' },
      data: { id: ID.staff.reza, full_name: 'Reza Mahendra', email: 'reza@bombbarbers.com', phone: '628110001003', password_hash: passwordHash, is_active: true }
    },
    {
      match: { email: 'dimas@bombbarbers.com' },
      data: { id: ID.staff.dimas, full_name: 'Dimas Wicaksono', email: 'dimas@bombbarbers.com', phone: '628110001004', password_hash: passwordHash, is_active: true }
    }
  ]);

  const staffByEmail = Object.fromEntries(staffRows.map((staff: any) => [staff.email, staff]));

  await upsertRowsBy('staff_user_roles', [
    {
      match: { staff_user_id: staffByEmail['hq@bombbarbers.com'].id, role_id: roleByName.super_admin.id, branch_id: null },
      data: { staff_user_id: staffByEmail['hq@bombbarbers.com'].id, role_id: roleByName.super_admin.id, branch_id: null }
    },
    {
      match: { staff_user_id: staffByEmail['admin.ancol@bombbarbers.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.ancol.id },
      data: { staff_user_id: staffByEmail['admin.ancol@bombbarbers.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.ancol.id }
    },
    {
      match: { staff_user_id: staffByEmail['admin.utara@bombbarbers.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.utara.id },
      data: { staff_user_id: staffByEmail['admin.utara@bombbarbers.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.utara.id }
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
      match: { staff_user_id: staffByEmail['budi@bombbarbers.com'].id, branch_id: branches.ancol.id },
      data: {
        id: ID.barber.budi,
        staff_user_id: staffByEmail['budi@bombbarbers.com'].id,
        branch_id: branches.ancol.id,
        display_name: 'Budi Fade Master',
        bio: 'Spesialis skin fade, taper, dan classic gentleman cut.',
        rating_avg: '4.85',
        rating_count: 124,
        live_status: 'available',
        service_radius_km: 8,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { staff_user_id: staffByEmail['andi@bombbarbers.com'].id, branch_id: branches.ancol.id },
      data: {
        id: ID.barber.andi,
        staff_user_id: staffByEmail['andi@bombbarbers.com'].id,
        branch_id: branches.ancol.id,
        display_name: 'Andi Classic',
        bio: 'Rapi untuk executive cut, beard trim, dan hair wash styling.',
        rating_avg: '4.74',
        rating_count: 98,
        live_status: 'available',
        service_radius_km: 10,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { staff_user_id: staffByEmail['reza@bombbarbers.com'].id, branch_id: branches.utara.id },
      data: {
        id: ID.barber.reza,
        staff_user_id: staffByEmail['reza@bombbarbers.com'].id,
        branch_id: branches.utara.id,
        display_name: 'Reza Texture Pro',
        bio: 'Fokus pada textured crop, modern mullet, dan styling natural.',
        rating_avg: '4.68',
        rating_count: 87,
        live_status: 'available',
        service_radius_km: 12,
        default_commission_rule_id: globalRule.id
      }
    },
    {
      match: { staff_user_id: staffByEmail['dimas@bombbarbers.com'].id, branch_id: branches.utara.id },
      data: {
        id: ID.barber.dimas,
        staff_user_id: staffByEmail['dimas@bombbarbers.com'].id,
        branch_id: branches.utara.id,
        display_name: 'Dimas Colorist',
        bio: 'Konsultasi warna rambut, grooming pria, dan style transformation.',
        rating_avg: '4.80',
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
      match: { phone: '6281290001001' },
      data: { id: ID.customer.raka, full_name: 'Raka Pratama', phone: '6281290001001', email: 'raka.customer@example.com', password_hash: passwordHash, points_balance: 120, is_active: true }
    },
    {
      match: { phone: '6281290001002' },
      data: { id: ID.customer.dewi, full_name: 'Dewi Lestari', phone: '6281290001002', email: 'dewi.customer@example.com', password_hash: passwordHash, points_balance: 80, is_active: true }
    },
    {
      match: { phone: '6281290001003' },
      data: { id: ID.customer.fajar, full_name: 'Fajar Nugroho', phone: '6281290001003', email: 'fajar.customer@example.com', password_hash: passwordHash, points_balance: 35, is_active: true }
    }
  ]);

  return Object.fromEntries((customers as any[]).map((customer) => [customer.email, customer]));
}

async function seedServices(regions: Record<string, any>, branches: Record<string, any>) {
  console.log('Seeding services and prices...');

  const services = await upsertRowsBy('services', [
    {
      match: { name: 'Premium Haircut' },
      data: {
        id: ID.service.premiumHaircut,
        name: 'Premium Haircut',
        description: 'Potong rambut premium, hair wash, blow dry, dan pomade finishing.',
        default_duration_min: 45,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1599351431202-1e0f0137899a.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Executive Haircut' },
      data: {
        id: ID.service.executiveHaircut,
        name: 'Executive Haircut',
        description: 'Potongan rapi untuk kebutuhan kerja, meeting, dan event formal.',
        default_duration_min: 40,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1517832606299-7ae9b720a186.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Skin Fade' },
      data: {
        id: ID.service.skinFade,
        name: 'Skin Fade',
        description: 'Fade detail dari nol dengan blending halus dan garis natural.',
        default_duration_min: 60,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1622287162716-f311baa1a2b8.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Beard Trim' },
      data: {
        id: ID.service.beardTrim,
        name: 'Beard Trim',
        description: 'Rapikan janggut, kumis, dan contour wajah dengan presisi.',
        default_duration_min: 30,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1621605815971-fbc98d665033.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Hair Wash & Styling' },
      data: {
        id: ID.service.hairWashStyling,
        name: 'Hair Wash & Styling',
        description: 'Keramas, tonic ringan, blow dry, dan styling untuk aktivitas harian.',
        default_duration_min: 25,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1522337360788-8b13dee7a37e.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Hair Coloring Consultation' },
      data: {
        id: ID.service.hairColoringConsultation,
        name: 'Hair Coloring Consultation',
        description: 'Konsultasi warna rambut, bleaching plan, dan estimasi treatment.',
        default_duration_min: 90,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1562322140-8baeececf3df.webp',
        is_active: true
      }
    },
    {
      match: { name: 'Kids Haircut' },
      data: {
        id: ID.service.kidsHaircut,
        name: 'Kids Haircut',
        description: 'Potong rambut anak dengan proses yang cepat, ramah, dan nyaman.',
        default_duration_min: 30,
        image_url: 'http://localhost:3000/public/uploads/services/photo-1605497788044-5a32c7078486.webp',
        is_active: true
      }
    }
  ]);

  const byName = Object.fromEntries((services as any[]).map((service) => [service.name, service]));

  const defaultPrices: Record<string, number> = {
    'Premium Haircut': 75000,
    'Executive Haircut': 65000,
    'Skin Fade': 90000,
    'Beard Trim': 40000,
    'Hair Wash & Styling': 30000,
    'Hair Coloring Consultation': 150000,
    'Kids Haircut': 45000
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

  await upsertRowsBy('service_prices', [
    {
      match: { service_id: byName['Premium Haircut'].id, branch_id: branches.ancol.id },
      data: { service_id: byName['Premium Haircut'].id, branch_id: branches.ancol.id, region_id: null, price_amount: 80000, effective_from: EFFECTIVE_FROM, effective_to: null }
    },
    {
      match: { service_id: byName['Skin Fade'].id, branch_id: branches.ancol.id },
      data: { service_id: byName['Skin Fade'].id, branch_id: branches.ancol.id, region_id: null, price_amount: 95000, effective_from: EFFECTIVE_FROM, effective_to: null }
    },
    {
      match: { service_id: byName['Premium Haircut'].id, branch_id: branches.utara.id },
      data: { service_id: byName['Premium Haircut'].id, branch_id: branches.utara.id, region_id: null, price_amount: 90000, effective_from: EFFECTIVE_FROM, effective_to: null }
    }
  ]);

  return byName;
}

async function seedProducts(branches: Record<string, any>) {
  console.log('Seeding products and branch inventory...');

  const products = await upsertRowsBy('products', [
    {
      match: { sku: 'BB-POMADE-MATTE-75' },
      data: { sku: 'BB-POMADE-MATTE-75', name: 'Bomb Matte Pomade 75g', description: 'Pomade matte finish untuk daily styling.', base_price: 65000 }
    },
    {
      match: { sku: 'BB-HAIRTONIC-100' },
      data: { sku: 'BB-HAIRTONIC-100', name: 'Bomb Hair Tonic 100ml', description: 'Hair tonic ringan setelah haircut.', base_price: 55000 }
    },
    {
      match: { sku: 'BB-SHAMPOO-250' },
      data: { sku: 'BB-SHAMPOO-250', name: 'Bomb Daily Shampoo 250ml', description: 'Shampoo harian untuk rambut pria.', base_price: 85000 }
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
      match: { title: 'Fresh Cut, Fresh Look' },
      data: {
        title: 'Fresh Cut, Fresh Look',
        subtitle: 'Booking premium haircut langsung dari aplikasi Bomb Barbershop.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1503951914875-452162b0f3f1.webp',
        target_url: '/booking',
        is_active: true,
        sort_order: 1,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    },
    {
      match: { title: 'Fade Week di Ancol' },
      data: {
        title: 'Fade Week di Ancol',
        subtitle: 'Pilih barber favorit dan cek slot tersedia untuk skin fade.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1622287162716-f311baa1a2b8.webp',
        target_url: `/branches/${branches.ancol.id}/services`,
        is_active: true,
        sort_order: 2,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    },
    {
      match: { title: 'Beard Trim Specialist' },
      data: {
        title: 'Beard Trim Specialist',
        subtitle: 'Rapikan beard style dengan barber pilihan cabang terdekat.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1621605815971-fbc98d665033.webp',
        target_url: '/services?search=beard',
        is_active: true,
        sort_order: 3,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    }
  ]);

  await upsertRowsBy('barber_portfolios', [
    {
      match: { barber_id: barbers['Budi Fade Master'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp' },
      data: { barber_id: barbers['Budi Fade Master'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp', caption: 'Clean fade dengan tekstur natural.' }
    },
    {
      match: { barber_id: barbers['Budi Fade Master'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp' },
      data: { barber_id: barbers['Budi Fade Master'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp', caption: 'Classic cut rapi untuk tampilan kantor.' }
    },
    {
      match: { barber_id: barbers['Andi Classic'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp' },
      data: { barber_id: barbers['Andi Classic'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp', caption: 'Beard trim presisi dengan garis natural.' }
    },
    {
      match: { barber_id: barbers['Reza Texture Pro'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp' },
      data: { barber_id: barbers['Reza Texture Pro'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp', caption: 'Textured crop dengan styling ringan.' }
    }
  ]);

  const raka = customers['raka.customer@example.com'];
  await upsertRowsBy('notifications', [
    {
      match: { recipient_id: raka.id, type: 'promo', title: 'Fade Week sudah aktif' },
      data: {
        user_id: raka.id,
        recipient_id: raka.id,
        recipient_type: 'customer',
        type: 'promo',
        title: 'Fade Week sudah aktif',
        message: 'Nikmati slot skin fade bersama Budi Fade Master di cabang Ancol.',
        body: 'Nikmati slot skin fade bersama Budi Fade Master di cabang Ancol.',
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

  const completedAppointment = await upsertBy('appointments', {
    branch_id: branches.ancol.id,
    customer_id: customers['raka.customer@example.com'].id,
    scheduled_at: atJakartaTime(yesterday, '16:00:00')
  }, {
    branch_id: branches.ancol.id,
    barber_id: barbers['Budi Fade Master'].id,
    customer_id: customers['raka.customer@example.com'].id,
    source: 'online_booking',
    status: 'completed',
    scheduled_at: atJakartaTime(yesterday, '16:00:00'),
    queue_position: null,
    checked_in_at: atJakartaTime(yesterday, '15:55:00'),
    started_at: atJakartaTime(yesterday, '16:03:00'),
    completed_at: atJakartaTime(yesterday, '16:49:00'),
    customer_media_urls: []
  });

  await upsertRowsBy('appointment_services', [
    {
      match: { appointment_id: completedAppointment.id, service_id: services['Premium Haircut'].id },
      data: { appointment_id: completedAppointment.id, service_id: services['Premium Haircut'].id, price_amount: 80000, duration_min: 45 }
    },
    {
      match: { appointment_id: completedAppointment.id, service_id: services['Beard Trim'].id },
      data: { appointment_id: completedAppointment.id, service_id: services['Beard Trim'].id, price_amount: 40000, duration_min: 30 }
    }
  ]);

  await upsertBy('appointment_products', {
    appointment_id: completedAppointment.id,
    product_id: products['BB-POMADE-MATTE-75'].id
  }, {
    appointment_id: completedAppointment.id,
    product_id: products['BB-POMADE-MATTE-75'].id,
    quantity: 1,
    unit_price: 65000
  });

  const payment = await upsertBy('payments', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    branch_id: branches.ancol.id,
    total_amount: 190000,
    service_amount: 120000,
    product_amount: 65000,
    discount_amount: 10000,
    tip_amount: 15000,
    method: 'qris',
    status: 'paid',
    gateway_reference: 'QRIS-DEMO-0001',
    paid_at: atJakartaTime(yesterday, '16:52:00')
  });

  await upsertBy('invoices', { payment_id: payment.id }, {
    payment_id: payment.id,
    invoice_number: `INV-${dateOnly(yesterday).replace(/-/g, '')}-0001`,
    issued_at: atJakartaTime(yesterday, '16:53:00'),
    pdf_url: null
  });

  await upsertBy('commission_entries', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    commission_rule_id: globalRule.id,
    base_amount: 120000,
    barber_share: 48000,
    branch_share: 48000,
    hq_share: 24000,
    tip_amount: 15000,
    calculated_at: atJakartaTime(yesterday, '16:54:00')
  });

  await upsertBy('reviews', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    customer_id: customers['raka.customer@example.com'].id,
    barber_id: barbers['Budi Fade Master'].id,
    rating: '5.00',
    comment: 'Fade rapi, booking tepat waktu, dan pomade finish bagus.'
  });

  const inQueueAppointment = await upsertBy('appointments', {
    branch_id: branches.ancol.id,
    customer_id: customers['dewi.customer@example.com'].id,
    scheduled_at: atJakartaTime(now, '10:00:00')
  }, {
    branch_id: branches.ancol.id,
    barber_id: barbers['Andi Classic'].id,
    customer_id: customers['dewi.customer@example.com'].id,
    source: 'walk_in',
    status: 'in_queue',
    scheduled_at: atJakartaTime(now, '10:00:00'),
    queue_position: 1,
    checked_in_at: atJakartaTime(now, '09:55:00'),
    customer_media_urls: []
  });

  await upsertBy('appointment_services', {
    appointment_id: inQueueAppointment.id,
    service_id: services['Hair Wash & Styling'].id
  }, {
    appointment_id: inQueueAppointment.id,
    service_id: services['Hair Wash & Styling'].id,
    price_amount: 30000,
    duration_min: 25
  });

  await upsertBy('check_ins', { appointment_id: inQueueAppointment.id }, {
    appointment_id: inQueueAppointment.id,
    method: 'manual',
    location_lat: -6.260721,
    location_lng: 106.813911,
    checked_in_at: atJakartaTime(now, '09:55:00')
  });

  // Andi sedang mengerjakan order — update live_status sesuai appointment aktif
  await upsertBy('barbers', { id: barbers['Andi Classic'].id }, { live_status: 'serving' });

  const confirmedAppointment = await upsertBy('appointments', {
    branch_id: branches.ancol.id,
    customer_id: customers['fajar.customer@example.com'].id,
    scheduled_at: atJakartaTime(tomorrow, '10:00:00')
  }, {
    branch_id: branches.ancol.id,
    barber_id: barbers['Budi Fade Master'].id,
    customer_id: customers['fajar.customer@example.com'].id,
    source: 'online_booking',
    status: 'confirmed',
    scheduled_at: atJakartaTime(tomorrow, '10:00:00'),
    queue_position: 2,
    customer_media_urls: [
      'http://localhost:3000/public/uploads/appointments/photo-1517832606299-7ae9b720a186.webp'
    ]
  });

  await upsertBy('appointment_services', {
    appointment_id: confirmedAppointment.id,
    service_id: services['Skin Fade'].id
  }, {
    appointment_id: confirmedAppointment.id,
    service_id: services['Skin Fade'].id,
    price_amount: 95000,
    duration_min: 60
  });

  await upsertBy('tracking_sessions', { appointment_id: confirmedAppointment.id }, {
    appointment_id: confirmedAppointment.id,
    status: 'active',
    consent_given_at: new Date().toISOString(),
    expires_at: atJakartaTime(tomorrow, '12:00:00')
  });

  const pendingAppointment = await upsertBy('appointments', {
    branch_id: branches.utara.id,
    customer_id: customers['raka.customer@example.com'].id,
    scheduled_at: atJakartaTime(nextDay, '11:30:00')
  }, {
    branch_id: branches.utara.id,
    barber_id: barbers['Reza Texture Pro'].id,
    customer_id: customers['raka.customer@example.com'].id,
    source: 'online_booking',
    status: 'pending',
    scheduled_at: atJakartaTime(nextDay, '11:30:00'),
    queue_position: 1,
    customer_media_urls: []
  });

  await upsertBy('appointment_services', {
    appointment_id: pendingAppointment.id,
    service_id: services['Executive Haircut'].id
  }, {
    appointment_id: pendingAppointment.id,
    service_id: services['Executive Haircut'].id,
    price_amount: 65000,
    duration_min: 40
  });

  await upsertBy('cash_drawer_sessions', {
    branch_id: branches.ancol.id,
    opened_at: atJakartaTime(now, '08:45:00')
  }, {
    branch_id: branches.ancol.id,
    opened_at: atJakartaTime(now, '08:45:00'),
    closed_at: null,
    starting_cash: 1000000,
    ending_cash: null,
    expected_cash: 1030000,
    difference: null,
    status: 'open'
  });

  await upsertBy('branch_expenses', {
    branch_id: branches.ancol.id,
    expense_date: dateOnly(now),
    description: 'Pembelian towel dan disinfectant harian'
  }, {
    branch_id: branches.ancol.id,
    expense_date: dateOnly(now),
    amount: 275000,
    description: 'Pembelian towel dan disinfectant harian'
  });

  await upsertBy('daily_branch_summaries', {
    branch_id: branches.ancol.id,
    summary_date: dateOnly(yesterday)
  }, {
    branch_id: branches.ancol.id,
    summary_date: dateOnly(yesterday),
    total_revenue: 190000,
    total_appointments: 1,
    walk_in_count: 0,
    booking_count: 1,
    no_show_count: 0,
    hq_share_total: 24000,
    branch_share_total: 48000
  });

  await upsertBy('barber_daily_stats', {
    barber_id: barbers['Budi Fade Master'].id,
    branch_id: branches.ancol.id,
    summary_date: dateOnly(yesterday)
  }, {
    barber_id: barbers['Budi Fade Master'].id,
    branch_id: branches.ancol.id,
    summary_date: dateOnly(yesterday),
    heads_count: 1,
    revenue: 120000,
    commission_earned: 63000,
    avg_rating: '5.00'
  });

  await upsertRowsBy('audit_logs', [
    {
      match: { entity_type: 'payment', entity_id: payment.id, action: 'payment_paid' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.ancol@bombbarbers.com'].id,
        action: 'payment_paid',
        entity_type: 'payment',
        entity_id: payment.id,
        before: { status: 'pending' },
        after: { status: 'paid', total_amount: 190000, method: 'qris' }
      }
    },
    {
      match: { entity_type: 'appointment', entity_id: completedAppointment.id, action: 'appointment_completed' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.ancol@bombbarbers.com'].id,
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
    message: 'Skin Fade di Bomb Barbershop Jakarta Ancol sudah dikonfirmasi untuk besok pukul 10.00.',
    body: 'Skin Fade di Bomb Barbershop Jakarta Ancol sudah dikonfirmasi untuk besok pukul 10.00.',
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
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
