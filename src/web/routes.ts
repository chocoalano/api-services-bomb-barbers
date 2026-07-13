import { Elysia } from 'elysia';
import { renderInertia } from './inertia/renderer';

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location }
  });

export const webRoutes = new Elysia()
  .get('/web/health', () => ({
    success: true,
    message: 'Bomb Barbershop web layer is healthy',
    data: null
  }))
  .get('/', () => redirect('/backoffice/dashboard'))
  .get('/backoffice', () => redirect('/backoffice/dashboard'))
  .get('/backoffice/login', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Login'
    })
  )
  .get('/backoffice/dashboard', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Dashboard'
    })
  )
  .get('/backoffice/appointments', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Appointments'
    })
  )
  .get('/backoffice/branches', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Branches'
    })
  )
  .get('/backoffice/barbers', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Barbers'
    })
  )
  .get('/backoffice/barbers-pending', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/PendingBarbers'
    })
  )
  .get('/backoffice/customers', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Customers'
    })
  )
  .get('/backoffice/users', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Users'
    })
  )
  .get('/backoffice/roles', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Roles'
    })
  )
  .get('/backoffice/payments', ({ request, set }) =>
    renderInertia({
      request,
      set,
      component: 'backoffice/Payments'
    })
  );
