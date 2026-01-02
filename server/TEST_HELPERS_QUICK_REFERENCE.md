# Test Helpers Quick Reference

This is a quick reference guide for using the centralized test helpers in Stylora. For the complete testing strategy, see [TESTING_STRATEGY.md](../TESTING_STRATEGY.md).

## Quick Start

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../routers";
import {
  createTestEnvironment,
  cleanupTestTenant,
  TEST_TIMEOUTS,
} from "../test-helpers";

describe("My Feature", () => {
  let tenantId: string;
  let mockContext: any;

  beforeAll(async () => {
    const env = await createTestEnvironment();
    tenantId = env.tenantId;
    mockContext = env.mockContext;
  }, TEST_TIMEOUTS.MEDIUM);

  afterAll(async () => {
    await cleanupTestTenant(tenantId);
  });

  it("should work", async () => {
    const caller = appRouter.createCaller(mockContext);
    const result = await caller.myFeature.myMethod();
    expect(result).toBeDefined();
  });
});
```

## Available Functions

### `createTestEnvironment(tenantConfig?, userConfig?)`

Creates a complete test environment with verified tenant and admin user.

**Defaults:**
- `emailVerified: true`
- `status: "active"`
- `role: "admin"`

**Returns:** `{ tenantId, userId, tenant, user, mockContext }`

### `createTestTenant(config?)`

Creates a standalone tenant.

**Options:** `name`, `subdomain`, `email`, `emailVerified`, `status`

**Returns:** `{ tenantId, tenant }`

### `createTestUser(tenantId, config?)`

Creates a user for a tenant.

**Options:** `firstName`, `lastName`, `email`, `role`, `phone`

**Returns:** `{ userId, user }`

### `createTestEmployee(tenantId, pin?)`

Creates an employee with PIN for time clock testing.

**Returns:** `{ userId, user, pin }`

### `cleanupTestTenant(tenantId)`

Deletes tenant and all associated data. **Always use in `afterAll` hook.**

## Common Patterns

### Basic Test

```typescript
const { mockContext } = await createTestEnvironment();
const caller = appRouter.createCaller(mockContext);
```

### Multiple Roles

```typescript
const { mockContext: adminContext } = await createTestEnvironment();
const { userId, user } = await createTestEmployee(tenantId);

const employeeContext = {
  user: {
    id: userId,
    tenantId: user.tenantId,
    openId: user.openId,
    email: user.email,
    name: user.name,
    role: user.role,
  },
  req: {} as any,
  res: {} as any,
};
```

### Custom Configuration

```typescript
const env = await createTestEnvironment(
  { emailVerified: false, status: "trial" },
  { role: "owner" }
);
```

## Timeouts

```typescript
TEST_TIMEOUTS.SHORT   // 5 seconds
TEST_TIMEOUTS.MEDIUM  // 10 seconds
TEST_TIMEOUTS.LONG    // 30 seconds
```

## Key Benefits

✅ **Automatic setup** - All required fields set correctly  
✅ **Consistent context** - Proper structure every time  
✅ **Easy cleanup** - One function removes all test data  
✅ **No conflicts** - Unique IDs generated automatically  
✅ **Type-safe** - Full TypeScript support

## Before/After Comparison

### Before (Manual Setup)

```typescript
const testTenantId = `test-${Date.now()}`;
await db.insert(tenants).values({
  id: testTenantId,
  name: "Test",
  subdomain: `test-${Date.now()}`,
  status: "active",
  emailVerified: true,
  emailVerifiedAt: new Date(),
  // ... many more fields
});

const testUserId = Math.floor(Math.random() * 1000000);
await db.insert(users).values({
  id: testUserId,
  tenantId: testTenantId,
  openId: `test-${Date.now()}`,
  // ... many more fields
});

const caller = appRouter.createCaller({
  user: {
    id: testUserId,
    tenantId: testTenantId,
    role: "admin",
    // ... might forget required fields
  },
});
```

### After (With Helpers)

```typescript
const { mockContext } = await createTestEnvironment();
const caller = appRouter.createCaller(mockContext);
```

## Need More Details?

See [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) for:
- Complete function documentation
- Migration guide
- Best practices
- Common pitfalls and solutions
- Advanced patterns
