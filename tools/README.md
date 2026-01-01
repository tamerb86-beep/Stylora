# Tools Directory

This directory contains utility scripts and tools for development, testing, and maintenance.

## Structure

### `/database`
Database utility scripts for checking data, migrations, and seeding.

- **Manual migrations**: SQL files for manual database updates (`manual-migrations/`)
- **Data utilities**: Scripts to check and validate database records
- **Seeding**: Scripts to populate test data
- **Translation utilities**: Tools for managing multilingual database content

### `/testing`
Test utilities and API testing scripts.

- **API tests**: Scripts to test API endpoints
- **UI tests**: HTML test files for UI components
- **Integration tests**: End-to-end testing utilities

### `/performance`
Performance analysis and optimization tools.

- **Performance analysis**: Scripts to analyze app performance
- **Image optimization**: Tools to optimize images
- **Load time measurement**: Scripts to measure page load times

## Usage

Most scripts require environment variables to be set. Make sure you have a `.env` file configured before running any script.

### Example: Running a database check

```bash
node tools/database/check_appointments.mjs
```

### Example: Running performance analysis

```bash
node tools/performance/analyze_performance.mjs
```

## Note

These are development and maintenance tools. They should not be used in production environments without proper testing.
