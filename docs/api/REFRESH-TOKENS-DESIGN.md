# Refresh Tokens Architecture

## Overview

This document describes the refresh token implementation for Stylora to allow automatic session renewal without requiring users to re-login every 30 days.

---

## Architecture

### Token Types

1. **Access Token (JWT)**
   - Short-lived: 30 days
   - Contains user session data
   - Sent with every API request
   - Stored in HTTP-only cookie

2. **Refresh Token**
   - Long-lived: 90 days
   - Used only to obtain new access tokens
   - Stored in database with metadata
   - Sent in separate HTTP-only cookie
   - Can be revoked

---

## Database Schema

```typescript
export const refreshTokens = mysqlTable("refreshTokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  userId: int("userId").notNull(),
  tenantId: varchar("tenantId", { length: 255 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: varchar("userAgent", { length: 500 }),
  revoked: boolean("revoked").default(false).notNull(),
  revokedAt: timestamp("revokedAt"),
  revokedReason: varchar("revokedReason", { length: 255 }),
});
```

**Indexes:**
- `token` (unique) - for fast lookup
- `userId` - for user's token management
- `tenantId` - for tenant isolation
- `expiresAt` - for cleanup queries

---

## Flow Diagram

```
┌─────────┐                 ┌─────────┐                 ┌──────────┐
│ Client  │                 │  Server │                 │ Database │
└────┬────┘                 └────┬────┘                 └─────┬────┘
     │                           │                            │
     │ 1. POST /auth/login       │                            │
     ├──────────────────────────>│                            │
     │   {email, password}       │                            │
     │                           │ 2. Verify credentials      │
     │                           ├───────────────────────────>│
     │                           │                            │
     │                           │ 3. Create access token     │
     │                           │    (JWT, 30 days)          │
     │                           │                            │
     │                           │ 4. Create refresh token    │
     │                           │    (random, 90 days)       │
     │                           ├───────────────────────────>│
     │                           │<───────────────────────────┤
     │                           │                            │
     │ 5. Set cookies:           │                            │
     │    - access_token         │                            │
     │    - refresh_token        │                            │
     │<──────────────────────────┤                            │
     │                           │                            │
     │                           │                            │
     │ 6. API request            │                            │
     ├──────────────────────────>│                            │
     │   Cookie: access_token    │ 7. Verify access token     │
     │                           │    (JWT verify)            │
     │                           │                            │
     │ 8. Response               │                            │
     │<──────────────────────────┤                            │
     │                           │                            │
     │                           │                            │
     │ [30 days later]           │                            │
     │                           │                            │
     │ 9. API request            │                            │
     ├──────────────────────────>│                            │
     │   Cookie: expired token   │ 10. Token expired (401)    │
     │<──────────────────────────┤                            │
     │                           │                            │
     │ 11. POST /auth/refresh    │                            │
     ├──────────────────────────>│                            │
     │   Cookie: refresh_token   │ 12. Verify refresh token   │
     │                           ├───────────────────────────>│
     │                           │<───────────────────────────┤
     │                           │                            │
     │                           │ 13. Create new access token│
     │                           │                            │
     │                           │ 14. Update lastUsedAt      │
     │                           ├───────────────────────────>│
     │                           │                            │
     │ 15. Set new access_token  │                            │
     │<──────────────────────────┤                            │
     │                           │                            │
     │ 16. Retry original request│                            │
     ├──────────────────────────>│                            │
     │<──────────────────────────┤                            │
     │                           │                            │
```

---

## API Endpoints

### 1. POST /auth/login
**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "user@example.com"
  }
}
```

**Cookies Set:**
- `app_session_id` (access token, 30 days, httpOnly, secure)
- `app_refresh_token` (refresh token, 90 days, httpOnly, secure)

---

### 2. POST /auth/refresh
**Request:**
- Cookie: `app_refresh_token`

**Response:**
```json
{
  "success": true
}
```

**Cookies Set:**
- `app_session_id` (new access token, 30 days, httpOnly, secure)

**Error Responses:**
- `401` - Refresh token missing, invalid, expired, or revoked
- `403` - Refresh token belongs to different tenant

---

### 3. POST /auth/logout
**Request:**
- Cookie: `app_session_id`
- Cookie: `app_refresh_token`

**Response:**
```json
{
  "success": true
}
```

**Actions:**
- Revoke refresh token in database
- Clear both cookies

---

### 4. POST /auth/logout-all
**Request:**
- Cookie: `app_session_id`

**Response:**
```json
{
  "success": true,
  "revokedCount": 3
}
```

**Actions:**
- Revoke ALL refresh tokens for the user
- Clear cookies
- Useful for "logout from all devices"

---

## Client-Side Implementation

### Automatic Token Refresh

```typescript
// client/src/lib/api-client.ts

import { toast } from 'sonner';

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include', // Include cookies
    });

    if (response.ok) {
      return true;
    }
    
    // Refresh token expired or invalid
    return false;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

// Intercept 401 responses
export async function apiRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  // If 401, try to refresh token
  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      
      const refreshed = await refreshAccessToken();
      
      if (refreshed) {
        isRefreshing = false;
        onRefreshed('refreshed');
        
        // Retry original request
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      } else {
        isRefreshing = false;
        
        // Redirect to login
        toast.error('Session expired. Please login again.');
        window.location.href = '/login';
        
        throw new Error('Session expired');
      }
    } else {
      // Wait for refresh to complete
      return new Promise((resolve, reject) => {
        subscribeTokenRefresh(() => {
          fetch(url, {
            ...options,
            credentials: 'include',
          }).then(resolve).catch(reject);
        });
      });
    }
  }

  return response;
}
```

---

## Security Considerations

### 1. Token Storage
- ✅ Both tokens stored in HTTP-only cookies
- ✅ Secure flag enabled in production
- ✅ SameSite=Strict to prevent CSRF
- ❌ Never store in localStorage or sessionStorage

### 2. Token Rotation
- On each refresh, optionally issue a new refresh token
- Revoke old refresh token
- Prevents token reuse attacks

### 3. Token Revocation
- Store refresh tokens in database
- Can revoke individual tokens
- Can revoke all tokens for a user
- Check revocation status on each use

### 4. Expiry Times
- Access token: 30 days (short-lived)
- Refresh token: 90 days (long-lived)
- Refresh token should be longer than access token

### 5. Tenant Isolation
- Refresh tokens include tenantId
- Verify tenantId matches on refresh
- Prevents cross-tenant token use

### 6. Rate Limiting
- Limit refresh endpoint to 10 requests per minute per IP
- Prevents brute force attacks

### 7. Audit Trail
- Log all token refresh attempts
- Track IP address and user agent
- Monitor for suspicious activity

---

## Database Cleanup

### Expired Tokens
Run daily cleanup job to delete expired tokens:

```sql
DELETE FROM refreshTokens 
WHERE expiresAt < NOW() 
  OR (revoked = true AND revokedAt < DATE_SUB(NOW(), INTERVAL 30 DAY));
```

### Revoked Tokens
Keep revoked tokens for 30 days for audit purposes, then delete.

---

## Testing Checklist

- [ ] Login creates both access and refresh tokens
- [ ] Access token expires after 30 days
- [ ] Refresh token can renew access token
- [ ] Refresh token expires after 90 days
- [ ] Expired refresh token returns 401
- [ ] Revoked refresh token returns 401
- [ ] Logout revokes refresh token
- [ ] Logout-all revokes all user's tokens
- [ ] Tenant isolation prevents cross-tenant refresh
- [ ] Client automatically refreshes on 401
- [ ] Multiple simultaneous refreshes handled correctly
- [ ] Rate limiting works on refresh endpoint

---

## Migration Plan

1. Add refreshTokens table to schema
2. Run database migration
3. Update login endpoint to create refresh token
4. Add refresh endpoint
5. Update logout to revoke refresh token
6. Add logout-all endpoint
7. Update client to handle 401 and refresh
8. Test thoroughly
9. Deploy to production
10. Monitor logs for issues

---

## Rollback Plan

If issues arise:

1. Remove client-side refresh logic
2. Increase access token expiry back to 1 year
3. Keep refresh token table for future use
4. No data loss - users just need to login again

---

## Future Enhancements

1. **Token Rotation**: Issue new refresh token on each refresh
2. **Device Management**: Show user all active sessions
3. **Suspicious Activity Detection**: Revoke tokens on unusual behavior
4. **Push Notifications**: Notify user of new login from unknown device
5. **Biometric Re-authentication**: Require fingerprint/face ID for sensitive operations

---

**Last Updated:** December 2024
