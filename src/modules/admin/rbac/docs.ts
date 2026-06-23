import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  commonMutationErrors,
  requestExamples,
  uuidField
} from '../swagger';

const roleExample = {
  id: ADMIN_EXAMPLES.roleId,
  name: 'branch_admin',
  created_at: '2026-06-01T08:00:00.000Z'
};

const permissionExample = {
  id: ADMIN_EXAMPLES.permissionId,
  code: 'manage_appointment',
  created_at: '2026-06-01T08:00:00.000Z'
};

export const adminDocs = {
  listStaffUsers: {
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Daftar Staff',
      description: 'Mengambil seluruh staff aktif beserta assignment role dan cabang mereka.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successMessage: 'Daftar staff berhasil diambil',
      successData: [{
        id: ADMIN_EXAMPLES.staffId,
        full_name: 'Nadia Ancol Admin',
        email: 'admin.kedoya@bombbarbershop.com',
        phone: '628110000101',
        is_active: true,
        created_at: '2026-06-01T08:00:00.000Z',
        staff_user_roles: [{
          branch_id: ADMIN_EXAMPLES.branchId,
          roles: { id: ADMIN_EXAMPLES.roleId, name: 'branch_admin' },
          branches: { id: ADMIN_EXAMPLES.branchId, name: 'Bomb Barbershop Jakarta Ancol' }
        }]
      }],
      errors: commonAuthErrors
    })
  },
  getRoles: {
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Daftar Role',
      description: 'Mengambil seluruh role staff yang dapat dipakai untuk assignment akses.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successMessage: 'Daftar role berhasil diambil',
      successData: [
        { ...roleExample, name: 'super_admin' },
        roleExample,
        { ...roleExample, id: '45454545-4545-4454-8454-454545454545', name: 'barber' }
      ],
      errors: commonAuthErrors
    })
  },
  createRole: {
    body: t.Object({
      name: t.String({
        minLength: 2,
        maxLength: 100,
        description: 'Nama role unik menggunakan snake_case.',
        examples: ['cashier']
      })
    }, requestExamples(
      { name: 'cashier' },
      { name: 'cashier' }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Buat Role',
      description: 'Membuat role staff baru. Permission belum otomatis terpasang dan harus dikelola melalui data role_permissions.',
      required: ['name', 'Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successStatus: 201,
      successMessage: 'Role baru berhasil dibuat',
      successData: { ...roleExample, name: 'cashier' },
      errors: commonMutationErrors
    })
  },
  getPermissions: {
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Daftar Permission',
      description: 'Mengambil semua kode permission yang tersedia untuk membangun matriks akses frontend admin.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successMessage: 'Daftar permission berhasil diambil',
      successData: [
        permissionExample,
        {
          ...permissionExample,
          id: '56565656-5656-4565-8565-565656565656',
          code: 'manage_payment'
        }
      ],
      errors: commonAuthErrors
    })
  },
  getStaffRoles: {
    params: t.Object({
      id: uuidField('UUID staff user.', ADMIN_EXAMPLES.staffId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Role Milik Staff',
      description: 'Mengambil seluruh assignment role staff beserta cabang yang terkait.',
      required: ['path id', 'Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successMessage: 'Role staff berhasil diambil',
      successData: [{
        id: '47474747-4747-4474-8474-474747474747',
        branch_id: ADMIN_EXAMPLES.branchId,
        roles: { id: ADMIN_EXAMPLES.roleId, name: 'branch_admin' },
        branches: { id: ADMIN_EXAMPLES.branchId, name: 'Bomb Barbershop Jakarta Ancol' }
      }],
      errors: commonMutationErrors
    })
  },
  assignRole: {
    params: t.Object({
      id: uuidField('UUID staff user yang akan menerima role.', ADMIN_EXAMPLES.staffId)
    }),
    body: t.Object({
      role_id: uuidField('UUID role yang akan dipasang.', ADMIN_EXAMPLES.roleId),
      branch_id: t.Optional(uuidField(
        'UUID cabang untuk membatasi role. Hilangkan field ini untuk role global/HQ.',
        ADMIN_EXAMPLES.branchId
      ))
    }, requestExamples(
      { role_id: ADMIN_EXAMPLES.roleId },
      {
        role_id: ADMIN_EXAMPLES.roleId,
        branch_id: ADMIN_EXAMPLES.branchId
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Pasang Role ke Staff',
      description: 'Memasang role ke staff. Payload minimal membuat assignment global, sedangkan branch_id membuat assignment khusus cabang.',
      required: ['path id', 'role_id', 'Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: ['branch_id'],
      successStatus: 201,
      successMessage: 'Role berhasil dipasangkan ke staff',
      successData: {
        id: '47474747-4747-4474-8474-474747474747',
        staff_user_id: ADMIN_EXAMPLES.staffId,
        role_id: ADMIN_EXAMPLES.roleId,
        branch_id: ADMIN_EXAMPLES.branchId,
        created_at: '2026-06-20T10:00:00.000Z'
      },
      errors: commonMutationErrors
    })
  },
  revokeRole: {
    params: t.Object({
      id: uuidField('UUID staff user.', ADMIN_EXAMPLES.staffId),
      roleId: uuidField('UUID role yang akan dicabut.', ADMIN_EXAMPLES.roleId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.rbac,
      summary: 'Cabut Role Staff',
      description: 'Menghapus assignment role tertentu dari staff dan membersihkan cache RBAC staff tersebut.',
      required: ['path id', 'path roleId', 'Authorization: Bearer <access_token>', "permission 'manage_staff'"],
      optional: [],
      successMessage: 'Role berhasil dicabut dari staff',
      successData: null,
      errors: commonMutationErrors
    })
  }
};
