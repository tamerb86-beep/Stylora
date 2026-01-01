# Testing Tools

This directory contains utility scripts for testing API endpoints, UI components, and integration tests.

## Available Scripts

### API Testing

- `test-api.mjs` - General API endpoint testing
- `test-analytics.mjs` - Analytics API testing
- `test-appointments.mjs` - Appointments API testing
- `test-appointments-api.mjs` - Extended appointments API testing
- `test-order-creation.mjs` - Order creation flow testing
- `test-reader-links.mjs` - Payment reader links testing

### UI Testing

- `test-mobile-menu.html` - Mobile menu component testing
- `email-verification-preview.html` - Email verification template preview
- `test_buttons.py` - Button component testing

## Usage

### Running API Tests

```bash
# Set up environment variables in .env first
node tools/testing/test-api.mjs
```

### Viewing HTML Tests

```bash
# Open in browser
open tools/testing/test-mobile-menu.html
```

## Notes

- These are development testing utilities, not automated unit/integration tests
- Most scripts require a running server and valid authentication
- Check each script for specific requirements before running
- API tests may create test data in your database - use with caution

## Automated Tests

For automated unit and integration tests, see:
- `/server/*.test.ts` - Server-side tests
- Run with: `pnpm test`
