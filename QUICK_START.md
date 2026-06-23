# 🚀 QUICK START: Apply Migrations to Supabase

## ⚠️ Problem
Network blocks PostgreSQL connection (port 5432) to Supabase.

## ✅ Solution
Execute migrations via Supabase dashboard (REST API, works fine).

---

## 📝 3-Step Quick Execute

### STEP 1: Open Supabase SQL Editor
```
https://app.supabase.com/project/fbvdazkwvueewghjysqa/sql/new
```

### STEP 2: Copy Migration SQL
**File:** `MIGRATIONS_TO_APPLY.sql`

**How to copy:**
1. Open file in your code editor
2. Find the section between these lines:
   ```
   -- START PASTE FROM HERE:
   ```
   and
   ```
   -- END PASTE HERE
   ```
3. Copy that entire section (Cmd+C / Ctrl+C)

### STEP 3: Execute in Supabase
1. Paste the SQL in Supabase SQL Editor (Cmd+V / Ctrl+V)
2. Click the **"Run"** button (top right or Cmd+Enter)
3. Wait 10-30 seconds for execution
4. Should see ✅ success message

---

## ✨ What Gets Applied
```
✅ 9 migrations total
✅ All core tables
✅ **NEW**: chat_messages table (for Live Chat API)
```

**chat_messages table structure:**
```sql
CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY,
  "appointment_id" uuid NOT NULL,
  "sender_id" uuid NOT NULL,
  "sender_role" varchar(20) CHECK (IN 'customer', 'barber'),
  "text" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "deleted_at" timestamp (nullable)
);
```

---

## 🔍 Verify Success

After executing migration in Supabase:

```bash
# Test the REST endpoint
bun run tests/chat.test.ts
```

**Expected output:**
```
✅ chat REST endpoint test PASSED
```

---

## 🎯 Done!

Your database is now ready for:
- ✅ Live Chat REST API (`GET /api/v1/customer/appointments/:id/chat`)
- ✅ Socket.io WebSocket messaging (`ws://localhost:3000`)
- ✅ Chat history retrieval with pagination

---

## 🆘 If Something Goes Wrong

**Error: "table already exists"**
→ Some migrations were already applied. This is OK - the `IF NOT EXISTS` clause handles it.

**Error: "constraint violation"**
→ Try running migrations one at a time. Check which migration failed.

**SQL Editor shows error**
→ Copy-paste the exact SQL between the markers. Don't edit or remove lines.

---

**Generated:** 2026-06-15  
**Status:** Ready to execute  
**Approx. Time:** 1-2 minutes
