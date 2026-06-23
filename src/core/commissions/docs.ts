import { t } from 'elysia';

export const commissionDocs = {
  calculateCommission: {
    detail: { tags: ['Commissions'], summary: 'Hitung dan terbitkan komisi untuk pesanan' }
  },
  getCommissionDetail: {
    detail: { tags: ['Commissions'], summary: 'Lihat detail komisi per pesanan' }
  },
  getBarberCommissions: {
    detail: { tags: ['Commissions'], summary: 'Laporan komisi khusus Barber' }
  },
  getBranchCommissions: {
    detail: { tags: ['Commissions'], summary: 'Laporan komisi khusus Cabang' }
  }
};
