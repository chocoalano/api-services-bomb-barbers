---
name: project-p1-barbers
description: P1 admin barber management — endpoints, permissions, tests
metadata:
  type: project
---

Implemented P1 admin barber management. All 367 tests pass.

**New endpoints:**
- `GET  /api/v1/admin/branches/:branchId/barbers` — list with Redis live_status + active appointment count
- `GET  /api/v1/admin/branches/:branchId/barbers/:barberId/schedule?date=YYYY-MM-DD` — per-barber calendar
- `PATCH /api/v1/admin/branches/:branchId/barbers/:barberId/status` — override barber status
- `PATCH /api/v1/admin/appointments/:id/barber` — reassign barber to appointment
- `GET  /api/v1/admin/audit-logs?branch_id=` — branch filter on audit log

**Key design decisions:**
- Permission for barber ops endpoints: `manage_appointment` (branch_admin has it; manage_barber is HQ-only)
- Branch scope: double `onBeforeHandle` chain (permission + branch scope) NOT array syntax
- `audit_logs.branch_id` added via migration `20260622100000_p1_admin_barbers.sql`
- `AuditService.logAction` gains optional 8th param `branchId`
- Reassign barber: updates `appointments.barber_id`, inserts `appointment_events` BARBER_REASSIGNED, emits `emitNewOrder` to new barber
- `barbers` table has no `photo_url` — use `bio, rating_avg, rating_count` instead

**New files:**
- `src/modules/admin/barbers/service.ts`
- `src/modules/admin/barbers/controller.ts`
- `src/modules/admin/barbers/docs.ts`
- `src/modules/admin/barbers/routes.ts`
- `tests/p1-admin-barbers.test.ts` (31 tests)

**Why:** P1 audit requirement — branch admins need live visibility into barbers and ability to reassign/override without waiting for HQ.
**How to apply:** These endpoints require `manage_appointment` + branch scope; safe for branch_admin to call.
