# Development Guide

This guide provides information for developers working on the Stylora/BarberTime project.

## Repository Structure

The project follows a clean, organized structure:

### Core Directories

- **`/client`** - React frontend application
  - `/src/pages` - Page components
  - `/src/components` - Reusable UI components
  - `/src/hooks` - Custom React hooks
  - `/src/lib` - Utility libraries
  - `/src/contexts` - React contexts
  
- **`/server`** - Express backend application
  - `/_core` - Core server initialization and middleware
  - `/routers` - tRPC API routers
  - `/services` - Business logic services
  - `/*.test.ts` - Unit and integration tests
  
- **`/shared`** - Shared code between client and server
  - `types.ts` - TypeScript type definitions
  - `const.ts` - Shared constants
  
- **`/drizzle`** - Database schema and migrations
  - `schema.ts` - Database schema definitions
  - `*.sql` - Auto-generated migration files

### Support Directories

- **`/tools`** - Development and maintenance utilities
  - `/database` - Database utilities and manual migrations
  - `/testing` - API and integration testing scripts
  - `/performance` - Performance analysis and optimization tools
  
- **`/scripts`** - Build and deployment scripts
  
- **`/docs`** - Project documentation
  - `/api` - API documentation
  - `/guides` - Setup and configuration guides
  - `/deployment` - Deployment guides

## Development Workflow

### 1. Initial Setup

```bash
# Clone the repository
git clone https://github.com/tamerb86-beep/Stylora.git
cd Stylora

# Install dependencies
pnpm install

# Copy environment variables
cp env.example.txt .env
# Edit .env with your configuration

# Set up database
pnpm db:push

# Start development server
pnpm dev
```

### 2. Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `pnpm test`
4. Run type checking: `pnpm check`
5. Format code: `pnpm format`
6. Commit your changes
7. Push and create a pull request

### 3. Database Changes

For schema changes:
1. Edit `/drizzle/schema.ts`
2. Run `pnpm db:push` to generate and apply migrations

For manual migrations:
- Add SQL files to `/tools/database/manual-migrations/`
- Document the migration purpose in the file header
- Apply manually when needed

### 4. Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test server/analytics.test.ts

# Run tests in watch mode
pnpm test --watch
```

### 5. Using Development Tools

#### Database Tools

```bash
# Check appointments data
node tools/database/check_appointments.mjs

# Check orders
node tools/database/check_orders.mjs

# Seed demo data
node tools/database/seed-ks-frisor.mjs
```

#### Testing Tools

```bash
# Test API endpoints
node tools/testing/test-api.mjs

# Test analytics
node tools/testing/test-analytics.mjs
```

#### Performance Tools

```bash
# Analyze performance
node tools/performance/analyze_performance.mjs

# Optimize images
node tools/performance/optimize-images.mjs
```

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Define types explicitly for public APIs
- Use interfaces for object shapes

### React

- Use functional components with hooks
- Use TypeScript for component props
- Keep components focused and single-purpose
- Extract reusable logic into custom hooks

### Naming Conventions

- **Files**: kebab-case for file names (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_LOGIN_ATTEMPTS`)
- **Types/Interfaces**: PascalCase (`UserProfile`)

### File Organization

- Group related files together
- Keep test files next to source files (`*.test.ts`)
- Use barrel exports (`index.ts`) for directories
- Avoid deeply nested directories

## Common Tasks

### Adding a New API Endpoint

1. Define the route in `/server/routers/`
2. Implement the handler function
3. Add input validation with Zod
4. Add tests in corresponding `.test.ts` file
5. Document in `/docs/api/` if public-facing

### Adding a New Page

1. Create component in `/client/src/pages/`
2. Add route in routing configuration
3. Add navigation links if needed
4. Update tests

### Adding a New Database Table

1. Add table definition to `/drizzle/schema.ts`
2. Add relations if needed
3. Run `pnpm db:push`
4. Update TypeScript types
5. Create seed data if needed

## Troubleshooting

### Build Issues

```bash
# Clear cache and rebuild
rm -rf dist/
rm -rf node_modules/.vite/
pnpm build
```

### Database Issues

```bash
# Reset database (caution: deletes all data!)
# Drop and recreate database, then:
pnpm db:push
```

### Type Errors

```bash
# Run type checking
pnpm check

# Fix automatically where possible
pnpm format
```

## Resources

- [Main README](../README.md) - Project overview
- [API Documentation](api/) - API reference
- [Deployment Guides](deployment/) - Deployment instructions
- [Setup Guides](guides/) - Feature setup instructions

## Getting Help

- Check existing documentation in `/docs`
- Review test files for usage examples
- Check GitHub issues for known problems
- Create a new issue if you find a bug

## Contributing

1. Follow the code style guidelines
2. Write tests for new features
3. Update documentation
4. Keep commits focused and well-described
5. Request code review before merging
