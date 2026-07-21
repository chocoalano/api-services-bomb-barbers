/**
 * Port dari fungsi RPC lama (prosedur atomik) ke transaksi Drizzle/MySQL.
 *
 * Setiap fungsi menjaga semantik atomik aslinya:
 *  - `db.transaction()` = boundary transaksi (BEGIN/COMMIT/ROLLBACK)
 *  - `SELECT ... FOR UPDATE` = row lock (pengganti FOR UPDATE lama)
 *  - `GET_LOCK()` = pengganti advisory lock lama (serialisasi idempotency/queue)
 *  - unique index `appointments_idempotency_key_unique` = proteksi idempotency
 *  - cek overlap manual = pengganti EXCLUDE gist `appointments_barber_schedule_excl`
 *
 * Error dilempar sebagai ProcedureError dengan `.code` = SQLSTATE lama supaya
 * logika penanganan error di caller (mis. cek '23505' / '40001' / 'P0001') tetap jalan.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../lib/db';

export class ProcedureError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProcedureError';
    this.code = code;
  }
}

// Drizzle membungkus error driver dalam DrizzleQueryError; error mysql2 asli ada
// di `.cause`. Deteksi duplicate-key (ER_DUP_ENTRY / errno 1062) menembus wrapper.
export function isDuplicateKeyError(e: any): boolean {
  let cur = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.code === 'ER_DUP_ENTRY' || cur.errno === 1062) return true;
    cur = cur.cause;
  }
  return false;
}

/**
 * Adapter: membungkus pemanggilan procedure menjadi bentuk `{ data, error }`
 * yang sama seperti hasil RPC lama, lengkap dengan `error.code`
 * (SQLSTATE). Dengan ini penanganan error di caller tidak perlu diubah.
 */
export async function asRpcResult<T>(
  fn: () => Promise<T>
): Promise<{ data: T | null; error: { code: string; message: string } | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (e: any) {
    if (e instanceof ProcedureError) return { data: null, error: { code: e.code, message: e.message } };
    if (isDuplicateKeyError(e)) return { data: null, error: { code: '23505', message: e?.message ?? 'duplicate key' } };
    return { data: null, error: { code: e?.code ?? 'INTERNAL', message: e?.message ?? String(e) } };
  }
}

// mysql2 mengembalikan [rows, fields]; drizzle `execute` meneruskannya apa adanya.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rows<T = any>(tx: Tx, query: any): Promise<T[]> {
  const res: any = await tx.execute(query);
  // drizzle-mysql2: res = [rows, fields]
  return (Array.isArray(res) ? res[0] : res) as T[];
}

async function one<T = any>(tx: Tx, query: any): Promise<T | null> {
  const r = await rows<T>(tx, query);
  return r[0] ?? null;
}

// Format Date -> 'YYYY-MM-DD HH:mm:ss.ffffff' dalam UTC (kolom DATETIME menyimpan UTC).
function toSqlUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) {
    throw new ProcedureError('Tanggal/waktu tidak valid', '22023');
  }
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds() * 1000, 6)}`
  );
}

function parseDbTime(value: string | Date): Date {
  if (value instanceof Date) return value;
  const raw = value.trim();
  if (!raw) return new Date(Number.NaN);

  // mysql (dateStrings) -> 'YYYY-MM-DD HH:mm:ss[.ffffff]' dianggap UTC.
  // Request API boleh memakai ISO timestamptz ('...Z' atau '+07:00'); jangan
  // menambahkan suffix Z lagi karena string seperti '...+07:00Z' menjadi invalid.
  const normalized = raw.replace(' ', 'T');
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimeZone ? normalized : `${normalized}Z`);
}

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7 (tanpa DST)

// Waktu "lokal Jakarta" direpresentasikan sebagai Date yang komponen UTC-nya = jam lokal.
function toJakartaLocal(utc: Date): Date {
  return new Date(utc.getTime() + JAKARTA_OFFSET_MS);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a)) * 1000;
}

// 'HH:mm:ss' -> menit sejak tengah malam
function timeToMinutes(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 60 + m + Math.floor((s || 0) / 60);
}

const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];

// ============================================================================
// apply_barber_rating
// ============================================================================
export async function applyBarberRating(params: { barberId: string; rating: number }) {
  return db.transaction(async (tx) => {
    const barber = await one(
      tx,
      sql`SELECT rating_count, rating_avg FROM barbers WHERE id = ${params.barberId} FOR UPDATE`
    );
    if (!barber) throw new ProcedureError('Barber tidak ditemukan', 'P0002');

    const count = Number(barber.rating_count ?? 0);
    const avg = Number(barber.rating_avg ?? 0);
    const newCount = count + 1;
    const newAvg = Math.round(((avg * count + params.rating) / newCount) * 100) / 100;

    await tx.execute(
      sql`UPDATE barbers SET rating_count = ${newCount}, rating_avg = ${newAvg} WHERE id = ${params.barberId}`
    );
    return { rating_count: newCount, rating_avg: newAvg };
  });
}

// ============================================================================
// deposit_commission (dipakai internal & mungkin langsung)
// ============================================================================
export async function depositCommission(params: {
  barberId: string;
  amount: number;
  commissionId: string;
  description: string;
}) {
  return db.transaction(async (tx) => {
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM barber_wallets WHERE barber_id = ${params.barberId} FOR UPDATE`
    );
    if (!wallet) throw new ProcedureError(`Wallet not found for barber_id ${params.barberId}`, 'P0002');

    const newBalance = Number(wallet.balance) + params.amount;
    await tx.execute(
      sql`UPDATE barber_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${wallet.id}, ${params.amount}, 'commission', ${params.commissionId}, ${params.description})
    `);
    return { success: true, wallet_id: wallet.id, new_balance: newBalance };
  });
}

// ============================================================================
// credit_customer_wallet
// ============================================================================
export async function creditCustomerWallet(params: {
  customerId: string;
  amount: number;
  type: string;
  referenceId?: string | null;
  description?: string | null;
}) {
  if (params.amount <= 0) throw new ProcedureError('Jumlah kredit harus lebih dari 0', '22023');
  return db.transaction(async (tx) => {
    await ensureCustomerWallet(tx, params.customerId);
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${params.customerId} FOR UPDATE`
    );
    if (!wallet) throw new ProcedureError('Wallet customer tidak ditemukan', 'P0002');

    const newBalance = Number(wallet.balance) + params.amount;
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    const txnId = randomUUID();
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${txnId}, ${wallet.id}, ${params.amount}, ${params.type}, ${params.referenceId ?? null}, ${params.description ?? null})
    `);
    return { wallet_id: wallet.id, transaction_id: txnId, new_balance: newBalance };
  });
}

// ============================================================================
// debit_customer_wallet
// ============================================================================
export async function debitCustomerWallet(params: {
  customerId: string;
  amount: number;
  type: string;
  referenceId?: string | null;
  description?: string | null;
}) {
  if (params.amount <= 0) throw new ProcedureError('Jumlah debit harus lebih dari 0', '22023');
  return db.transaction(async (tx) => {
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${params.customerId} FOR UPDATE`
    );
    if (!wallet) throw new ProcedureError('Wallet customer tidak ditemukan', 'P0002');
    if (Number(wallet.balance) < params.amount)
      throw new ProcedureError('Saldo tidak mencukupi', '22023');

    const newBalance = Number(wallet.balance) - params.amount;
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    const txnId = randomUUID();
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${txnId}, ${wallet.id}, ${-params.amount}, ${params.type}, ${params.referenceId ?? null}, ${params.description ?? null})
    `);
    return { wallet_id: wallet.id, transaction_id: txnId, new_balance: newBalance };
  });
}

// ============================================================================
// pay_tip_from_wallet
// ============================================================================
export async function payTipFromWallet(params: {
  customerId: string;
  barberId: string;
  appointmentId: string;
  amount: number;
}) {
  if (params.amount <= 0) throw new ProcedureError('Jumlah tip harus lebih dari 0', '22023');
  return db.transaction(async (tx) => {
    const cust = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${params.customerId} FOR UPDATE`
    );
    if (!cust) throw new ProcedureError('Wallet customer tidak ditemukan', 'P0002');
    if (Number(cust.balance) < params.amount)
      throw new ProcedureError('Saldo tidak mencukupi untuk tip', 'P0001');

    const newBalance = Number(cust.balance) - params.amount;
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${cust.id}`
    );
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${cust.id}, ${-params.amount}, 'tip', ${params.appointmentId}, 'Tip untuk barber')
    `);

    const barberWallet = await one(
      tx,
      sql`SELECT id, balance FROM barber_wallets WHERE barber_id = ${params.barberId} FOR UPDATE`
    );
    if (!barberWallet) throw new ProcedureError('Wallet barber tidak ditemukan', 'P0002');
    await tx.execute(
      sql`UPDATE barber_wallets SET balance = ${Number(barberWallet.balance) + params.amount}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${barberWallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${barberWallet.id}, ${params.amount}, 'tip', ${params.appointmentId}, 'Tip dari customer')
    `);
    return { success: true, new_balance: newBalance, amount: params.amount };
  });
}

// ============================================================================
// request_withdrawal (barber)
// ============================================================================
export async function requestWithdrawal(params: {
  barberId: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
}) {
  return db.transaction(async (tx) => {
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM barber_wallets WHERE barber_id = ${params.barberId} FOR UPDATE`
    );
    if (!wallet) throw new ProcedureError(`Wallet not found for barber_id ${params.barberId}`, 'P0002');
    if (Number(wallet.balance) < params.amount)
      throw new ProcedureError(
        `Insufficient balance. Requested: ${params.amount}, Available: ${wallet.balance}`,
        'P0001'
      );

    const withdrawalId = randomUUID();
    await tx.execute(sql`
      INSERT INTO withdrawals (id, barber_id, amount, bank_name, account_number, account_name, status)
      VALUES (${withdrawalId}, ${params.barberId}, ${params.amount}, ${params.bankName}, ${params.accountNumber}, ${params.accountName}, 'pending')
    `);
    const transactionId = randomUUID();
    await tx.execute(sql`
      INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${transactionId}, ${wallet.id}, ${-params.amount}, 'withdrawal_pending', ${withdrawalId}, 'Penarikan Dana (Pending)')
    `);
    const newBalance = Number(wallet.balance) - params.amount;
    await tx.execute(
      sql`UPDATE barber_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    return { success: true, withdrawal_id: withdrawalId, transaction_id: transactionId, new_balance: newBalance };
  });
}

// ============================================================================
// approve_barber_withdrawal_atomic
// ============================================================================
export async function approveBarberWithdrawalAtomic(params: { withdrawalId: string }) {
  return db.transaction(async (tx) => {
    const res: any = await tx.execute(
      sql`UPDATE withdrawals SET status = 'completed', updated_at = ${toSqlUtc(new Date())} WHERE id = ${params.withdrawalId} AND status = 'pending'`
    );
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected)
      throw new ProcedureError('Withdrawal tidak ditemukan atau statusnya bukan pending', 'P0002');
    return { success: true };
  });
}

// ============================================================================
// reject_barber_withdrawal_atomic
// ============================================================================
export async function rejectBarberWithdrawalAtomic(params: { withdrawalId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const res: any = await tx.execute(
      sql`UPDATE withdrawals SET status = 'rejected', rejection_reason = ${params.reason}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${params.withdrawalId} AND status = 'pending'`
    );
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected)
      throw new ProcedureError('Withdrawal tidak ditemukan atau statusnya bukan pending', 'P0002');

    const wd = await one(tx, sql`SELECT barber_id, amount FROM withdrawals WHERE id = ${params.withdrawalId}`);
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM barber_wallets WHERE barber_id = ${wd.barber_id} FOR UPDATE`
    );
    if (!wallet) throw new ProcedureError('Wallet barber tidak ditemukan', 'P0002');
    const newBalance = Number(wallet.balance) + Number(wd.amount);
    await tx.execute(
      sql`UPDATE barber_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${wallet.id}, ${Number(wd.amount)}, 'withdrawal_rejected', ${params.withdrawalId}, ${'Penarikan ditolak: ' + params.reason})
    `);
    return { success: true, new_balance: newBalance, amount: Number(wd.amount), barber_id: wd.barber_id };
  });
}

// ============================================================================
// approve_customer_withdrawal_atomic
// ============================================================================
export async function approveCustomerWithdrawalAtomic(params: { withdrawalId: string }) {
  return db.transaction(async (tx) => {
    const res: any = await tx.execute(
      sql`UPDATE customer_withdrawals SET status = 'completed', updated_at = ${toSqlUtc(new Date())} WHERE id = ${params.withdrawalId} AND status = 'pending'`
    );
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected)
      throw new ProcedureError('Withdrawal tidak ditemukan atau statusnya bukan pending', 'P0002');
    await tx.execute(sql`
      UPDATE customer_wallet_transactions SET type = 'withdrawal_completed'
      WHERE reference_id = ${params.withdrawalId} AND type = 'withdrawal_pending'
    `);
    return { success: true };
  });
}

// ============================================================================
// reject_customer_withdrawal_atomic
// ============================================================================
export async function rejectCustomerWithdrawalAtomic(params: { withdrawalId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const res: any = await tx.execute(
      sql`UPDATE customer_withdrawals SET status = 'rejected', rejection_reason = ${params.reason}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${params.withdrawalId} AND status = 'pending'`
    );
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected)
      throw new ProcedureError('Withdrawal tidak ditemukan atau statusnya bukan pending', 'P0002');

    const wd = await one(tx, sql`SELECT customer_id, amount FROM customer_withdrawals WHERE id = ${params.withdrawalId}`);
    await ensureCustomerWallet(tx, wd.customer_id);
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${wd.customer_id} FOR UPDATE`
    );
    const newBalance = Number(wallet.balance) + Number(wd.amount);
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${wallet.id}, ${Number(wd.amount)}, 'withdrawal_rejected', ${params.withdrawalId}, ${'Penarikan ditolak admin: ' + params.reason})
    `);
    await tx.execute(sql`
      UPDATE customer_wallet_transactions SET type = 'withdrawal_rejected'
      WHERE reference_id = ${params.withdrawalId} AND type = 'withdrawal_pending'
    `);
    return { success: true, new_balance: newBalance, amount: Number(wd.amount), customer_id: wd.customer_id };
  });
}

// ============================================================================
// settle_wallet_topup
// ============================================================================
export async function settleWalletTopup(params: { topupId: string }) {
  return db.transaction(async (tx) => {
    const res: any = await tx.execute(
      sql`UPDATE wallet_topups SET status = 'paid', paid_at = ${toSqlUtc(new Date())}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${params.topupId} AND status = 'pending'`
    );
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected) throw new ProcedureError('Top-up tidak ditemukan atau sudah diproses', 'P0002');

    const topup = await one(tx, sql`SELECT customer_id, amount FROM wallet_topups WHERE id = ${params.topupId}`);
    await ensureCustomerWallet(tx, topup.customer_id);
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${topup.customer_id} FOR UPDATE`
    );
    const newBalance = Number(wallet.balance) + Number(topup.amount);
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${wallet.id}, ${Number(topup.amount)}, 'topup', ${params.topupId}, 'Top-up saldo')
    `);
    return { success: true, new_balance: newBalance, amount: Number(topup.amount), customer_id: topup.customer_id };
  });
}

// ============================================================================
// refund_payment_to_wallet
// ============================================================================
export async function refundPaymentToWallet(params: {
  paymentId: string;
  customerId: string;
  amount: number;
  reason: string;
  /**
   * UUID staff yang memproses, atau null bila refund dilakukan SISTEM.
   * `refunds.processed_by` adalah foreign key ke `staff_users`, sehingga
   * penanda non-UUID seperti 'system' akan melanggar constraint.
   */
  processedBy: string | null;
}) {
  return db.transaction(async (tx) => {
    const payment = await one(
      tx,
      sql`SELECT total_amount FROM payments WHERE id = ${params.paymentId} AND status IN ('paid','partially_refunded') FOR UPDATE`
    );
    if (!payment) throw new ProcedureError('Payment tidak dalam status yang bisa di-refund', 'P0001');
    const total = Number(payment.total_amount);

    const agg = await one(
      tx,
      sql`SELECT COALESCE(SUM(amount),0) AS refunded FROM refunds WHERE payment_id = ${params.paymentId}`
    );
    const alreadyRefunded = Number(agg.refunded);
    if (params.amount <= 0 || alreadyRefunded + params.amount > total)
      throw new ProcedureError('Nominal refund melebihi sisa yang bisa dikembalikan', '22023');

    const newStatus = alreadyRefunded + params.amount >= total ? 'refunded' : 'partially_refunded';
    await tx.execute(sql`UPDATE payments SET status = ${newStatus} WHERE id = ${params.paymentId}`);
    await tx.execute(sql`
      INSERT INTO refunds (id, payment_id, amount, reason, processed_by, processed_at)
      VALUES (${randomUUID()}, ${params.paymentId}, ${params.amount}, ${params.reason}, ${params.processedBy}, ${toSqlUtc(new Date())})
    `);

    await ensureCustomerWallet(tx, params.customerId);
    const wallet = await one(
      tx,
      sql`SELECT id, balance FROM customer_wallets WHERE customer_id = ${params.customerId} FOR UPDATE`
    );
    const newBalance = Number(wallet.balance) + params.amount;
    await tx.execute(
      sql`UPDATE customer_wallets SET balance = ${newBalance}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
    );
    await tx.execute(sql`
      INSERT INTO customer_wallet_transactions (id, wallet_id, amount, type, reference_id, description)
      VALUES (${randomUUID()}, ${wallet.id}, ${params.amount}, 'refund', ${params.paymentId}, ${params.reason})
    `);
    return { success: true, new_balance: newBalance, payment_status: newStatus };
  });
}

// ============================================================================
// record_commission_atomic
// ============================================================================
export async function recordCommissionAtomic(params: {
  appointmentId: string;
  commissionRuleId: string;
  baseAmount: number;
  barberShare: number;
  branchShare: number;
  hqShare: number;
  tipAmount: number;
  barberId: string;
  branchId: string;
  summaryDate: string; // YYYY-MM-DD
  description: string;
}) {
  return db.transaction(async (tx) => {
    const entryId = randomUUID();
    try {
      await tx.execute(sql`
        INSERT INTO commission_entries (id, appointment_id, commission_rule_id, base_amount, barber_share, branch_share, hq_share, tip_amount, calculated_at)
        VALUES (${entryId}, ${params.appointmentId}, ${params.commissionRuleId}, ${params.baseAmount}, ${params.barberShare}, ${params.branchShare}, ${params.hqShare}, ${params.tipAmount}, ${toSqlUtc(new Date())})
      `);
    } catch (e: any) {
      if (isDuplicateKeyError(e))
        throw new ProcedureError('commission_entries_appointment_id_unique', '23505');
      throw e;
    }

    if (params.barberShare > 0) {
      // Dompet dibuat di sini bila belum ada. Sebelumnya satu-satunya pembuat
      // dompet adalah layar dompet barber; sejak layar itu ditutup (barber tidak
      // diizinkan mengetahui pendapatannya), tidak ada lagi yang membuatnya dan
      // SETIAP pencatatan komisi otomatis akan gagal 'Wallet not found'.
      // ON DUPLICATE KEY membuatnya aman dipanggil berulang.
      await ensureBarberWallet(tx, params.barberId);
      const wallet = await one(
        tx,
        sql`SELECT id FROM barber_wallets WHERE barber_id = ${params.barberId} FOR UPDATE`
      );
      if (!wallet) throw new ProcedureError(`Wallet not found for barber_id ${params.barberId}`, 'P0002');
      await tx.execute(
        sql`UPDATE barber_wallets SET balance = balance + ${params.barberShare}, updated_at = ${toSqlUtc(new Date())} WHERE id = ${wallet.id}`
      );
      await tx.execute(sql`
        INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, description)
        VALUES (${randomUUID()}, ${wallet.id}, ${params.barberShare}, 'commission', ${entryId}, ${params.description})
      `);
    }

    // Upsert agregat harian barber (ON CONFLICT (barber_id, summary_date))
    await tx.execute(sql`
      INSERT INTO barber_daily_stats (id, barber_id, branch_id, summary_date, heads_count, commission_earned)
      VALUES (${randomUUID()}, ${params.barberId}, ${params.branchId}, ${params.summaryDate}, 1, ${params.barberShare})
      ON DUPLICATE KEY UPDATE
        heads_count = heads_count + 1,
        commission_earned = commission_earned + VALUES(commission_earned),
        updated_at = ${toSqlUtc(new Date())}
    `);

    // Upsert agregat harian cabang (ON CONFLICT (branch_id, summary_date))
    await tx.execute(sql`
      INSERT INTO daily_branch_summaries (id, branch_id, summary_date, total_appointments, total_revenue, branch_share_total, hq_share_total)
      VALUES (${randomUUID()}, ${params.branchId}, ${params.summaryDate}, 1, ${params.baseAmount}, ${params.branchShare}, ${params.hqShare})
      ON DUPLICATE KEY UPDATE
        total_appointments = total_appointments + 1,
        total_revenue = total_revenue + VALUES(total_revenue),
        branch_share_total = branch_share_total + VALUES(branch_share_total),
        hq_share_total = hq_share_total + VALUES(hq_share_total),
        updated_at = ${toSqlUtc(new Date())}
    `);

    return one(tx, sql`SELECT * FROM commission_entries WHERE id = ${entryId}`);
  });
}

// ============================================================================
// Helper: pastikan customer_wallet ada (pengganti trigger create_wallet_for_new_customer
// + pola INSERT ... ON CONFLICT DO NOTHING).
// ============================================================================
export async function ensureCustomerWallet(tx: Tx, customerId: string) {
  await tx.execute(sql`
    INSERT INTO customer_wallets (id, customer_id, balance)
    VALUES (${randomUUID()}, ${customerId}, 0)
    ON DUPLICATE KEY UPDATE customer_id = customer_id
  `);
}

export async function ensureBarberWallet(tx: Tx, barberId: string) {
  await tx.execute(sql`
    INSERT INTO barber_wallets (id, barber_id, balance)
    VALUES (${randomUUID()}, ${barberId}, 0)
    ON DUPLICATE KEY UPDATE barber_id = barber_id
  `);
}

export { toSqlUtc, toJakartaLocal, haversineMeters, timeToMinutes, parseDbTime, ACTIVE_STATUSES };
