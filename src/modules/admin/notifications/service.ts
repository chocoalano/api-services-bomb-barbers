import { supabase } from '../../../lib/supabase';

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
    const { data, error } = await supabase
      .from('admin_notification_settings')
      .select('new_appointment, appointment_reminder, appointment_cancelled, whatsapp, email, daily_summary, weekly_report')
      .eq('staff_user_id', staffId)
      .maybeSingle();

    if (error) throw new Error('Gagal mengambil pengaturan notifikasi: ' + error.message);

    if (!data) return { ...DEFAULT_SETTINGS };

    return {
      new_appointment: data.new_appointment ?? DEFAULT_SETTINGS.new_appointment,
      appointment_reminder: data.appointment_reminder ?? DEFAULT_SETTINGS.appointment_reminder,
      appointment_cancelled: data.appointment_cancelled ?? DEFAULT_SETTINGS.appointment_cancelled,
      whatsapp: data.whatsapp ?? DEFAULT_SETTINGS.whatsapp,
      email: data.email ?? DEFAULT_SETTINGS.email,
      daily_summary: data.daily_summary ?? DEFAULT_SETTINGS.daily_summary,
      weekly_report: data.weekly_report ?? DEFAULT_SETTINGS.weekly_report
    };
  }

  /**
   * Menyimpan (upsert) pengaturan notifikasi untuk staff tertentu.
   * Mengembalikan data yang berhasil disimpan.
   */
  static async updateSettings(staffId: string, settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const payload = {
      staff_user_id: staffId,
      new_appointment: settings.new_appointment,
      appointment_reminder: settings.appointment_reminder,
      appointment_cancelled: settings.appointment_cancelled,
      whatsapp: settings.whatsapp,
      email: settings.email,
      daily_summary: settings.daily_summary,
      weekly_report: settings.weekly_report,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('admin_notification_settings')
      .upsert(payload, { onConflict: 'staff_user_id' })
      .select('new_appointment, appointment_reminder, appointment_cancelled, whatsapp, email, daily_summary, weekly_report')
      .single();

    if (error) throw new Error('Gagal memperbarui pengaturan notifikasi: ' + error.message);

    return {
      new_appointment: data.new_appointment,
      appointment_reminder: data.appointment_reminder,
      appointment_cancelled: data.appointment_cancelled,
      whatsapp: data.whatsapp,
      email: data.email,
      daily_summary: data.daily_summary,
      weekly_report: data.weekly_report
    };
  }
}
