# Railway Deployment Fix - Database Migrations

## Problem
iZettle OAuth fails with "Database connection error" because the `paymentProviders` table doesn't exist in Railway MySQL.

**Error in logs:**
```
[iZettle Callback] Database query failed: Failed query: select ... from `paymentProviders`
```

## Root Cause
The database schema is defined in code (`drizzle/schema.ts`) but the tables haven't been created in Railway MySQL database.

## Solution

### Step 1: Verify DATABASE_URL is Set
✅ Already done! You have:
```
DATABASE_URL = mysql://root:***@mysql.railway.internal:3306/railway
```

### Step 2: Trigger Redeploy in Railway
The `build` script has been updated to run migrations automatically:

**New build command:**
```json
"build": "drizzle-kit generate && drizzle-kit migrate && vite build && esbuild ..."
```

**What this does:**
1. `drizzle-kit generate` - Generates SQL migration files from schema
2. `drizzle-kit migrate` - Applies migrations to create/update tables
3. `vite build` - Builds frontend
4. `esbuild` - Builds backend

### Step 3: Redeploy in Railway
1. Go to Railway dashboard
2. Open **stylora** service
3. Click **"Deployments"** tab
4. Click **"Redeploy"** on the latest deployment

OR simply push to GitHub - Railway will auto-deploy:
```bash
git push origin main
```

### Step 4: Verify Tables Created
After deployment completes, check Railway logs for:
```
✅ Migrations applied successfully
✅ [Database] Connection successful!
```

### Step 5: Test iZettle OAuth
1. Go to your app: https://stylora-production-5d35.up.railway.app
2. Navigate to **Betalingsterminaler**
3. Click **"Koble til iZettle"**
4. Complete OAuth flow
5. ✅ Should save tokens successfully!

## Expected Outcome
After redeployment:
- ✅ All database tables created (paymentProviders, users, bookings, etc.)
- ✅ iZettle OAuth saves tokens successfully
- ✅ No more "Database connection error"

## Troubleshooting

### If migrations fail:
Check Railway logs for specific error. Common issues:
- **Permission denied**: Ensure DATABASE_URL has correct credentials
- **Table already exists**: Safe to ignore, migrations are idempotent
- **Connection timeout**: Check if MySQL service is running

### If still getting errors:
1. Check Railway logs: `Deployments → View Logs`
2. Verify DATABASE_URL points to correct MySQL instance
3. Ensure MySQL service is in same Railway project
4. Check if `drizzle-kit` is in dependencies (it is!)

## Files Modified
- ✅ `package.json` - Updated build script to run migrations
- ✅ `server/db.ts` - Fixed mysql2 connection
- ✅ `client/src/pages/PaymentProviders.tsx` - Added iZettle integration

## Next Steps After Fix
1. Test all payment providers (Vipps, Stripe Terminal, iZettle)
2. Verify tokens persist after OAuth
3. Test payment processing end-to-end
4. Monitor Railway logs for any database errors
