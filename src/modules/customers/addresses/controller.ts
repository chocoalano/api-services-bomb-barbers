import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { CustomerAddressService } from './service';

export class CustomerAddressController {
  /** GET /customers/addresses — daftar alamat tersimpan (maks 5). */
  static async list({ customerId, set }: any) {
    try {
      const data = await CustomerAddressService.list(customerId);
      return createSuccessResponse('Daftar alamat berhasil diambil', data);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message);
    }
  }

  /** POST /customers/addresses — simpan alamat baru (dedupe + batas 5). */
  static async create({ customerId, body, set }: any) {
    try {
      const data = await CustomerAddressService.create(customerId, body);
      set.status = 201;
      return createSuccessResponse('Alamat berhasil disimpan', data);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** PATCH /customers/addresses/:id — perbarui alamat. */
  static async update({ customerId, params, body, set }: any) {
    try {
      const data = await CustomerAddressService.update(customerId, params.id, body);
      return createSuccessResponse('Alamat berhasil diperbarui', data);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** DELETE /customers/addresses/:id — hapus alamat. */
  static async remove({ customerId, params, set }: any) {
    try {
      const data = await CustomerAddressService.remove(customerId, params.id);
      return createSuccessResponse('Alamat berhasil dihapus', data);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
