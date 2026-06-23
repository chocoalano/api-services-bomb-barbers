import { supabase } from '../../lib/supabase';
import { emitChatMessage } from '../../lib/socket';

const normalizeLimit = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return 20;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter limit harus berupa angka minimal 1');
  }

  return Math.min(Math.floor(parsed), 100);
};

const normalizePage = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return 1;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter page harus berupa angka minimal 1');
  }

  return Math.floor(parsed);
};

type PaginationQuery = {
  page?: number | string;
  limit?: number | string;
};

export class ChatService {
  private async validateAppointmentParticipant(
    appointmentId: string,
    userId: string,
    userRole: 'customer' | 'barber'
  ) {
    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('customer_id, barber_id')
      .eq('id', appointmentId)
      .single();

    if (error || !appointment) {
      throw new Error('Appointment tidak ditemukan');
    }

    if (userRole === 'customer' && appointment.customer_id !== userId) {
      throw new Error('Akses ditolak');
    }

    if (userRole === 'barber') {
      const { data: barber, error: barberError } = await supabase
        .from('barbers')
        .select('id')
        .eq('staff_user_id', userId)
        .single();

      if (barberError || !barber || barber.id !== appointment.barber_id) {
        throw new Error('Akses ditolak');
      }
    }

    return appointment;
  }

  public async authorizeAppointmentParticipant(
    appointmentId: string,
    userId: string,
    userRole: 'customer' | 'barber'
  ) {
    return this.validateAppointmentParticipant(appointmentId, userId, userRole);
  }

  async getChatHistory(
    appointmentId: string,
    userId: string,
    userRole: 'customer' | 'barber',
    query: PaginationQuery = {}
  ) {
    await this.validateAppointmentParticipant(appointmentId, userId, userRole);

    const page = normalizePage(query.page);
    const limit = normalizeLimit(query.limit);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error } = await supabase
      .from('chat_messages' as any)
      .select('id, appointment_id, sender_id, sender_role, text, created_at')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error('Gagal mengambil riwayat chat: ' + error.message);
    }

    return data || [];
  }

  async saveMessage(
    appointmentId: string,
    senderId: string,
    senderRole: 'customer' | 'barber',
    text: string
  ) {
    if (!text || !text.trim()) {
      throw new Error('Pesan chat tidak boleh kosong');
    }

    await this.validateAppointmentParticipant(appointmentId, senderId, senderRole);

    const { data, error } = await supabase
      .from('chat_messages' as any)
      .insert({
        appointment_id: appointmentId,
        sender_id: senderId,
        sender_role: senderRole,
        text: text.trim()
      })
      .select('id, appointment_id, sender_id, sender_role, text, created_at')
      .single();

    if (error || !data) {
      throw new Error('Gagal menyimpan pesan chat: ' + (error?.message ?? 'unknown'));
    }

    emitChatMessage({
      id: data.id,
      appointment_id: data.appointment_id,
      sender_id: data.sender_id,
      sender_role: data.sender_role,
      text: data.text,
      created_at: data.created_at,
    });

    return data;
  }
}
