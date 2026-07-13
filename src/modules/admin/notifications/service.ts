import { db } from '../../../lib/db';
import { adminNotificationSettings } from '../../../db/schema-extra';
import { eq } from 'drizzle-orm';

const DEFAULT_SETTINGS = {
  new_appointment: true,
  appointment_reminder: true,
  appointment_cancelled: true,
  whatsapp: false,
  email: true,
  daily_summary: true,
  weekly_report: false
};

type NotificationSettings = typeof DEFAULT_SETTINGS;

export class NotificationSettingsService {
  /**
   * Mengambil pengaturan notifikasi untuk staff tertentu.
   * Jika belum ada record, mengembalikan nilai default.
   */
  static async getSettings(staffId: string): Promise<NotificationSettings> {
    const [data] = await db
      .select({
        newAppointment: adminNotificationSettings.newAppointment,
        appointmentReminder: adminNotificationSettings.appointmentReminder,
        appointmentCancelled: adminNotificationSettings.appointmentCancelled,
        whatsapp: adminNotificationSettings.whatsapp,
        email: adminNotificationSettings.email,
        dailySummary: adminNotificationSettings.dailySummary,
        weeklyReport: adminNotificationSettings.weeklyReport
      })
      .from(adminNotificationSettings)
      .where(eq(adminNotificationSettings.staffUserId, staffId))
      .limit(1);

    if (!data) return { ...DEFAULT_SETTINGS };

    return {
      new_appointment: data.newAppointment ?? DEFAULT_SETTINGS.new_appointment,
      appointment_reminder: data.appointmentReminder ?? DEFAULT_SETTINGS.appointment_reminder,
      appointment_cancelled: data.appointmentCancelled ?? DEFAULT_SETTINGS.appointment_cancelled,
      whatsapp: data.whatsapp ?? DEFAULT_SETTINGS.whatsapp,
      email: data.email ?? DEFAULT_SETTINGS.email,
      daily_summary: data.dailySummary ?? DEFAULT_SETTINGS.daily_summary,
      weekly_report: data.weeklyReport ?? DEFAULT_SETTINGS.weekly_report
    };
  }

  /**
   * Menyimpan (upsert) pengaturan notifikasi untuk staff tertentu.
   * Mengembalikan data yang berhasil disimpan.
   */
  static async updateSettings(
    staffId: string,
    settings: Partial<NotificationSettings>
  ): Promise<NotificationSettings> {
    const values = {
      staffUserId: staffId,
      newAppointment: settings.new_appointment,
      appointmentReminder: settings.appointment_reminder,
      appointmentCancelled: settings.appointment_cancelled,
      whatsapp: settings.whatsapp,
      email: settings.email,
      dailySummary: settings.daily_summary,
      weeklyReport: settings.weekly_report
    };

    // Buang key undefined agar tidak menimpa nilai lama dengan undefined saat update.
    const setClause = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => k !== 'staffUserId' && v !== undefined)
    );

    await db
      .insert(adminNotificationSettings)
      .values(values as any)
      .onDuplicateKeyUpdate({ set: setClause });

    return this.getSettings(staffId);
  }
}
