import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import { appointments, barbers, chatMessages } from '../../db/schema';
import { and, eq, gt, asc } from 'drizzle-orm';
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
    const [appointment] = await db
      .select({
        customer_id: appointments.customerId,
        barber_id: appointments.barberId,
        status: appointments.status,
        chat_cleared_at: appointments.chatClearedAt
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new Error('Appointment tidak ditemukan');
    }

    if (userRole === 'customer' && appointment.customer_id !== userId) {
      throw new Error('Akses ditolak');
    }

    if (userRole === 'barber') {
      const [barber] = await db
        .select({ id: barbers.id })
        .from(barbers)
        .where(eq(barbers.staffUserId, userId))
        .limit(1);

      if (!barber || barber.id !== appointment.barber_id) {
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
    const appointment = await this.validateAppointmentParticipant(appointmentId, userId, userRole);

    const page = normalizePage(query.page);
    const limit = normalizeLimit(query.limit);
    const from = (page - 1) * limit;

    const conds = [eq(chatMessages.appointmentId, appointmentId)];
    // Barber yang baru di-reassign tidak boleh melihat riwayat chat sebelum ia
    // ditugaskan. Customer tetap melihat seluruh riwayatnya. (M7)
    if (userRole === 'barber' && (appointment as any).chat_cleared_at) {
      conds.push(gt(chatMessages.createdAt, (appointment as any).chat_cleared_at));
    }

    const data = await db
      .select({
        id: chatMessages.id,
        appointment_id: chatMessages.appointmentId,
        sender_id: chatMessages.senderId,
        sender_role: chatMessages.senderRole,
        text: chatMessages.text,
        created_at: chatMessages.createdAt
      })
      .from(chatMessages)
      .where(and(...conds))
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit)
      .offset(from);

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

    const appointment = await this.validateAppointmentParticipant(appointmentId, senderId, senderRole);

    // Chat ditutup untuk appointment yang sudah berakhir. (M7)
    const terminalStatuses = ['completed', 'cancelled', 'no_show'];
    if (terminalStatuses.includes((appointment as any).status)) {
      throw new Error('Sesi chat sudah ditutup untuk pesanan ini');
    }

    const messageId = randomUUID();
    await db.insert(chatMessages).values({
      id: messageId,
      appointmentId,
      senderId,
      senderRole,
      text: text.trim()
    });

    const [data] = await db
      .select({
        id: chatMessages.id,
        appointment_id: chatMessages.appointmentId,
        sender_id: chatMessages.senderId,
        sender_role: chatMessages.senderRole,
        text: chatMessages.text,
        created_at: chatMessages.createdAt
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .limit(1);

    if (!data) {
      throw new Error('Gagal menyimpan pesan chat: unknown');
    }

    emitChatMessage({
      id: data.id,
      appointment_id: data.appointment_id,
      sender_id: data.sender_id,
      sender_role: data.sender_role as 'customer' | 'barber',
      text: data.text,
      created_at: data.created_at,
      // Dikirim juga ke room personal kedua pihak agar badge unread global
      // pada penerima tetap bertambah walau ia tidak di room appointment.
      customer_id: (appointment as any).customer_id ?? null,
      barber_id: (appointment as any).barber_id ?? null,
    });

    return data;
  }
}
