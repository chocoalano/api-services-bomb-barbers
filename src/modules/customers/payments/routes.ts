import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { CustomerPaymentController, InvoiceController } from './controller';
import { paymentDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const customerPaymentRoutes = new Elysia()
  // ── Canonical: /api/v1/customers ──────────────────────────────────────────
  .get('/api/v1/customers/invoices/:invoiceNumber', InvoiceController.getPublicInvoiceReceipt, paymentDocs.getPublicInvoice)
  .group('/api/v1/customers/invoices', (app) => app
    .use(customerAuthMiddleware)
    .get('/:invoiceNumber', InvoiceController.getCustomerInvoiceReceipt, paymentDocs.getInvoice)
  )
  .group('/api/v1/customers/payments', (app) => app
    .use(customerAuthMiddleware)
    .get('/:id', CustomerPaymentController.getMyPaymentDetail, paymentDocs.customerGetPayment)
  )
  .group('/api/v1/customers/appointments', (app) => app
    .use(customerAuthMiddleware)
    .get('/:id/payment', CustomerPaymentController.getPaymentByAppointment)
    .post('/:id/payments', CustomerPaymentController.createPayment, paymentDocs.customerCreatePayment)
  )
  // ── Deprecated: /api/v1/invoices → /api/v1/customers/invoices ─────────────
  .get('/api/v1/invoices/:invoiceNumber', deprecated('/api/v1/customers/invoices/:invoiceNumber', InvoiceController.getPublicInvoiceReceipt), deprecatedDetail)
  // ── Deprecated: /api/v1/customer/* → /api/v1/customers/* ──────────────────
  .group('/api/v1/customer/invoices', (app) => app
    .use(customerAuthMiddleware)
    .get('/:invoiceNumber', deprecated('/api/v1/customers/invoices/:invoiceNumber', InvoiceController.getCustomerInvoiceReceipt), deprecatedDetail)
  )
  .group('/api/v1/customer/payments', (app) => app
    .use(customerAuthMiddleware)
    .get('/:id', deprecated('/api/v1/customers/payments/:id', CustomerPaymentController.getMyPaymentDetail), deprecatedDetail)
  )
  .group('/api/v1/customer/appointments', (app) => app
    .use(customerAuthMiddleware)
    // Canonical /payments chosen; /payment (singular) is the historical alias
    .post('/:id/payment', deprecated('/api/v1/customers/appointments/:id/payments', CustomerPaymentController.createPayment), deprecatedDetail)
    .post('/:id/payments', deprecated('/api/v1/customers/appointments/:id/payments', CustomerPaymentController.createPayment), deprecatedDetail)
  );
