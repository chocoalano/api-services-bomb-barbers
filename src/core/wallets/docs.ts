import { t } from 'elysia';
import { barberDetail, barberAuthError, barberServerError, BARBER_TAGS } from '../../modules/barbers/swagger';

export const walletDocs = {
  getWalletDetails: {
    detail: barberDetail({
      tag: BARBER_TAGS.profile,
      summary: 'Dapatkan Detail Wallet',
      description: 'Mengambil saldo saat ini dan 50 riwayat transaksi terbaru (komisi dan withdrawal) dari wallet barber.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Data wallet dan transaksi',
      successData: {
        balance: 150000,
        transactions: [
          {
            id: 'uuid',
            wallet_id: 'uuid',
            amount: 40000,
            type: 'commission',
            description: 'Komisi layanan (100000)',
            created_at: '2026-06-25T10:00:00Z'
          }
        ]
      },
      errors: [barberAuthError, barberServerError]
    })
  },
  requestWithdrawal: {
    body: t.Object({
      amount: t.Numeric({ minimum: 50000 }),
      bank_name: t.String({ minLength: 2 }),
      account_number: t.String({ minLength: 5 }),
      account_name: t.String({ minLength: 3 })
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.profile,
      summary: 'Permintaan Penarikan Dana (Withdrawal)',
      description: 'Membuat permintaan penarikan dana ke rekening bank. Saldo wallet akan langsung dipotong dan status penarikan menjadi pending.',
      required: ['Authorization: Bearer <barber_access_token>', 'body.amount', 'body.bank_name', 'body.account_number', 'body.account_name'],
      successMessage: 'Permintaan penarikan dana berhasil dikirim',
      successData: {
        success: true,
        withdrawal_id: 'uuid',
        transaction_id: 'uuid',
        new_balance: 100000
      },
      errors: [
        barberAuthError,
        {
          status: 400,
          description: 'Saldo tidak mencukupi atau request tidak valid.',
          message: 'Saldo tidak mencukupi untuk penarikan ini.'
        },
        barberServerError
      ]
    })
  }
};
