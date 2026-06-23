import { t } from 'elysia';

export const CUSTOMER_TAGS = {
  auth: 'Customers - Autentikasi',
  profile: 'Customers - Profil',
  catalog: 'Customers - Katalog Cabang',
  availability: 'Customers - Ketersediaan Slot',
  appointments: 'Customers - Appointment',
  tracking: 'Customers - Tracking',
  payments: 'Customers - Pembayaran',
  chat: 'Customers - Chat',
  reviews: 'Customers - Ulasan',
  content: 'Customers - Konten',
  media: 'Customers - Media'
} as const;

export const CUSTOMER_EXAMPLES = {
  customerId: '77777777-7777-4777-8777-777777777777',
  branchId: '11111111-1111-4111-8111-111111111111',
  barberId: '66666666-6666-4666-8666-666666666666',
  serviceId: '88888888-8888-4888-8888-888888888888',
  secondServiceId: '89898989-8989-4898-8989-898989898989',
  appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  paymentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  reviewId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  trackingSessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  chatMessageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  notificationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  invoiceNumber: 'INV-20260620-11111111-1234',
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.customer-access-token-example',
  refreshToken: 'eyJhbGciOiJIUzI1NiJ9.customer-refresh-token-example',
  imageUrl: 'https://api.bombbarbershop.com/public/uploads/reference.webp'
} as const;

export const customerUuidField = (description: string, example: string) =>
  t.String({
    format: 'uuid',
    description,
    examples: [example]
  });

export const customerDateField = (description: string, example: string) =>
  t.String({
    format: 'date',
    description,
    examples: [example]
  });

export const customerDateTimeField = (description: string, example: string) =>
  t.String({
    format: 'date-time',
    description,
    examples: [example]
  });

export const customerSuccessEnvelope = (
  message: string,
  data: unknown,
  meta: unknown = null
) => ({
  success: true,
  message,
  data,
  errors: null,
  meta
});

export const customerErrorEnvelope = (
  message: string,
  errors: unknown = null
) => ({
  success: false,
  message,
  data: null,
  errors,
  meta: null
});

export type CustomerResponseExample = {
  status: number;
  description: string;
  message: string;
  data?: unknown;
  errors?: unknown;
};

type CustomerDetailOptions = {
  tag: string;
  summary: string;
  description: string;
  required?: string[];
  optional?: string[];
  successStatus?: number;
  successDescription?: string;
  successMessage?: string;
  successData?: unknown;
  errors?: CustomerResponseExample[];
  security?: boolean;
};

const jsonEnvelopeSchema = {
  type: 'object',
  required: ['success', 'message', 'data', 'errors'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Permintaan berhasil diproses' },
    data: { nullable: true },
    errors: { nullable: true },
    meta: { nullable: true }
  }
};

export const customerDetail = ({
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
  security = true
}: CustomerDetailOptions): any => {
  const requirementNotes = [
    required.length > 0
      ? `**Parameter wajib:** ${required.join(', ')}.`
      : '**Parameter wajib:** tidak ada.',
    optional.length > 0
      ? `**Parameter opsional:** ${optional.join(', ')}.`
      : '**Parameter opsional:** tidak ada.'
  ].join('\n\n');

  const responses: Record<string, unknown> = {
    [successStatus]: {
      description: successDescription,
      content: {
        'application/json': {
          schema: jsonEnvelopeSchema,
          examples: {
            success: {
              summary: 'Contoh response berhasil',
              value: customerSuccessEnvelope(successMessage, successData)
            }
          }
        }
      }
    }
  };

  for (const [index, error] of errors.entries()) {
    const responseKey = String(error.status);
    const exampleKey = `error_${error.status}_${index + 1}`;
    const existingResponse = responses[responseKey] as any;

    if (existingResponse) {
      if (!existingResponse.description.includes(error.description)) {
        existingResponse.description = `${existingResponse.description} ${error.description}`;
      }
      existingResponse.content['application/json'].examples[exampleKey] = {
        summary: `Contoh response ${error.status}: ${error.message}`,
        value: customerErrorEnvelope(error.message, error.errors ?? null)
      };
      continue;
    }

    responses[responseKey] = {
      description: error.description,
      content: {
        'application/json': {
          schema: jsonEnvelopeSchema,
          examples: {
            [exampleKey]: {
              summary: `Contoh response ${error.status}: ${error.message}`,
              value: customerErrorEnvelope(error.message, error.errors ?? null)
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

export const customerAuthError: CustomerResponseExample = {
  status: 401,
  description: 'Access token customer tidak tersedia, tidak valid, kedaluwarsa, atau akun customer sudah tidak aktif.',
  message: 'Missing or invalid token'
};

export const customerValidationError: CustomerResponseExample = {
  status: 400,
  description: 'Path parameter, query parameter, body, atau aturan bisnis tidak valid.',
  message: 'Validasi gagal',
  errors: [
    {
      field: 'body',
      message: 'Data request tidak valid'
    }
  ]
};

export const customerServerError: CustomerResponseExample = {
  status: 500,
  description: 'Terjadi kegagalan internal saat membaca atau menyimpan data.',
  message: 'Internal Server Error'
};

export const customerProtectedErrors = [
  customerAuthError,
  customerValidationError
];
