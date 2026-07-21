// AUTO-GENERATED dari introspeksi schema. Drizzle mysql-core.
// Regenerate via scratchpad/gen-schema.ts if the source schema changes.
import { bigint, boolean, char, date, datetime, decimal, index, int, json, mysqlEnum, mysqlTable, text, time, unique, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const appointmentEvents = mysqlTable('appointment_events', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  fromStatus: mysqlEnum('from_status', ['pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show']),
  toStatus: mysqlEnum('to_status', ['pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show']).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(),
  actorId: char('actor_id', { length: 36 }),
  actorRole: varchar('actor_role', { length: 30 }),
  reason: text('reason').notNull(),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    appointmentEventsAppointmentCreatedIdx: index('appointment_events_appointment_created_idx').on(table.appointmentId, table.createdAt),
}));

export const appointmentProducts = mysqlTable('appointment_products', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  productId: char('product_id', { length: 36 }).notNull().references(() => products.id),
  quantity: int('quantity').notNull(),
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const appointmentServices = mysqlTable('appointment_services', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  serviceId: char('service_id', { length: 36 }).notNull().references(() => services.id),
  priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
  durationMin: int('duration_min').notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const appointments = mysqlTable('appointments', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  barberId: char('barber_id', { length: 36 }).references(() => barbers.id),
  customerId: char('customer_id', { length: 36 }).references(() => customers.id),
  source: mysqlEnum('source', ['online_booking', 'walk_in']).notNull(),
  status: mysqlEnum('status', ['pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show']).notNull(),
  scheduledAt: datetime('scheduled_at', { mode: 'string', fsp: 6 }),
  queuePosition: int('queue_position'),
  checkedInAt: datetime('checked_in_at', { mode: 'string', fsp: 6 }),
  startedAt: datetime('started_at', { mode: 'string', fsp: 6 }),
  completedAt: datetime('completed_at', { mode: 'string', fsp: 6 }),
  cancellationReason: text('cancellation_reason'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  customerMediaUrls: json('customer_media_urls').notNull().default([]),
  fulfillmentType: varchar('fulfillment_type', { length: 20 }).notNull().default("in_store"),
  serviceAddress: text('service_address'),
  destinationLatitude: decimal('destination_latitude', { precision: 10, scale: 8 }),
  destinationLongitude: decimal('destination_longitude', { precision: 11, scale: 8 }),
  locationNotes: text('location_notes'),
  journeyStatus: varchar('journey_status', { length: 30 }).notNull().default("not_started"),
  version: int('version').notNull().default(1),
  scheduledEndAt: datetime('scheduled_end_at', { mode: 'string', fsp: 6 }),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  travelBufferMin: int('travel_buffer_min').notNull().default(0),
  scheduleBlockStartAt: datetime('schedule_block_start_at', { mode: 'string', fsp: 6 }),
  scheduleBlockEndAt: datetime('schedule_block_end_at', { mode: 'string', fsp: 6 }),
  chatClearedAt: datetime('chat_cleared_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    appointmentsFulfillmentStatus: index('appointments_fulfillment_status').on(table.fulfillmentType, table.status, table.scheduledAt),
    appointmentsIdempotencyKeyUnique: unique('appointments_idempotency_key_unique').on(table.idempotencyKey),
    idxAppointmentsBarberStatus: index('idx_appointments_barber_status').on(table.barberId, table.status),
    idxAppointmentsBranchStatusDate: index('idx_appointments_branch_status_date').on(table.branchId, table.status, table.scheduledAt),
    appointmentsCustomerStatusSchedule: index('appointments_customer_status_schedule').on(table.customerId, table.status, table.scheduledAt),
}));

export const auditLogs = mysqlTable('audit_logs', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  actorType: varchar('actor_type', { length: 50 }).notNull(),
  actorId: char('actor_id', { length: 36 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: char('entity_id', { length: 36 }).notNull(),
  before: json('before'),
  after: json('after'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  branchId: char('branch_id', { length: 36 }).references(() => branches.id, { onDelete: 'set null' }),
}, (table) => ({
    idxAuditLogsBranchId: index('idx_audit_logs_branch_id').on(table.branchId),
}));

export const authEvents = mysqlTable('auth_events', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  userType: varchar('user_type', { length: 20 }).notNull(),
  userId: char('user_id', { length: 36 }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  success: boolean('success').notNull(),
  identifierHash: varchar('identifier_hash', { length: 64 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  metadata: json('metadata'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    authEventsCreatedAtIdx: index('auth_events_created_at_idx').on(table.createdAt),
    authEventsIdentifierIdx: index('auth_events_identifier_idx').on(table.identifierHash, table.createdAt),
}));

export const authSessions = mysqlTable('auth_sessions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  userType: varchar('user_type', { length: 20 }).notNull(),
  userId: char('user_id', { length: 36 }).notNull(),
  refreshJtiHash: varchar('refresh_jti_hash', { length: 64 }).notNull(),
  // Jti sebelumnya + batas waktunya: toleransi rotasi agar retry refresh yang
  // responsnya hilang di jaringan tidak dibaca sebagai pencurian token (yang
  // berujung sesi dicabut = logout tanpa sebab).
  prevRefreshJtiHash: varchar('prev_refresh_jti_hash', { length: 64 }),
  prevJtiExpiresAt: datetime('prev_jti_expires_at', { mode: 'string', fsp: 6 }),
  userAgent: text('user_agent'),
  ipHash: varchar('ip_hash', { length: 64 }),
  expiresAt: datetime('expires_at', { mode: 'string', fsp: 6 }).notNull(),
  lastUsedAt: datetime('last_used_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  revokedAt: datetime('revoked_at', { mode: 'string', fsp: 6 }),
  revokeReason: varchar('revoke_reason', { length: 100 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    authSessionsUserActiveIdx: index('auth_sessions_user_active_idx').on(table.userType, table.userId, table.expiresAt),
    // Pencabutan massal per akun mencari sesi aktif milik satu user.
    authSessionsUserRevokedIdx: index('auth_sessions_user_revoked_idx').on(table.userType, table.userId, table.revokedAt),
}));

export const barberDailyStats = mysqlTable('barber_daily_stats', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  summaryDate: date('summary_date', { mode: 'string' }).notNull(),
  headsCount: int('heads_count').default(0),
  revenue: bigint('revenue', { mode: 'number' }).default(0),
  commissionEarned: bigint('commission_earned', { mode: 'number' }).default(0),
  avgRating: decimal('avg_rating', { precision: 3, scale: 2 }).default('0'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    barberDailyStatsBarberDateUnique: unique('barber_daily_stats_barber_date_unique').on(table.barberId, table.summaryDate),
}));

export const barberOpenOrders = mysqlTable('barber_open_orders', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id, { onDelete: 'cascade' }),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id, { onDelete: 'cascade' }),
  orderDate: date('order_date', { mode: 'string' }).notNull(),
  startTime: time('start_time').notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    barberOpenOrdersUnique: unique('barber_open_orders_unique').on(table.barberId, table.orderDate, table.startTime),
    barberOpenOrdersBarberDateIdx: index('barber_open_orders_barber_date_idx').on(table.barberId, table.orderDate),
    barberOpenOrdersLookupIdx: index('barber_open_orders_lookup_idx').on(table.branchId, table.orderDate, table.startTime),
}));

export const barberPayouts = mysqlTable('barber_payouts', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id),
  periodStart: datetime('period_start', { mode: 'string', fsp: 6 }).notNull(),
  periodEnd: datetime('period_end', { mode: 'string', fsp: 6 }).notNull(),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  paidAt: datetime('paid_at', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const barberPortfolios = mysqlTable('barber_portfolios', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id),
  imageUrl: text('image_url').notNull(),
  caption: text('caption'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxBarberPortfoliosBarberCreatedAt: index('idx_barber_portfolios_barber_created_at').on(table.barberId, table.createdAt),
}));

export const barberTimeOff = mysqlTable('barber_time_off', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id),
  startAt: datetime('start_at', { mode: 'string', fsp: 6 }).notNull(),
  endAt: datetime('end_at', { mode: 'string', fsp: 6 }).notNull(),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).notNull().default("approved"),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    barberTimeOffBarberRangeIdx: index('barber_time_off_barber_range_idx').on(table.barberId, table.startAt, table.endAt),
}));

export const barberWallets = mysqlTable('barber_wallets', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id, { onDelete: 'cascade' }),
  balance: decimal('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    barberWalletsBarberIdKey: unique('barber_wallets_barber_id_key').on(table.barberId),
}));

export const barbers = mysqlTable('barbers', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  staffUserId: char('staff_user_id', { length: 36 }).notNull().references(() => staffUsers.id),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  bio: text('bio'),
  ratingAvg: decimal('rating_avg', { precision: 3, scale: 2 }).default('0'),
  ratingCount: int('rating_count').default(0),
  liveStatus: varchar('live_status', { length: 50 }).default("offline"),
  defaultCommissionRuleId: char('default_commission_rule_id', { length: 36 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
  serviceRadiusKm: int('service_radius_km').notNull().default(5),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default("approved"),
}, (table) => ({
    idxBarbersApprovalStatus: index('idx_barbers_approval_status').on(table.approvalStatus),
}));

export const branchExpenses = mysqlTable('branch_expenses', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  description: text('description').notNull(),
  expenseDate: date('expense_date', { mode: 'string' }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const branchInventory = mysqlTable('branch_inventory', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  productId: char('product_id', { length: 36 }).notNull().references(() => products.id),
  quantityOnHand: int('quantity_on_hand').default(0),
  reorderLevel: int('reorder_level').default(0),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const branchOperatingHours = mysqlTable('branch_operating_hours', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  dayOfWeek: int('day_of_week').notNull(),
  openTime: time('open_time').notNull(),
  closeTime: time('close_time').notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const branchPhotos = mysqlTable('branch_photos', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  url: text('url').notNull(),
  sortOrder: int('sort_order').default(0),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const branches = mysqlTable('branches', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  regionId: char('region_id', { length: 36 }).references(() => regions.id),
  name: varchar('name', { length: 255 }).notNull(),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  isActive: boolean('is_active').default(true),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
});

export const cashDrawerSessions = mysqlTable('cash_drawer_sessions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  openedAt: datetime('opened_at', { mode: 'string', fsp: 6 }).notNull(),
  closedAt: datetime('closed_at', { mode: 'string', fsp: 6 }),
  startingCash: bigint('starting_cash', { mode: 'number' }).notNull(),
  endingCash: bigint('ending_cash', { mode: 'number' }),
  expectedCash: bigint('expected_cash', { mode: 'number' }),
  difference: bigint('difference', { mode: 'number' }),
  status: varchar('status', { length: 50 }).notNull().default("open"),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const chatMessages = mysqlTable('chat_messages', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull(),
  senderId: char('sender_id', { length: 36 }).notNull(),
  senderRole: varchar('sender_role', { length: 20 }).notNull(),
  text: text('text').notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    idxChatMessagesAppointmentCreated: index('idx_chat_messages_appointment_created').on(table.appointmentId, table.createdAt),
}));

export const checkIns = mysqlTable('check_ins', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  method: varchar('method', { length: 50 }).notNull(),
  locationLat: decimal('location_lat', { precision: 10, scale: 8 }),
  locationLng: decimal('location_lng', { precision: 11, scale: 8 }),
  checkedInAt: datetime('checked_in_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  distanceM: decimal('distance_m', { precision: 10, scale: 2 }),
}, (table) => ({
    checkInsAppointmentUnique: unique('check_ins_appointment_unique').on(table.appointmentId),
}));

export const commissionEntries = mysqlTable('commission_entries', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  commissionRuleId: char('commission_rule_id', { length: 36 }).notNull().references(() => commissionRules.id),
  baseAmount: bigint('base_amount', { mode: 'number' }).notNull(),
  barberShare: bigint('barber_share', { mode: 'number' }).notNull(),
  branchShare: bigint('branch_share', { mode: 'number' }).notNull(),
  hqShare: bigint('hq_share', { mode: 'number' }).notNull(),
  tipAmount: bigint('tip_amount', { mode: 'number' }).default(0),
  calculatedAt: datetime('calculated_at', { mode: 'string', fsp: 6 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    commissionEntriesAppointmentIdUnique: unique('commission_entries_appointment_id_unique').on(table.appointmentId),
    idxCommissionEntriesAppointment: index('idx_commission_entries_appointment').on(table.appointmentId),
}));

export const commissionRules = mysqlTable('commission_rules', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  scope: mysqlEnum('scope', ['global', 'region', 'branch', 'barber', 'service']).notNull(),
  scopeRefId: char('scope_ref_id', { length: 36 }),
  barberPct: decimal('barber_pct', { precision: 5, scale: 2 }).notNull(),
  branchPct: decimal('branch_pct', { precision: 5, scale: 2 }).notNull(),
  hqPct: decimal('hq_pct', { precision: 5, scale: 2 }).notNull(),
  tipToBarber: boolean('tip_to_barber').default(true),
  effectiveFrom: datetime('effective_from', { mode: 'string', fsp: 6 }).notNull(),
  effectiveTo: datetime('effective_to', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});

export const customerAddresses = mysqlTable('customer_addresses', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  customerId: char('customer_id', { length: 36 }).notNull().references(() => customers.id, { onDelete: 'cascade' }),
  serviceAddress: text('service_address').notNull(),
  locationNotes: text('location_notes'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxCustomerAddressesCustomerId: index('idx_customer_addresses_customer_id').on(table.customerId, table.updatedAt),
}));

export const customerWalletTransactions = mysqlTable('customer_wallet_transactions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  walletId: char('wallet_id', { length: 36 }).notNull().references(() => customerWallets.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  referenceId: char('reference_id', { length: 36 }),
  description: text('description'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxCustomerWalletTransactionsWalletId: index('idx_customer_wallet_transactions_wallet_id').on(table.walletId),
}));

export const customerWallets = mysqlTable('customer_wallets', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  customerId: char('customer_id', { length: 36 }).notNull().references(() => customers.id, { onDelete: 'cascade' }),
  balance: decimal('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    customerWalletsCustomerIdUnique: unique('customer_wallets_customer_id_unique').on(table.customerId),
    idxCustomerWalletsCustomerId: index('idx_customer_wallets_customer_id').on(table.customerId),
}));

export const customerWithdrawals = mysqlTable('customer_withdrawals', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  customerId: char('customer_id', { length: 36 }).notNull().references(() => customers.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default("pending"),
  bankName: varchar('bank_name', { length: 100 }).notNull(),
  accountNumber: varchar('account_number', { length: 100 }).notNull(),
  accountName: varchar('account_name', { length: 150 }).notNull(),
  rejectionReason: text('rejection_reason'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxCustomerWithdrawalsCustomerId: index('idx_customer_withdrawals_customer_id').on(table.customerId),
}));

export const customers = mysqlTable('customers', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  email: varchar('email', { length: 255 }),
  pointsBalance: bigint('points_balance', { mode: 'number' }).default(0),
  isActive: boolean('is_active').default(true),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
  authId: char('auth_id', { length: 36 }),
  passwordHash: varchar('password_hash', { length: 255 }),
}, (table) => ({
    customersEmailUnique: unique('customers_email_unique').on(table.email),
    customersPhoneUnique: unique('customers_phone_unique').on(table.phone),
}));

export const dailyBranchSummaries = mysqlTable('daily_branch_summaries', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  summaryDate: date('summary_date', { mode: 'string' }).notNull(),
  totalRevenue: bigint('total_revenue', { mode: 'number' }).default(0),
  totalAppointments: int('total_appointments').default(0),
  walkInCount: int('walk_in_count').default(0),
  bookingCount: int('booking_count').default(0),
  noShowCount: int('no_show_count').default(0),
  hqShareTotal: bigint('hq_share_total', { mode: 'number' }).default(0),
  branchShareTotal: bigint('branch_share_total', { mode: 'number' }).default(0),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    dailyBranchSummariesBranchDateUnique: unique('daily_branch_summaries_branch_date_unique').on(table.branchId, table.summaryDate),
}));

export const inventoryMovements = mysqlTable('inventory_movements', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  productId: char('product_id', { length: 36 }).notNull().references(() => products.id),
  type: varchar('type', { length: 50 }).notNull(),
  quantity: int('quantity').notNull(),
  referenceId: char('reference_id', { length: 36 }),
  note: text('note'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const invoices = mysqlTable('invoices', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  paymentId: char('payment_id', { length: 36 }).notNull().references(() => payments.id),
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
  issuedAt: datetime('issued_at', { mode: 'string', fsp: 6 }).notNull(),
  pdfUrl: text('pdf_url'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  publicAccessTokenHash: varchar('public_access_token_hash', { length: 64 }),
  publicAccessExpiresAt: datetime('public_access_expires_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    invoicesInvoiceNumberUnique: unique('invoices_invoice_number_unique').on(table.invoiceNumber),
}));

export const mediaAssets = mysqlTable('media_assets', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  ownerType: varchar('owner_type', { length: 20 }).notNull(),
  ownerId: char('owner_id', { length: 36 }).notNull(),
  bucket: varchar('bucket', { length: 100 }).notNull(),
  objectPath: varchar('object_path', { length: 512 }).notNull(),
  visibility: varchar('visibility', { length: 20 }).notNull().default("private"),
  purpose: varchar('purpose', { length: 100 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: int('width'),
  height: int('height'),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    mediaAssetsObjectUnique: unique('media_assets_object_unique').on(table.bucket, table.objectPath),
    mediaAssetsOwnerIdx: index('media_assets_owner_idx').on(table.ownerType, table.ownerId, table.createdAt),
}));

export const notifications = mysqlTable('notifications', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  userId: char('user_id', { length: 36 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  recipientId: char('recipient_id', { length: 36 }),
  recipientType: varchar('recipient_type', { length: 50 }).default("customer"),
  type: varchar('type', { length: 50 }).default("general"),
  body: text('body'),
  sentAt: datetime('sent_at', { mode: 'string', fsp: 6 }).default(sql`CURRENT_TIMESTAMP(6)`),
  readAt: datetime('read_at', { mode: 'string', fsp: 6 }),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    idxNotificationsRecipientUnread: index('idx_notifications_recipient_unread').on(table.recipientType, table.recipientId, table.readAt, table.createdAt),
}));

export const payments = mysqlTable('payments', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  branchId: char('branch_id', { length: 36 }).notNull().references(() => branches.id),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
  serviceAmount: bigint('service_amount', { mode: 'number' }).notNull(),
  productAmount: bigint('product_amount', { mode: 'number' }).notNull(),
  discountAmount: bigint('discount_amount', { mode: 'number' }).default(0),
  tipAmount: bigint('tip_amount', { mode: 'number' }).default(0),
  method: mysqlEnum('method', ['cash', 'qris', 'card', 'bank_transfer', 'ewallet']).notNull(),
  status: mysqlEnum('status', ['pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded']).notNull(),
  gatewayReference: varchar('gateway_reference', { length: 255 }),
  paidAt: datetime('paid_at', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  serviceFee: bigint('service_fee', { mode: 'number' }).notNull().default(0),
  deliveryFee: bigint('delivery_fee', { mode: 'number' }).notNull().default(0),
}, (table) => ({
    paymentsAppointmentIdUnique: unique('payments_appointment_id_unique').on(table.appointmentId),
    idxPaymentsGatewayReference: index('idx_payments_gateway_reference').on(table.gatewayReference),
    idxPaymentsBranchPaidAt: index('idx_payments_branch_paid_at').on(table.branchId, table.paidAt),
}));

export const permissions = mysqlTable('permissions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  code: varchar('code', { length: 100 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    permissionsCodeUnique: unique('permissions_code_unique').on(table.code),
}));

export const products = mysqlTable('products', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull(),
  description: text('description'),
  basePrice: bigint('base_price', { mode: 'number' }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    productsSkuUnique: unique('products_sku_unique').on(table.sku),
}));

export const promotions = mysqlTable('promotions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  title: varchar('title', { length: 255 }).notNull(),
  subtitle: text('subtitle'),
  imageUrl: text('image_url'),
  targetUrl: text('target_url'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  startsAt: datetime('starts_at', { mode: 'string', fsp: 6 }),
  endsAt: datetime('ends_at', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    idxPromotionsActiveWindow: index('idx_promotions_active_window').on(table.isActive, table.startsAt, table.endsAt, table.sortOrder),
}));

export const refunds = mysqlTable('refunds', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  paymentId: char('payment_id', { length: 36 }).notNull().references(() => payments.id),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  processedBy: char('processed_by', { length: 36 }).references(() => staffUsers.id),
  processedAt: datetime('processed_at', { mode: 'string', fsp: 6 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const regions = mysqlTable('regions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    regionsCodeUnique: unique('regions_code_unique').on(table.code),
}));

export const reviews = mysqlTable('reviews', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  customerId: char('customer_id', { length: 36 }).notNull().references(() => customers.id),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id),
  rating: decimal('rating', { precision: 3, scale: 2 }).notNull(),
  comment: text('comment'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    reviewsAppointmentIdUnique: unique('reviews_appointment_id_unique').on(table.appointmentId),
}));

export const rolePermissions = mysqlTable('role_permissions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  roleId: char('role_id', { length: 36 }).notNull().references(() => roles.id),
  permissionId: char('permission_id', { length: 36 }).notNull().references(() => permissions.id),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
});

export const roles = mysqlTable('roles', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    rolesNameUnique: unique('roles_name_unique').on(table.name),
}));

export const servicePrices = mysqlTable('service_prices', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  serviceId: char('service_id', { length: 36 }).notNull().references(() => services.id),
  branchId: char('branch_id', { length: 36 }).references(() => branches.id),
  regionId: char('region_id', { length: 36 }).references(() => regions.id),
  priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
  effectiveFrom: datetime('effective_from', { mode: 'string', fsp: 6 }).notNull(),
  effectiveTo: datetime('effective_to', { mode: 'string', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxServicePricesResolver: index('idx_service_prices_resolver').on(table.serviceId, table.branchId, table.effectiveFrom),
}));

export const services = mysqlTable('services', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  defaultDurationMin: int('default_duration_min').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
  imageUrl: text('image_url'),
});

export const staffUserRoles = mysqlTable('staff_user_roles', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  staffUserId: char('staff_user_id', { length: 36 }).notNull().references(() => staffUsers.id),
  roleId: char('role_id', { length: 36 }).notNull().references(() => roles.id),
  branchId: char('branch_id', { length: 36 }).references(() => branches.id),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxStaffUserRolesStaffBranch: index('idx_staff_user_roles_staff_branch').on(table.staffUserId, table.branchId),
}));

export const staffUsers = mysqlTable('staff_users', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  isActive: boolean('is_active').default(true),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  deletedAt: datetime('deleted_at', { mode: 'string', fsp: 6 }),
  authId: char('auth_id', { length: 36 }),
  passwordHash: varchar('password_hash', { length: 255 }),
}, (table) => ({
    staffUsersEmailUnique: unique('staff_users_email_unique').on(table.email),
}));

export const trackingSessions = mysqlTable('tracking_sessions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  appointmentId: char('appointment_id', { length: 36 }).notNull().references(() => appointments.id),
  status: varchar('status', { length: 50 }).notNull().default("active"),
  consentGivenAt: datetime('consent_given_at', { mode: 'string', fsp: 6 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'string', fsp: 6 }).notNull(),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  endedAt: datetime('ended_at', { mode: 'string', fsp: 6 }),
  endedReason: varchar('ended_reason', { length: 100 }),
  lastActivityAt: datetime('last_activity_at', { mode: 'string', fsp: 6 }).default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    trackingSessionsAppointmentStatusExpires: index('tracking_sessions_appointment_status_expires').on(table.appointmentId, table.status, table.expiresAt),
    // partial-unique downgraded (app-enforced): WHERE (status)::text = 'active'::text
    trackingSessionsOneActivePerAppointment: index('tracking_sessions_one_active_per_appointment').on(table.appointmentId),
}));

export const walletTopups = mysqlTable('wallet_topups', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  customerId: char('customer_id', { length: 36 }).notNull().references(() => customers.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default("pending"),
  provider: varchar('provider', { length: 50 }).notNull().default("midtrans"),
  method: varchar('method', { length: 50 }),
  gatewayReference: varchar('gateway_reference', { length: 150 }),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
  paidAt: datetime('paid_at', { mode: 'string', fsp: 6 }),
}, (table) => ({
    idxWalletTopupsCustomerId: index('idx_wallet_topups_customer_id').on(table.customerId),
    idxWalletTopupsGatewayReference: index('idx_wallet_topups_gateway_reference').on(table.gatewayReference),
}));

export const walletTransactions = mysqlTable('wallet_transactions', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  walletId: char('wallet_id', { length: 36 }).notNull().references(() => barberWallets.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  referenceId: char('reference_id', { length: 36 }),
  description: text('description'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
}, (table) => ({
    idxWalletTransactionsWalletId: index('idx_wallet_transactions_wallet_id').on(table.walletId),
}));

export const withdrawals = mysqlTable('withdrawals', {
  id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
  barberId: char('barber_id', { length: 36 }).notNull().references(() => barbers.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default("pending"),
  bankName: varchar('bank_name', { length: 100 }).notNull(),
  accountNumber: varchar('account_number', { length: 100 }).notNull(),
  accountName: varchar('account_name', { length: 150 }).notNull(),
  rejectionReason: text('rejection_reason'),
  createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
  updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`).$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`),
});
