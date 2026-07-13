import { Elysia } from 'elysia';
import { CustomerAddressController } from './controller';
import { addressDocs } from './docs';
import { customerAuthMiddleware } from '../../../middleware/auth';

export const customerAddressRoutes = new Elysia()
  .group('/api/v1/customers/addresses', (app) => app
    .use(customerAuthMiddleware)
    .get('', CustomerAddressController.list, addressDocs.list)
    .post('', CustomerAddressController.create, addressDocs.create)
    .patch('/:id', CustomerAddressController.update, addressDocs.update)
    .delete('/:id', CustomerAddressController.remove, addressDocs.remove)
  );
