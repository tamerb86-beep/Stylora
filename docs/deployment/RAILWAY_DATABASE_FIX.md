# Railway Database Connection Fix Guide

## Problem
The Stylora application was experiencing "Database connection error" when trying to save iZettle OAuth tokens because the `DATABASE_URL` environment variable was not properly configured in Railway.

## Root Cause
- The application code uses `process.env.DATABASE_URL` to connect to MySQL
- Railway MySQL service provides `MYSQL_URL` and `MYSQL_PUBLIC_URL` variables
- The stylora service did not have a `DATABASE_URL` variable that references the MySQL service

## Solution

### Step 1: Add DATABASE_URL Variable Reference

1. Open your Railway project dashboard
2. Click on the **stylora** service (NOT the MySQL service)
3. Go to the **Variables** tab
4. Click **+ New Variable**
5. Configure as follows:
   - **Variable Name**: `DATABASE_URL`
   - **Variable Type**: Select **Variable Reference**
   - **Reference**: Select `${{MySQL.MYSQL_URL}}`

### Step 2: Verify the Configuration

After adding the variable, you should see:
```
DATABASE_URL = ${{MySQL.MYSQL_URL}}
```

This will automatically resolve to:
```
mysql://root:rQskZdQhNxeaTZCOxWFGKQCYZBGcyHlJ@mysql.railway.internal:3306/railway
```

### Step 3: Redeploy

Railway will automatically redeploy your application with the new environment variable.

Wait for the deployment to complete (you'll see "Online" status).

### Step 4: Test the Connection

1. Open your application URL
2. Go to **iZettle Settings** page
3. Click **Connect to iZettle**
4. Complete the OAuth flow
5. Verify that the connection is saved successfully (no "Database connection error")

## Why This Works

- `mysql.railway.internal` is Railway's **private network** address
- It only works when services are in the **same Railway project**
- By using Variable Reference `${{MySQL.MYSQL_URL}}`, the stylora service can access the MySQL service through the private network
- This is faster and more secure than using the public URL

## Alternative: Using Public URL

If you need to connect from outside Railway (e.g., local development), use:

```
DATABASE_URL=${{MySQL.MYSQL_PUBLIC_URL}}
```

This resolves to:
```
mysql://root:rQskZdQhNxeaTZCOxWFGKQCYZBGcyHlJ@containers-us-west-xxx.railway.app:57194/railway
```

**Note**: The public URL is slower and should only be used when necessary.

## Verification Checklist

- [ ] `DATABASE_URL` variable added to stylora service
- [ ] Variable references `${{MySQL.MYSQL_URL}}`
- [ ] Application redeployed successfully
- [ ] iZettle OAuth connection works without errors
- [ ] Tokens are saved to `paymentProviders` table in database

## Troubleshooting

### Error: "Cannot connect to mysql.railway.internal"
- Ensure both services (stylora and MySQL) are in the **same Railway project**
- Verify MySQL service is **Online**

### Error: "Access denied for user 'root'"
- Check that the password in `MYSQL_URL` matches `MYSQL_ROOT_PASSWORD`
- Verify the MySQL service variables are correct

### Error: "Unknown database 'railway'"
- Ensure the database name in the URL matches `MYSQL_DATABASE` variable
- Default is usually `railway`

## Additional Resources

- [Railway Documentation - Service Variables](https://docs.railway.app/develop/variables)
- [Railway Documentation - Private Networking](https://docs.railway.app/reference/private-networking)
- [Drizzle ORM - MySQL Setup](https://orm.drizzle.team/docs/get-started-mysql2)

---

**Last Updated**: December 18, 2024  
**Status**: ✅ Solution Verified
