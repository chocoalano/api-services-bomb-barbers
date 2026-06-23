import { Elysia } from 'elysia';
import { MediaController } from './controller';
import { mediaDocs } from './docs';

export const mediaRoutes = new Elysia({ prefix: '/api/v1/media' })
  .post('/upload', MediaController.upload, mediaDocs.upload);
