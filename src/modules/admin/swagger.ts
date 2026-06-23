import { t } from 'elysia';

export const ADMIN_TAGS = {
  auth: 'Admin - Autentikasi',
  rbac: 'Admin - RBAC',
  branches: 'Admin - Cabang',
  barbers: 'Admin - Barber',
  services: 'Admin - Layanan',
  prices: 'Admin - Harga Layanan',
  appointments: 'Admin - Appointment',
  payments: 'Admin - Pembayaran',
  webhooks: 'Admin - Webhook Pembayaran',
  audit: 'Admin - Audit Log',
  commissions: 'Admin - Komisi',
  dashboard: 'Admin - Dashboard Cabang',
  hqDashboard: 'Admin - Dashboard HQ',
  expenses: 'Admin - Pengeluaran',
  queue: 'Admin - Antrean Realtime',
  analytics: 'Admin - Analytics HQ',
  media: 'Admin - Media HQ',
  settings: 'Admin - Pengaturan',
  customers: 'Admin - Pelanggan'
} as const;

export const ADMIN_EXAMPLES = {
  branchId: '11111111-1111-4111-8111-111111111111',
  regionId: '22222222-2222-4222-8222-222222222222',
  staffId: '33333333-3333-4333-8333-333333333333',
  roleId: '44444444-4444-4444-8444-444444444444',
  permissionId: '55555555-5555-4555-8555-555555555555',
  barberId: '66666666-6666-4666-8666-666666666666',
  customerId: '77777777-7777-4777-8777-777777777777',
  serviceId: '88888888-8888-4888-8888-888888888888',
  servicePriceId: '99999999-9999-4999-8999-999999999999',
  appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  paymentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  commissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  expenseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  auditId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  invoiceNumber: 'INV-20260620-11111111-1234',
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.admin-access-token-example',
  refreshToken: 'eyJhbGciOiJIUzI1NiJ9.admin-refresh-token-example'
} as const;

export const uuidField = (description: string, example: string) =>
  t.String({
    format: 'uuid',
    description,
    examples: [example]
  });

export const isoDateTimeField = (description: string, example: string) =>
  t.String({
    format: 'date-time',
    description,
    examples: [example]
  });

export const isoDateField = (description: string, example: string) =>
  t.String({
    format: 'date',
    description,
    examples: [example]
  });

export const requestExamples = <T extends Record<string, unknown>>(
  requiredOnly: T,
  complete: T
) => ({
  examples: [requiredOnly, complete]
});

export const successEnvelope = (message: string, data: unknown, meta: unknown = null) => ({
  success: true,
  message,
  data,
  errors: null,
  meta
});

export const errorEnvelope = (message: string, errors: unknown = null) => ({
  success: false,
  message,
  data: null,
  errors,
  meta: null
});

type ResponseExample = {
  status: number;
  description: string;
  message: string;
  data?: unknown;
  errors?: unknown;
};

type AdminDetailOptions = {
  tag: string;
  summary: string;
  description: string;
  required?: string[];
  optional?: string[];
  successStatus?: number;
  successDescription?: string;
  successMessage?: string;
  successData?: unknown;
  errors?: ResponseExample[];
  security?: boolean;
  contentType?: string;
  rawSuccessExample?: unknown;
};

const jsonEnvelopeSchema = {
  type: 'object',
  required: ['success', 'message', 'data', 'errors'],
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    data: { nullable: true },
    errors: { nullable: true },
    meta: { nullable: true }
  }
};

export const adminDetail = ({
  tag,
  summary,
  description,
  required = [],
  optional = [],
  successStatus = 200,
  successDescription = 'Permintaan berhasil diproses.',
  successMessage = 'Berhasil',
  successData = null,
  errors = [],
  security = true,
  contentType = 'application/json',
  rawSuccessExample
}: AdminDetailOptions): any => {
  const requirementNotes = [
    required.length > 0 ? `**Parameter wajib:** ${required.join(', ')}.` : '**Parameter wajib:** tidak ada.',
    optional.length > 0 ? `**Parameter opsional:** ${optional.join(', ')}.` : '**Parameter opsional:** tidak ada.'
  ].join('\n\n');

  const successExample = rawSuccessExample ?? successEnvelope(successMessage, successData);
  const responses: Record<string, unknown> = {
    [successStatus]: {
      description: successDescription,
      content: {
        [contentType]: {
          ...(contentType === 'application/json' ? { schema: jsonEnvelopeSchema } : {}),
          examples: {
            success: {
              summary: 'Contoh response berhasil',
              value: successExample
            }
          }
        }
      }
    }
  };

  for (const error of errors) {
    responses[error.status] = {
      description: error.description,
      content: {
        'application/json': {
          schema: jsonEnvelopeSchema,
          examples: {
            error: {
              summary: `Contoh response ${error.status}`,
              value: errorEnvelope(error.message, error.errors ?? null)
            }
          }
        }
      }
    };
  }

  return {
    tags: [tag],
    summary,
    description: `${description}\n\n${requirementNotes}`,
    security: security ? [{ bearerAuth: [] }] : [],
    responses
  };
};

export const commonAuthErrors = [
  {
    status: 401,
    description: 'Access token tidak tersedia, tidak valid, atau kedaluwarsa.',
    message: 'Missing or invalid token'
  },
  {
    status: 403,
    description: 'Staff terautentikasi tetapi tidak memiliki role, permission, atau scope cabang yang diperlukan.',
    message: 'Forbidden: akses tidak diizinkan'
  }
];

export const commonMutationErrors = [
  ...commonAuthErrors,
  {
    status: 400,
    description: 'Payload, parameter, atau aturan bisnis tidak valid.',
    message: 'Validasi gagal',
    errors: [{ field: 'body', message: 'Data request tidak valid' }]
  }
];
