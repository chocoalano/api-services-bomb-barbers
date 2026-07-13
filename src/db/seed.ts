import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { and, eq, ne, isNull, is, Table, getTableName, getTableColumns } from 'drizzle-orm';
import { db, pool } from '../lib/db';
import { logger } from '../lib/logger';
import { snakeKeys, camelKeys, toDbDate } from './helpers';
import * as baseSchema from './schema';
import * as extraSchema from './schema-extra';

// Registry nama-tabel-SQL → objek tabel Drizzle (agar helper generik seed tetap
// bisa menerima nama tabel string (helper generik).
const ALL_TABLES = { ...baseSchema, ...extraSchema } as Record<string, any>;
const TABLE_BY_NAME: Record<string, any> = {};
for (const val of Object.values(ALL_TABLES)) {
  if (is(val, Table)) TABLE_BY_NAME[getTableName(val)] = val;
}
function tableFor(name: string): any {
  const t = TABLE_BY_NAME[name];
  if (!t) throw new Error(`Tabel tidak dikenal di schema: ${name}`);
  return t;
}

// Kolom datetime & decimal per tabel (di-cache) untuk normalisasi nilai:
// datetime ISO → format MySQL; decimal number → string.
const dtCache = new Map<string, Set<string>>();
const decCache = new Map<string, Set<string>>();
function typedCols(name: string, cache: Map<string, Set<string>>, prefix: string): Set<string> {
  if (cache.has(name)) return cache.get(name)!;
  const set = new Set<string>();
  for (const [key, col] of Object.entries(getTableColumns(tableFor(name)))) {
    if (String((col as any).getSQLType?.() ?? '').startsWith(prefix)) set.add(key);
  }
  cache.set(name, set);
  return set;
}
function normalizeValues(name: string, snakeObj: Record<string, any>): Record<string, any> {
  const camel = camelKeys(snakeObj);
  for (const k of typedCols(name, dtCache, 'datetime')) {
    if (camel[k] != null) camel[k] = toDbDate(camel[k]);
  }
  for (const k of typedCols(name, decCache, 'decimal')) {
    if (typeof camel[k] === 'number') camel[k] = String(camel[k]);
  }
  return camel;
}
function whereForMatch(name: string, match: Record<string, any>) {
  const cols = getTableColumns(tableFor(name));
  const camel = camelKeys(match);
  const conds = Object.entries(camel).map(([k, v]) =>
    v === null ? isNull((cols as any)[k]) : eq((cols as any)[k], v)
  );
  return conds.length ? and(...conds) : undefined;
}

const DEMO_PASSWORD = 'password123';
const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';

// UUIDs tetap agar ID tidak berubah setiap kali reset+seed.
// Flutter app bisa menyimpan ID ini tanpa khawatir berubah.
const ID = {
  region: { jakarta: '10000001-0000-4000-8000-000000000001' },
  branch: {
    kedoya: '20000001-0000-4000-8000-000000000001',
  },
  service: {
    haircutPremium: '30000001-0000-4000-8000-000000000001',
  },
  staff: {
    hq: '40000001-0000-4000-8000-000000000001',
    adminKedoya: '40000001-0000-4000-8000-000000000002',
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

async function findOne(table: string, match: RecordData) {
  const t = tableFor(table);
  const [row] = await db.select().from(t).where(whereForMatch(table, match)).limit(1);
  return row ? snakeKeys(row) : null;
}

async function findById(table: string, id: string) {
  const t = tableFor(table);
  const cols = getTableColumns(t);
  const [row] = await db.select().from(t).where(eq((cols as any).id, id)).limit(1);
  return row ? snakeKeys(row) : null;
}

async function upsertBy(table: string, match: RecordData, data: RecordData) {
  const t = tableFor(table);
  const existing = await findOne(table, match);

  if (existing) {
    const { id: _id, ...updateData } = data;
    if (Object.keys(updateData).length > 0) {
      await db.update(t).set(normalizeValues(table, updateData)).where(whereForMatch(table, match));
    }
    return findById(table, existing.id);
  }

  const id = (data.id ?? match.id ?? randomUUID()) as string;
  await db.insert(t).values({ ...normalizeValues(table, data), id } as any);
  return findById(table, id);
}

async function upsertRowsBy(table: string, rows: Array<{ match: RecordData; data: RecordData }>) {
  const result = [];

  for (const row of rows) {
    result.push(await upsertBy(table, row.match, row.data));
  }

  return result;
}

async function resetServicesToHaircutPremiumOnly(): Promise<void> {
  // Bersihkan relasi service lama dulu supaya foreign key tidak menahan delete service.
  await db.delete(baseSchema.appointmentServices).where(ne(baseSchema.appointmentServices.serviceId, ID.service.haircutPremium));
  // Reset seluruh harga service, lalu seed ulang hanya harga Haircut Premium Rp100.000.
  await db.delete(baseSchema.servicePrices).where(ne(baseSchema.servicePrices.serviceId, ID.service.haircutPremium));
  await db.delete(baseSchema.servicePrices).where(eq(baseSchema.servicePrices.serviceId, ID.service.haircutPremium));
  // Hapus semua service selain Haircut Premium.
  await db.delete(baseSchema.services).where(ne(baseSchema.services.id, ID.service.haircutPremium));
}

async function resetAppointmentToHaircutPremiumOnly(
  appointmentId: string,
  serviceId: string,
): Promise<void> {
  await db.delete(baseSchema.appointmentServices).where(eq(baseSchema.appointmentServices.appointmentId, appointmentId));

  await upsertBy('appointment_services', {
    appointment_id: appointmentId,
    service_id: serviceId,
  }, {
    appointment_id: appointmentId,
    service_id: serviceId,
    price_amount: 100000,
    duration_min: 45,
  });
}

async function deleteAppointmentProducts(appointmentId: string): Promise<void> {
  await db.delete(baseSchema.appointmentProducts).where(eq(baseSchema.appointmentProducts.appointmentId, appointmentId));
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
    'manage_users',
    'manage_roles',
    'manage_barber',
    'manage_service',
    'manage_appointment',
    'manage_payment',
    'manage_commission',
    'view_audit_log',
    'view_customers'
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
    branch_admin: ['manage_barber', 'manage_appointment', 'manage_payment', 'manage_commission', 'view_audit_log', 'view_customers'],
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

  // Cabang utama — alamat resmi dari bomb.com
  const kedoya = await upsertBy('branches', { id: ID.branch.kedoya }, {
    id: ID.branch.kedoya,
    region_id: jakarta.id,
    name: 'Bomb Barbershop Kedoya',
    address: 'Jl. Taman Ratu Indah Blk. BB1 No.3A 3, RT.3/RW.11, Kedoya Utara, Jakarta Barat 11520',
    phone: '6281322096650',
    latitude: -6.1561043,
    longitude: 106.6157188,
    is_active: true
  });

  const branches = { kedoya };

  // [REVISI B7] Jam operasional 08:00–22:00 setiap hari (slot kelipatan 2 jam).
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    await upsertBy('branch_operating_hours', {
      branch_id: kedoya.id,
      day_of_week: day
    }, {
      branch_id: kedoya.id,
      day_of_week: day,
      open_time: '08:00:00',
      close_time: '22:00:00'
    });
  }

  await upsertBy('branch_photos', {
    branch_id: kedoya.id,
    url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp'
  }, {
    branch_id: kedoya.id,
    url: 'http://localhost:3000/public/uploads/branches/photo-1585747860715-2ba37e788b70.webp',
    sort_order: 1
  });

  return { branches };
}

async function seedStaff(roleByName: Record<string, any>, branches: Record<string, any>, passwordHash: string) {
  console.log('Seeding staff users, roles, and barber profiles...');

  // Staff: Jordan (owner dari website), Davies & Barron (barbers dari website), + demo staff
  const staffRows = await upsertRowsBy('staff_users', [
    {
      match: { id: ID.staff.hq },
      data: { id: ID.staff.hq, full_name: 'Jordan', email: 'jordan@bomb.com', phone: '6281322096650', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.adminKedoya },
      data: { id: ID.staff.adminKedoya, full_name: 'Nadia Kedoya Admin', email: 'admin.kedoya@bomb.com', phone: '6281322096652', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.davies },
      data: { id: ID.staff.davies, full_name: 'Davies', email: 'davies@bomb.com', phone: '6281322096654', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.barron },
      data: { id: ID.staff.barron, full_name: 'Barron', email: 'barron@bomb.com', phone: '6281322096655', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.reza },
      data: { id: ID.staff.reza, full_name: 'Reza Mahendra', email: 'reza@bomb.com', phone: '6281322096656', password_hash: passwordHash, is_active: true }
    },
    {
      match: { id: ID.staff.dimas },
      data: { id: ID.staff.dimas, full_name: 'Dimas Wicaksono', email: 'dimas@bomb.com', phone: '6281322096657', password_hash: passwordHash, is_active: true }
    }
  ]);

  const staffByEmail = Object.fromEntries(staffRows.map((staff: any) => [staff.email, staff]));

  await upsertRowsBy('staff_user_roles', [
    {
      match: { staff_user_id: staffByEmail['jordan@bomb.com'].id, role_id: roleByName.super_admin.id, branch_id: null },
      data: { staff_user_id: staffByEmail['jordan@bomb.com'].id, role_id: roleByName.super_admin.id, branch_id: null }
    },
    {
      match: { staff_user_id: staffByEmail['admin.kedoya@bomb.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.kedoya.id },
      data: { staff_user_id: staffByEmail['admin.kedoya@bomb.com'].id, role_id: roleByName.branch_admin.id, branch_id: branches.kedoya.id }
    },
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
        staff_user_id: staffByEmail['davies@bomb.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Davies',
        bio: 'Spesialis Haircut Premium, skin fade, dan classic gentleman cut. Berpengalaman 5+ tahun.',
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
        staff_user_id: staffByEmail['barron@bomb.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Barron',
        bio: 'Stylist senior untuk Haircut Premium, konsultasi gaya, dan grooming transformation.',
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
        staff_user_id: staffByEmail['reza@bomb.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Reza',
        bio: 'Fokus pada Haircut Premium dengan detail potongan bersih dan rapi.',
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
        staff_user_id: staffByEmail['dimas@bomb.com'].id,
        branch_id: branches.kedoya.id,
        display_name: 'Dimas',
        bio: 'Barber serba bisa untuk Haircut Premium dan styling profesional harian.',
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
      data: { id: ID.customer.raka, full_name: 'Raka Pratama', phone: '6281290001001', email: 'raka@customer.com', password_hash: passwordHash, points_balance: 120, is_active: true }
    },
    {
      match: { id: ID.customer.dewi },
      data: { id: ID.customer.dewi, full_name: 'Dewi Lestari', phone: '6281290001002', email: 'dewi@customer.com', password_hash: passwordHash, points_balance: 80, is_active: true }
    },
    {
      match: { id: ID.customer.fajar },
      data: { id: ID.customer.fajar, full_name: 'Fajar Nugroho', phone: '6281290001003', email: 'fajar@customer.com', password_hash: passwordHash, points_balance: 35, is_active: true }
    }
  ]);

  return Object.fromEntries((customers as any[]).map((customer) => [customer.email, customer]));
}

async function seedServices(_branches: Record<string, any>) {
  console.log('Seeding service and price: Haircut Premium only...');

  const haircutPremium = await upsertBy('services', {
    id: ID.service.haircutPremium
  }, {
    id: ID.service.haircutPremium,
    name: 'Haircut Premium',
    description: 'Layanan haircut premium dengan teknik potong presisi, konsultasi gaya, finishing, dan styling profesional.',
    default_duration_min: 45,
    image_url: 'http://localhost:3000/public/uploads/services/photo-1599351431202-1e0f0137899a.webp',
    is_active: true
  });

  await resetServicesToHaircutPremiumOnly();

  await upsertBy('service_prices', {
    service_id: haircutPremium.id,
    branch_id: null,
    region_id: null
  }, {
    service_id: haircutPremium.id,
    branch_id: null,
    region_id: null,
    price_amount: 100000,
    effective_from: EFFECTIVE_FROM,
    effective_to: null
  });

  return {
    'Haircut Premium': haircutPremium
  };
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
      match: { title: 'Haircut Premium' },
      data: {
        title: 'Haircut Premium',
        subtitle: 'Layanan Haircut Premium Rp100.000 di Bomb Barbershop. Booking langsung dari aplikasi.',
        image_url: 'http://localhost:3000/public/uploads/promotions/photo-1503951914875-452162b0f3f1.webp',
        target_url: `/branches/${branches.kedoya.id}/services`,
        is_active: true,
        sort_order: 1,
        starts_at: EFFECTIVE_FROM,
        ends_at: null
      }
    }
  ]);

  // Nonaktifkan seluruh promo lama yang masih menyebut service lain.
  await db.update(baseSchema.promotions).set({ isActive: false }).where(ne(baseSchema.promotions.title, 'Haircut Premium'));

  await upsertRowsBy('barber_portfolios', [
    {
      match: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp' },
      data: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1599351431202-1e0f0137899a.webp', caption: 'Haircut Premium presisi dengan finishing natural.' }
    },
    {
      match: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp' },
      data: { barber_id: barbers['Davies'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1622286342621-4bd786c2447c.webp', caption: 'Haircut Premium rapi untuk kebutuhan profesional.' }
    },
    {
      match: { barber_id: barbers['Barron'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp' },
      data: { barber_id: barbers['Barron'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1621605815971-fbc98d665033.webp', caption: 'Haircut Premium dengan konsultasi gaya personal.' }
    },
    {
      match: { barber_id: barbers['Reza'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp' },
      data: { barber_id: barbers['Reza'].id, image_url: 'http://localhost:3000/public/uploads/portfolios/photo-1517832606299-7ae9b720a186.webp', caption: 'Haircut Premium dengan detail potongan yang bersih.' }
    }
  ]);

  const raka = customers['raka@customer.com'];

  await upsertRowsBy('notifications', [
    {
      match: { recipient_id: raka.id, type: 'promo', title: 'Haircut Premium — Rp100.000' },
      data: {
        user_id: raka.id,
        recipient_id: raka.id,
        recipient_type: 'customer',
        type: 'promo',
        title: 'Haircut Premium — Rp100.000',
        message: 'Booking Haircut Premium di Bomb Barbershop Kedoya. Harga tetap Rp100.000.',
        body: 'Booking Haircut Premium di Bomb Barbershop Kedoya. Harga tetap Rp100.000.',
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

  const { branches, barbers, customers, services, globalRule, staffByEmail } = context;
  const haircutPremium = services['Haircut Premium'];

  const now = new Date();
  const yesterday = addDays(now, -1);
  const tomorrow = addDays(now, 1);
  const nextDay = addDays(now, 2);

  // Appointment selesai kemarin: Raka — Haircut Premium di Kedoya oleh Davies
  const completedAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['raka@customer.com'].id,
    scheduled_at: atJakartaTime(yesterday, '14:00:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Davies'].id,
    customer_id: customers['raka@customer.com'].id,
    source: 'online_booking',
    status: 'completed',
    scheduled_at: atJakartaTime(yesterday, '14:00:00'),
    queue_position: null,
    checked_in_at: atJakartaTime(yesterday, '13:55:00'),
    started_at: atJakartaTime(yesterday, '14:03:00'),
    completed_at: atJakartaTime(yesterday, '14:48:00'),
    customer_media_urls: []
  });

  await resetAppointmentToHaircutPremiumOnly(completedAppointment.id, haircutPremium.id);
  await deleteAppointmentProducts(completedAppointment.id);

  // service_amount: 100k; product: 0; service_fee: 5k; tip: 50k
  // total: 100k + 5k + 50k = 155k
  const payment = await upsertBy('payments', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    branch_id: branches.kedoya.id,
    total_amount: 155000,
    service_amount: 100000,
    product_amount: 0,
    service_fee: 5000,
    delivery_fee: 0,
    discount_amount: 0,
    tip_amount: 50000,
    method: 'qris',
    status: 'paid',
    gateway_reference: 'QRIS-DEMO-0001',
    paid_at: atJakartaTime(yesterday, '14:53:00')
  });

  await upsertBy('invoices', { payment_id: payment.id }, {
    payment_id: payment.id,
    invoice_number: `INV-${dateOnly(yesterday).replace(/-/g, '')}-0001`,
    issued_at: atJakartaTime(yesterday, '14:54:00'),
    pdf_url: null
  });

  // Komisi dari service amount 100k: barber 40% = 40k, branch 40% = 40k, HQ 20% = 20k; tip 50k ke barber.
  await upsertBy('commission_entries', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    commission_rule_id: globalRule.id,
    base_amount: 100000,
    barber_share: 40000,
    branch_share: 40000,
    hq_share: 20000,
    tip_amount: 50000,
    calculated_at: atJakartaTime(yesterday, '14:55:00')
  });

  await upsertBy('reviews', { appointment_id: completedAppointment.id }, {
    appointment_id: completedAppointment.id,
    customer_id: customers['raka@customer.com'].id,
    barber_id: barbers['Davies'].id,
    rating: '5.00',
    comment: 'Haircut Premium rapi banget. Davies sangat profesional dan detail.'
  });

  // Appointment aktif hari ini: Dewi — Haircut Premium di Kedoya oleh Barron
  const inQueueAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['dewi@customer.com'].id,
    scheduled_at: atJakartaTime(now, '10:30:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Barron'].id,
    customer_id: customers['dewi@customer.com'].id,
    source: 'walk_in',
    status: 'in_queue',
    scheduled_at: atJakartaTime(now, '10:30:00'),
    queue_position: 1,
    checked_in_at: atJakartaTime(now, '10:25:00'),
    customer_media_urls: []
  });

  await resetAppointmentToHaircutPremiumOnly(inQueueAppointment.id, haircutPremium.id);
  await deleteAppointmentProducts(inQueueAppointment.id);

  await upsertBy('check_ins', { appointment_id: inQueueAppointment.id }, {
    appointment_id: inQueueAppointment.id,
    method: 'manual',
    location_lat: -6.1561043,
    location_lng: 106.6157188,
    checked_in_at: atJakartaTime(now, '10:25:00')
  });

  await upsertBy('barbers', { id: barbers['Barron'].id }, { live_status: 'serving' });

  // Appointment confirmed besok: Fajar — Haircut Premium di Kedoya oleh Davies
  const confirmedAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['fajar@customer.com'].id,
    scheduled_at: atJakartaTime(tomorrow, '11:00:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Davies'].id,
    customer_id: customers['fajar@customer.com'].id,
    source: 'online_booking',
    status: 'confirmed',
    scheduled_at: atJakartaTime(tomorrow, '11:00:00'),
    queue_position: 2,
    customer_media_urls: [
      'http://localhost:3000/public/uploads/appointments/photo-1517832606299-7ae9b720a186.webp'
    ]
  });

  await resetAppointmentToHaircutPremiumOnly(confirmedAppointment.id, haircutPremium.id);
  await deleteAppointmentProducts(confirmedAppointment.id);

  await upsertBy('tracking_sessions', { appointment_id: confirmedAppointment.id }, {
    appointment_id: confirmedAppointment.id,
    status: 'active',
    consent_given_at: new Date().toISOString(),
    expires_at: atJakartaTime(tomorrow, '13:00:00')
  });

  // Appointment pending lusa: Raka — Haircut Premium di Kedoya oleh Reza
  const pendingAppointment = await upsertBy('appointments', {
    branch_id: branches.kedoya.id,
    customer_id: customers['raka@customer.com'].id,
    scheduled_at: atJakartaTime(nextDay, '13:00:00')
  }, {
    branch_id: branches.kedoya.id,
    barber_id: barbers['Reza'].id,
    customer_id: customers['raka@customer.com'].id,
    source: 'online_booking',
    status: 'pending',
    scheduled_at: atJakartaTime(nextDay, '13:00:00'),
    queue_position: 1,
    customer_media_urls: []
  });

  await resetAppointmentToHaircutPremiumOnly(pendingAppointment.id, haircutPremium.id);
  await deleteAppointmentProducts(pendingAppointment.id);

  await upsertBy('cash_drawer_sessions', {
    branch_id: branches.kedoya.id,
    opened_at: atJakartaTime(now, '09:45:00')
  }, {
    branch_id: branches.kedoya.id,
    opened_at: atJakartaTime(now, '09:45:00'),
    closed_at: null,
    starting_cash: 2000000,
    ending_cash: null,
    expected_cash: 2000000,
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
    total_revenue: 155000,
    total_appointments: 1,
    walk_in_count: 0,
    booking_count: 1,
    no_show_count: 0,
    hq_share_total: 20000,
    branch_share_total: 40000
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
    revenue: 100000,
    commission_earned: 90000,
    avg_rating: '5.00'
  });

  await upsertRowsBy('audit_logs', [
    {
      match: { entity_type: 'payment', entity_id: payment.id, action: 'payment_paid' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.kedoya@bomb.com'].id,
        action: 'payment_paid',
        entity_type: 'payment',
        entity_id: payment.id,
        before: { status: 'pending' },
        after: { status: 'paid', total_amount: 155000, service_fee: 5000, delivery_fee: 0, method: 'qris' }
      }
    },
    {
      match: { entity_type: 'appointment', entity_id: completedAppointment.id, action: 'appointment_completed' },
      data: {
        actor_type: 'staff',
        actor_id: staffByEmail['admin.kedoya@bomb.com'].id,
        action: 'appointment_completed',
        entity_type: 'appointment',
        entity_id: completedAppointment.id,
        before: { status: 'in_service' },
        after: { status: 'completed' }
      }
    }
  ]);

  const fajar = customers['fajar@customer.com'];

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
    message: 'Haircut Premium di Bomb Barbershop Kedoya sudah dikonfirmasi untuk besok pukul 11.00 bersama Davies.',
    body: 'Haircut Premium di Bomb Barbershop Kedoya sudah dikonfirmasi untuk besok pukul 11.00 bersama Davies.',
    is_read: false,
    sent_at: new Date().toISOString()
  });
}

async function main() {
  // Guard produksi (B5): seed menyuntik akun demo ber-password publik & meng-upsert
  // data referensi. Tolak di produksi kecuali dinyatakan eksplisit.
  const SEED_ALLOWED =
    process.argv.includes('--allow-prod') || process.env.ALLOW_PROD_SEED === 'yes';
  if (process.env.NODE_ENV === 'production' && !SEED_ALLOWED) {
    logger.error('[db:seed] Ditolak berjalan saat NODE_ENV=production tanpa konfirmasi eksplisit');
    console.error(
      '❌ db:seed menolak berjalan saat NODE_ENV=production karena menyuntik akun demo ' +
      'dengan password publik. Jika sengaja (mis. hanya data referensi), jalankan dengan --allow-prod.'
    );
    process.exit(1);
  }

  const isStarter = process.argv.includes('--starter');
  console.log(`Seeding Bomb Barbershop${isStarter ? ' (starter — tanpa data appointment)' : ''}...\n`);

  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const roleByName = await seedRolesAndPermissions();
  const { branches } = await seedRegionsAndBranches();
  const { staffByEmail, barbers, globalRule } = await seedStaff(roleByName, branches, passwordHash);
  const customers = await seedCustomers(passwordHash);
  const services = await seedServices(branches);
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
  console.log('\nDemo credentials (password: ' + DEMO_PASSWORD + '):');
  console.log('  HQ Owner  : jordan@bomb.com');
  console.log('  Admin     : admin.kedoya@bomb.com');
  console.log('  Barbers   : davies@bomb.com / barron@bomb.com / reza@bomb.com / dimas@bomb.com');
  console.log('  Customers : raka@customer.com / dewi@customer.com / fajar@customer.com');
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, '[db:seed] Seeding failed');
    console.error('Seeding failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
