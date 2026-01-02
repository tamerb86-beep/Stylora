# SaaS Admin Panel - Documentation

## Overview

The SaaS Admin Panel is a platform-level administration interface that allows the **platform owner** to manage all tenants (salons) in the Stylora multi-tenant SaaS application. This is a "meta" dashboard that sits above individual salon dashboards.

## Key Features

### 1. Platform-Wide Overview (`/saas-admin`)
- **Total Tenants**: Count of all registered salons
- **Active Tenants**: Tenants with active subscriptions
- **Trial Tenants**: Tenants in trial period
- **Suspended/Canceled Tenants**: Inactive tenants
- **Last 30 Days Metrics**:
  - Total appointments completed
  - Total orders placed
  - Total revenue from orders
- **Recent Tenants List**: Quick view of newly created salons

### 2. Tenants Management (`/saas-admin/tenants`)
- **List All Tenants** with pagination (20 per page)
- **Search** by:
  - Tenant name
  - Subdomain
  - Organization number
- **Filter** by status:
  - All
  - Trial
  - Active
  - Suspended
  - Canceled
- **Quick Actions**:
  - View tenant details
  - Impersonate tenant (log in as that salon)
- **Metrics per Tenant** (last 30 days):
  - Number of appointments
  - Number of orders
  - Total order amount

### 3. Tenant Details (`/saas-admin/tenants/:tenantId`)
- **Basic Information**:
  - Name, subdomain, org number
  - Creation date
  - Current status
  - Trial end date (if applicable)
- **Subscription Management**:
  - Current plan details
  - Subscription status
  - Billing period
  - Change plan (dropdown with all active plans)
  - Change status (trial/active/suspended/canceled)
- **Usage Statistics**:
  - Total customers
  - Total employees
  - Total appointments (all time + completed)
  - Total orders (all time + amount)
  - Last 30 days breakdown
- **Actions**:
  - Impersonate tenant
  - Update plan and status

### 4. Tenant Impersonation
- **Purpose**: Platform owner can "log in as" any tenant to:
  - Test features from tenant perspective
  - Troubleshoot issues
  - Provide support
- **How it works**:
  1. Click "Logg inn" button on tenant row or details page
  2. System creates new JWT with `impersonatedTenantId` field
  3. User is redirected to `/dashboard` with tenant context switched
  4. All subsequent requests use impersonated tenant's data
  5. To exit: Call `clearImpersonation` mutation (returns to `/saas-admin`)
- **Security**: Only accessible to user with `openId === ENV.ownerOpenId`

## Architecture

### Backend

#### Authorization Middleware
```typescript
// server/routers.ts
const platformAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access required" });
  }
  return next({ ctx });
});
```

#### tRPC Router: `saasAdmin`
Located in `server/routers.ts`, includes:

1. **getOverview**: Platform-wide statistics
   - Input: None
   - Output: Stats object with tenant counts and 30-day metrics

2. **listTenants**: Paginated tenant list with search/filter
   - Input: `{ search?, status?, page?, pageSize? }`
   - Output: `{ items, page, pageSize, totalItems, totalPages }`

3. **getTenantDetails**: Detailed tenant information
   - Input: `{ tenantId }`
   - Output: `{ tenant, subscription, usage }`

4. **updateTenantPlanAndStatus**: Update tenant subscription
   - Input: `{ tenantId, status?, planId? }`
   - Output: `{ success, tenant }`

5. **getSubscriptionPlans**: List all active subscription plans
   - Input: None
   - Output: Array of active plans

6. **impersonateTenant**: Impersonate a tenant
   - Input: `{ tenantId }`
   - Output: `{ success, redirectUrl, tenantId, tenantName }`
   - Side effect: Sets new JWT cookie with `impersonatedTenantId`

7. **clearImpersonation**: Exit impersonation mode
   - Input: None
   - Output: `{ success, redirectUrl }`
   - Side effect: Sets new JWT cookie without `impersonatedTenantId`

#### Impersonation Implementation

**JWT Payload Extension** (`server/_core/sdk.ts`):
```typescript
export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  impersonatedTenantId: string | null; // Added field
};
```

**Session Context Override** (`server/_core/sdk.ts`):
```typescript
async authenticateRequest(req: Request): Promise<User> {
  // ... existing auth logic ...
  
  // Handle impersonation
  if (session.impersonatedTenantId && session.openId === ENV.ownerOpenId) {
    if (user) {
      user = { ...user, tenantId: session.impersonatedTenantId };
    }
  }
  
  return user;
}
```

### Frontend

#### Pages
- `client/src/pages/SaasAdmin/SaasAdminOverview.tsx`
- `client/src/pages/SaasAdmin/SaasAdminTenants.tsx`
- `client/src/pages/SaasAdmin/SaasAdminTenantDetails.tsx`

#### Routes (in `client/src/App.tsx`)
```typescript
<Route path="/saas-admin" component={SaasAdminOverview} />
<Route path="/saas-admin/tenants" component={SaasAdminTenants} />
<Route path="/saas-admin/tenants/:tenantId" component={SaasAdminTenantDetails} />
```

#### Design
- **Color Scheme**: Gradient blue → purple for SaaS admin branding
- **Stats Cards**: Glassmorphism effect with gradient backgrounds
- **Responsive**: Full mobile support
- **Norwegian Language**: All UI text in Norwegian

### Testing

**Test File**: `server/saasAdmin.test.ts`

**Coverage**: 14 comprehensive tests
- ✅ Authorization (platform owner vs regular user)
- ✅ getOverview returns correct structure
- ✅ listTenants with pagination, search, filtering
- ✅ getTenantDetails with usage stats
- ✅ updateTenantPlanAndStatus
- ✅ getSubscriptionPlans
- ✅ impersonateTenant (success + error cases)
- ✅ clearImpersonation

**Run tests**:
```bash
pnpm test server/saasAdmin.test.ts
```

## Access Control

### Environment Variable
The platform owner is identified by:
```
OWNER_OPEN_ID=<platform-owner-openid>
```

This is automatically set by the Stylora platform and available in `ENV.ownerOpenId`.

### Frontend Protection
While routes are not explicitly protected on the frontend, all backend procedures use `platformAdminProcedure` which throws `FORBIDDEN` error if accessed by non-owner.

**Recommendation**: Add frontend route guard to redirect non-owners away from `/saas-admin/*` routes for better UX.

## Usage in Production

### Accessing the Panel
1. Log in to Stylora as the platform owner
2. Navigate to `/saas-admin`
3. You'll see the platform overview dashboard

### Common Tasks

#### View All Tenants
1. Go to `/saas-admin/tenants`
2. Use search bar to find specific tenant
3. Use status filter to view only active/trial/suspended tenants

#### Change Tenant Plan
1. Go to tenant details: `/saas-admin/tenants/:tenantId`
2. Scroll to "Abonnement" section
3. Select new plan from dropdown
4. Select new status if needed
5. Click "Lagre endringer"

#### Impersonate Tenant for Support
1. Find tenant in list or details page
2. Click "Logg inn" button
3. You'll be redirected to `/dashboard` with that tenant's context
4. Perform troubleshooting/testing
5. To exit: Call `trpc.saasAdmin.clearImpersonation.useMutation()` (or manually navigate to `/saas-admin`)

**Note**: Currently there's no UI button to exit impersonation. Recommended to add a banner at the top of the dashboard when impersonating with "Exit Impersonation" button.

## Database Schema

### Relevant Tables
- `tenants`: Tenant basic info and status
- `subscriptions`: Tenant subscription details
- `subscriptionPlans`: Available plans
- `users`: Tenant users (for employee/customer counts)
- `appointments`: For usage metrics
- `orders`: For revenue metrics

### Key Queries
All complex aggregation queries are in `server/routers.ts` within the `saasAdmin` router. Examples:
- Count tenants by status
- Sum orders/appointments in last 30 days
- Join subscriptions with plans for tenant details

## Security Considerations

1. **Authorization**: All procedures require `platformAdminProcedure` which checks `ctx.user.openId === ENV.ownerOpenId`
2. **Impersonation Audit**: Consider adding audit log when platform owner impersonates a tenant
3. **Session Hijacking**: Impersonation creates new JWT, doesn't modify existing session
4. **Tenant Isolation**: When not impersonating, platform owner's own `tenantId` is used (if they have one)

## Future Enhancements

### Recommended Additions
1. **Impersonation Banner**: Show banner when impersonating with "Exit" button
2. **Audit Logs**: Track all platform admin actions (plan changes, impersonations)
3. **Tenant Analytics**: More detailed charts (revenue trends, churn rate, etc.)
4. **Bulk Actions**: Suspend multiple tenants, send announcements
5. **Tenant Onboarding**: Wizard to create new tenant from admin panel
6. **Support Tickets**: Integration with support system
7. **Billing Integration**: View Stripe subscription details, handle failed payments
8. **Usage Limits**: Enforce plan limits (max employees, max appointments/month)
9. **White-label Settings**: Per-tenant branding configuration
10. **API Access**: Generate API keys for tenants

## Files Modified/Created

### Backend
- `server/routers.ts`: Added `platformAdminProcedure` and `saasAdmin` router
- `server/_core/sdk.ts`: Extended `SessionPayload` with `impersonatedTenantId`
- `server/_core/env.ts`: Already had `ownerOpenId` (no changes needed)
- `server/saasAdmin.test.ts`: **Created** - 14 comprehensive tests

### Frontend
- `client/src/App.tsx`: Added 3 SaaS admin routes
- `client/src/pages/SaasAdmin/SaasAdminOverview.tsx`: **Created**
- `client/src/pages/SaasAdmin/SaasAdminTenants.tsx`: **Created**
- `client/src/pages/SaasAdmin/SaasAdminTenantDetails.tsx`: **Created**

### Documentation
- `SAAS_ADMIN_PANEL.md`: **Created** - This file
- `todo.md`: Added Phase 42 with 114 tasks (all completed)

## Troubleshooting

### "Platform admin access required" error
- Verify you're logged in as the platform owner
- Check `ENV.ownerOpenId` matches your `openId`
- Check browser console for JWT payload

### Impersonation not working
- Verify tenant exists in database
- Check browser cookies - should see new JWT after impersonation
- Check `ctx.user.tenantId` in subsequent requests

### Statistics showing zero
- Verify tenants have data in `appointments` and `orders` tables
- Check date filtering (last 30 days calculation)
- Run queries manually in database to verify data exists

## Support

For issues or questions about the SaaS Admin Panel:
1. Check this documentation
2. Review test file `server/saasAdmin.test.ts` for usage examples
3. Check browser console for tRPC errors
4. Review server logs for authorization failures
