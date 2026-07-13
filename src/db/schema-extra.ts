// Tabel yang TIDAK ada di dump schema lama tapi dirujuk kode.
// Dipisah dari schema.ts (auto-generated) agar tidak terhapus saat regenerate.
import { char, boolean, datetime, mysqlTable, unique } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { staffUsers } from './schema';

// Dirujuk oleh admin/notifications/service.ts & lib/queue.ts, tetapi tabelnya
// belum pernah dibuat di DB lama. Ditambahkan agar fitur berfungsi di MySQL.
export const adminNotificationSettings = mysqlTable(
  'admin_notification_settings',
  {
    id: char('id', { length: 36 }).primaryKey().notNull().$defaultFn(() => randomUUID()),
    staffUserId: char('staff_user_id', { length: 36 })
      .notNull()
      .references(() => staffUsers.id),
    newAppointment: boolean('new_appointment').notNull().default(true),
    appointmentReminder: boolean('appointment_reminder').notNull().default(true),
    appointmentCancelled: boolean('appointment_cancelled').notNull().default(true),
    whatsapp: boolean('whatsapp').notNull().default(false),
    email: boolean('email').notNull().default(true),
    dailySummary: boolean('daily_summary').notNull().default(true),
    weeklyReport: boolean('weekly_report').notNull().default(false),
    createdAt: datetime('created_at', { mode: 'string', fsp: 6 }).notNull().default(sql`CURRENT_TIMESTAMP(6)`),
    updatedAt: datetime('updated_at', { mode: 'string', fsp: 6 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(6)`)
      .$onUpdateFn(() => sql`CURRENT_TIMESTAMP(6)`)
  },
  (table) => ({
    adminNotificationSettingsStaffUserIdUnique: unique(
      'admin_notification_settings_staff_user_id_unique'
    ).on(table.staffUserId)
  })
);
