import { t } from 'elysia';

export const BARBER_TAGS = {
  auth: 'Barbers - Autentikasi',
  profile: 'Barbers - Profil',
  queue: 'Barbers - Antrean',
  appointments: 'Barbers - Appointment',
  tracking: 'Barbers - Tracking',
  dashboard: 'Barbers - Dashboard',
  commissions: 'Barbers - Komisi',
  chat: 'Barbers - Chat',
  media: 'Barbers - Media',
  portfolio: 'Barbers - Portfolio'
} as const;

export const BARBER_EXAMPLES = {
  staffId: '33333333-3333-4333-8333-333333333333',
  barberId: '66666666-6666-4666-8666-666666666666',
  customerId: '77777777-7777-4777-8777-777777777777',
  branchId: '11111111-1111-4111-8111-111111111111',
  serviceId: '88888888-8888-4888-8888-888888888888',
  appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  portfolioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  dailyStatId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.barber-access-token-example',
  refreshToken: 'eyJhbGciOiJIUzI1NiJ9.barber-refresh-token-example',
  imageUrl: 'https://api.bombbarbershop.com/public/uploads/portfolio/barber-work.webp'
} as const;

export const barberUuidField = (description: string, example: string) =>
  t.String({
    format: 'uuid',
    description,
    examples: [example]
  });

export const barberSuccessEnvelope = (
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

export const barberErrorEnvelope = (
  message: string,
  errors: unknown = null
) => ({
  success: false,
  message,
  data: null,
  errors,
  meta: null
});

export type BarberResponseExample = {
  status: number;
  description: string;
  message: string;
  errors?: unknown;
};

type BarberDetailOptions = {
  tag: string;
  summary: string;
  description: string;
  required?: string[];
  optional?: string[];
  successStatus?: number;
  successDescription?: string;
  successMessage?: string;
  successData?: unknown;
  errors?: BarberResponseExample[];
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

export const barberDetail = ({
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
}: BarberDetailOptions): any => {
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
              value: barberSuccessEnvelope(successMessage, successData)
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
        value: barberErrorEnvelope(error.message, error.errors ?? null)
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
              value: barberErrorEnvelope(error.message, error.errors ?? null)
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

export const barberAuthError: BarberResponseExample = {
  status: 401,
  description: 'Access token staff tidak tersedia, tidak valid, kedaluwarsa, atau akun staff tidak aktif.',
  message: 'Missing or invalid token'
};

export const barberRoleError: BarberResponseExample = {
  status: 403,
  description: 'Staff terautentikasi tetapi tidak memiliki profil barber atau mencoba mengakses appointment barber lain.',
  message: 'Forbidden: endpoint ini hanya untuk barber'
};

export const barberValidationError: BarberResponseExample = {
  status: 400,
  description: 'Path parameter, query parameter, body, atau aturan bisnis tidak valid.',
  message: 'Validasi gagal',
  errors: [{ field: 'body', message: 'Data request tidak valid' }]
};

export const barberServerError: BarberResponseExample = {
  status: 500,
  description: 'Terjadi kegagalan internal saat membaca atau menyimpan data.',
  message: 'Internal Server Error'
};

export const barberProtectedErrors = [
  barberAuthError,
  barberRoleError,
  barberValidationError
];
