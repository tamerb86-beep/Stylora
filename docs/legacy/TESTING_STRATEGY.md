# Stylora Testing Strategy

**Author:** Stylora Team  
**Last Updated:** December 10, 2024

## Overview

This document outlines the systematic testing strategy for Stylora, a multi-tenant SaaS application. The strategy emphasizes consistency, maintainability, and reliability through centralized test helpers and standardized patterns.

## Core Principles

### 1. Centralized Test Utilities

All test setup logic is consolidated in `server/test-helpers.ts`, providing a single source of truth for creating test environments. This approach eliminates code duplication and ensures that all tests start with properly configured data, including critical fields like `emailVerified`, `tenantId`, and user context.

### 2. Complete Test Environments

Tests should use `createTestEnvironment()` to establish a fully configured tenant and admin user in a single call. This function automatically sets sensible defaults for all required fields, reducing the cognitive load on developers and preventing common setup errors.

### 3. Automatic Cleanup

Every test suite must clean up its data using `cleanupTestTenant()` in the `afterAll` hook. This prevents test pollution and ensures that the database remains in a clean state for subsequent test runs.

### 4. Consistent Context Creation

All tRPC procedure calls require a properly structured context object. The test helpers provide pre-built `mockContext` objects that match the production context structure, ensuring that tests accurately reflect real-world usage.

## Test Helper Functions

### `createTestEnvironment(tenantConfig?, userConfig?)`

Creates a complete test environment with a verified tenant and admin user.

**Default Configuration:**

| Field | Default Value | Description |
|-------|---------------|-------------|
| `emailVerified` | `true` | Tenant email verification status |
| `emailVerifiedAt` | Current date | Timestamp of email verification |
| `status` | `"active"` | Tenant subscription status |
| `onboardingCompleted` | `true` | Onboarding completion flag |
| `role` | `"admin"` | User role in the system |

**Returns:**

```typescript
{
  tenantId: string,
  userId: number,
  tenant: TenantRecord,
  user: UserRecord,
  mockContext: {
    user: {
      id: number,
      tenantId: string,
      openId: string,
      email: string,
      name: string,
      role: "owner" | "admin" | "employee"
    },
    req: any,
    res: any
  }
}
```

**Example Usage:**

```typescript
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
```

### `createTestTenant(config?)`

Creates a standalone test tenant with all required fields.

**Customizable Fields:**

- `name`: Tenant business name
- `subdomain`: Unique subdomain identifier
- `email`: Contact email address
- `emailVerified`: Email verification status
- `status`: Subscription status (`"trial"`, `"active"`, `"suspended"`, `"canceled"`)

**Example:**

```typescript
const { tenantId, tenant } = await createTestTenant({
  name: "Custom Salon",
  status: "trial",
  emailVerified: false
});
```

### `createTestUser(tenantId, config?)`

Creates a test user associated with a specific tenant.

**Customizable Fields:**

- `firstName`: User's first name
- `lastName`: User's last name
- `email`: User's email address
- `role`: User role (`"owner"`, `"admin"`, `"employee"`)
- `phone`: Contact phone number

**Example:**

```typescript
const { userId, user } = await createTestUser(tenantId, {
  firstName: "John",
  lastName: "Doe",
  role: "owner"
});
```

### `createTestEmployee(tenantId, pin?)`

Creates a test employee with a PIN for time clock testing. The PIN is stored as plain text in the test database for simplicity.

**Parameters:**

- `tenantId`: The tenant ID to associate the employee with
- `pin`: Optional PIN (defaults to `"1234"`, max 6 characters)

**Returns:**

```typescript
{
  userId: number,
  user: UserRecord,
  pin: string  // Plain text PIN for testing
}
```

**Example:**

```typescript
const { userId, user, pin } = await createTestEmployee(tenantId, "5678");

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

const caller = appRouter.createCaller(employeeContext);
// Test employee-specific procedures
```

### `cleanupTestTenant(tenantId)`

Deletes a tenant and all associated records, including users. This function respects foreign key constraints by deleting dependent records first.

**Example:**

```typescript
afterAll(async () => {
  await cleanupTestTenant(tenantId);
});
```

### Utility Functions

#### `generateTestSubdomain()`

Generates a unique subdomain string for testing purposes, combining timestamp and random suffix.

#### `generateTestEmail()`

Generates a unique email address for testing purposes.

#### `hashTestPassword(password)`

Hashes a password using bcrypt with 10 salt rounds, matching production password hashing behavior.

#### `wait(ms)`

Returns a promise that resolves after the specified number of milliseconds, useful for testing asynchronous operations.

## Standard Patterns

### Basic Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../routers";
import {
  createTestEnvironment,
  cleanupTestTenant,
  TEST_TIMEOUTS,
} from "../test-helpers";

describe("Feature Name", () => {
  let tenantId: string;
  let userId: number;
  let mockContext: any;

  beforeAll(async () => {
    const env = await createTestEnvironment();
    tenantId = env.tenantId;
    userId = env.userId;
    mockContext = env.mockContext;
  }, TEST_TIMEOUTS.MEDIUM);

  afterAll(async () => {
    await cleanupTestTenant(tenantId);
  });

  it("should perform expected behavior", async () => {
    const caller = appRouter.createCaller(mockContext);
    const result = await caller.feature.method();
    expect(result).toBeDefined();
  });
});
```

### Testing with Multiple Roles

```typescript
describe("Role-Based Access Control", () => {
  let tenantId: string;
  let adminContext: any;
  let employeeContext: any;

  beforeAll(async () => {
    const env = await createTestEnvironment();
    tenantId = env.tenantId;
    adminContext = env.mockContext;

    const employee = await createTestEmployee(tenantId);
    employeeContext = {
      user: {
        id: employee.userId,
        tenantId: employee.user.tenantId,
        openId: employee.user.openId,
        email: employee.user.email,
        name: employee.user.name,
        role: employee.user.role,
      },
      req: {} as any,
      res: {} as any,
    };
  }, TEST_TIMEOUTS.MEDIUM);

  afterAll(async () => {
    await cleanupTestTenant(tenantId);
  });

  it("should allow admins to perform action", async () => {
    const caller = appRouter.createCaller(adminContext);
    const result = await caller.admin.action();
    expect(result.success).toBe(true);
  });

  it("should reject employees from performing action", async () => {
    const caller = appRouter.createCaller(employeeContext);
    await expect(
      caller.admin.action()
    ).rejects.toThrow("Admin access required");
  });
});
```

### Testing with Custom Configuration

```typescript
it("should handle unverified tenant", async () => {
  const customEnv = await createTestEnvironment(
    { emailVerified: false },
    { role: "owner" }
  );

  const caller = appRouter.createCaller(customEnv.mockContext);
  
  await expect(
    caller.feature.requiresVerification()
  ).rejects.toThrow("Email verification required");

  await cleanupTestTenant(customEnv.tenantId);
});
```

## Test Timeouts

Use the predefined timeout constants from `TEST_TIMEOUTS` to ensure consistent timeout behavior:

| Constant | Value | Use Case |
|----------|-------|----------|
| `TEST_TIMEOUTS.SHORT` | 5 seconds | Simple database queries |
| `TEST_TIMEOUTS.MEDIUM` | 10 seconds | Test setup with multiple inserts |
| `TEST_TIMEOUTS.LONG` | 30 seconds | Complex operations or external API calls |

**Example:**

```typescript
beforeAll(async () => {
  // Setup code
}, TEST_TIMEOUTS.MEDIUM);
```

## Common Pitfalls and Solutions

### Pitfall 1: Missing emailVerified Field

**Problem:** Tests fail because procedures expect verified tenants, but test setup doesn't set `emailVerified: true`.

**Solution:** Use `createTestEnvironment()` which sets `emailVerified: true` by default.

```typescript
// ❌ Bad: Manual setup might forget emailVerified
await db.insert(tenants).values({
  id: testTenantId,
  name: "Test Salon",
  subdomain: "test",
  // Missing emailVerified!
});

// ✅ Good: Helper sets emailVerified automatically
const { tenantId } = await createTestEnvironment();
```

### Pitfall 2: Inconsistent Context Structure

**Problem:** Tests create context objects with different field structures, leading to type errors or runtime failures.

**Solution:** Use the `mockContext` provided by `createTestEnvironment()`.

```typescript
// ❌ Bad: Manual context might have wrong structure
const caller = appRouter.createCaller({
  user: {
    id: userId,
    tenantId: tenantId,
    // Missing required fields!
  }
});

// ✅ Good: Helper provides complete context
const { mockContext } = await createTestEnvironment();
const caller = appRouter.createCaller(mockContext);
```

### Pitfall 3: Test Data Pollution

**Problem:** Tests leave data in the database, causing subsequent tests to fail or produce inconsistent results.

**Solution:** Always use `cleanupTestTenant()` in `afterAll` hooks.

```typescript
// ❌ Bad: No cleanup
describe("Feature", () => {
  let tenantId: string;
  
  beforeAll(async () => {
    const env = await createTestEnvironment();
    tenantId = env.tenantId;
  });
  
  // Tests run but leave data behind
});

// ✅ Good: Proper cleanup
describe("Feature", () => {
  let tenantId: string;
  
  beforeAll(async () => {
    const env = await createTestEnvironment();
    tenantId = env.tenantId;
  });
  
  afterAll(async () => {
    await cleanupTestTenant(tenantId);
  });
});
```

### Pitfall 4: Hardcoded Test Data

**Problem:** Tests use hardcoded IDs or values that conflict with other tests running in parallel.

**Solution:** Use the helper functions which generate unique values automatically.

```typescript
// ❌ Bad: Hardcoded values can conflict
const testTenantId = "test-tenant-123";
const testEmail = "test@example.com";

// ✅ Good: Helpers generate unique values
const { tenantId, tenant } = await createTestTenant();
// tenantId is a unique UUID
// tenant.email is unique with random suffix
```

## Migration Guide

### Converting Existing Tests

When converting existing tests to use the new helpers, follow these steps:

1. **Replace manual tenant creation:**

```typescript
// Before
const testTenantId = `test-tenant-${Date.now()}`;
await db.insert(tenants).values({
  id: testTenantId,
  name: "Test Salon",
  subdomain: `test-${Date.now()}`,
  status: "active",
  emailVerified: true,
  emailVerifiedAt: new Date(),
});

// After
const { tenantId } = await createTestEnvironment();
```

2. **Replace manual user creation:**

```typescript
// Before
const testUserId = Math.floor(Math.random() * 1000000);
await db.insert(users).values({
  id: testUserId,
  tenantId: testTenantId,
  openId: `test-${Date.now()}`,
  email: `test-${Date.now()}@example.com`,
  name: "Test User",
  role: "admin",
  isActive: true,
});

// After
const { userId, mockContext } = await createTestEnvironment();
```

3. **Replace manual context creation:**

```typescript
// Before
const caller = appRouter.createCaller({
  user: {
    id: testUserId,
    tenantId: testTenantId,
    role: "admin",
    openId: `test-${Date.now()}`,
    email: "test@example.com",
    name: "Test User",
  },
});

// After
const { mockContext } = await createTestEnvironment();
const caller = appRouter.createCaller(mockContext);
```

4. **Add cleanup:**

```typescript
// Add to the end of your test suite
afterAll(async () => {
  await cleanupTestTenant(tenantId);
});
```

## Best Practices

### 1. Use Descriptive Test Names

Test names should clearly describe what is being tested and the expected outcome.

```typescript
// ✅ Good
it("should reject non-admin users from updating branding", async () => {

// ❌ Bad
it("test branding update", async () => {
```

### 2. Test One Thing Per Test

Each test should verify a single behavior or requirement.

```typescript
// ✅ Good
it("should save branding settings", async () => {
  const result = await caller.salonSettings.updateBranding(newBranding);
  expect(result.success).toBe(true);
});

it("should retrieve saved branding settings", async () => {
  const branding = await caller.salonSettings.getBranding();
  expect(branding.logoUrl).toBe("https://example.com/logo.png");
});

// ❌ Bad
it("should save and retrieve branding settings", async () => {
  const result = await caller.salonSettings.updateBranding(newBranding);
  expect(result.success).toBe(true);
  
  const branding = await caller.salonSettings.getBranding();
  expect(branding.logoUrl).toBe("https://example.com/logo.png");
});
```

### 3. Use Appropriate Assertions

Choose assertion methods that clearly express the expected behavior.

```typescript
// ✅ Good: Specific assertion
expect(result.success).toBe(true);

// ✅ Good: Partial object matching
expect(result.branding).toMatchObject({
  logoUrl: "https://example.com/logo.png",
  primaryColor: "#ff0000"
});

// ❌ Bad: Too vague
expect(result).toBeTruthy();
```

### 4. Group Related Tests

Use nested `describe` blocks to organize related tests.

```typescript
describe("Branding Settings", () => {
  describe("Reading branding", () => {
    it("should return default branding when no settings exist", async () => {
      // Test code
    });

    it("should allow employees to read branding", async () => {
      // Test code
    });
  });

  describe("Updating branding", () => {
    it("should save branding settings", async () => {
      // Test code
    });

    it("should reject non-admin users from updating branding", async () => {
      // Test code
    });
  });

  describe("Validation", () => {
    it("should validate color format", async () => {
      // Test code
    });

    it("should validate title length", async () => {
      // Test code
    });
  });
});
```

### 5. Test Error Cases

Always test both success and failure scenarios.

```typescript
describe("Feature", () => {
  it("should succeed with valid input", async () => {
    const result = await caller.feature.method(validInput);
    expect(result.success).toBe(true);
  });

  it("should reject invalid input", async () => {
    await expect(
      caller.feature.method(invalidInput)
    ).rejects.toThrow("Validation error");
  });

  it("should enforce permission requirements", async () => {
    const employeeCaller = appRouter.createCaller(employeeContext);
    await expect(
      employeeCaller.feature.method(validInput)
    ).rejects.toThrow("Admin access required");
  });
});
```

## Continuous Improvement

This testing strategy is a living document that should evolve as the application grows. When you encounter patterns that could be standardized or helper functions that would benefit multiple tests, consider adding them to `server/test-helpers.ts` and updating this documentation.

### Contributing New Helpers

When adding new helper functions:

1. **Document the function:** Add JSDoc comments explaining purpose, parameters, and return values
2. **Export the function:** Make it available for import in test files
3. **Update this guide:** Add usage examples and best practices
4. **Write tests:** Create tests for the helper function itself in `server/__tests__/test-helpers.test.ts`

## Conclusion

By following this systematic testing strategy, we ensure that Stylora maintains high code quality, reliable test coverage, and a consistent development experience. The centralized test helpers eliminate common setup errors, reduce code duplication, and make it easier for developers to write comprehensive tests.

Remember: **Good tests are an investment in the long-term maintainability and reliability of the application.** Taking the time to write clear, well-structured tests pays dividends when debugging issues, refactoring code, or onboarding new team members.
