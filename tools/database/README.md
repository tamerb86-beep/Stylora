# Database Tools

This directory contains database utility scripts and manual migrations.

## Manual Migrations

The `manual-migrations/` folder contains SQL files for manual database schema updates. These are typically used for:

- Adding new tables or columns that are not yet in the Drizzle schema
- Fixing data inconsistencies
- Railway-specific database setups
- Emergency schema changes

### Available Migration Files

- `CREATE_PAYMENT_PROVIDERS_TABLE.sql` - Creates payment providers table
- `CREATE_PAYMENT_SETTINGS_TABLE.sql` - Creates payment settings table
- `add_unimicro_tables.sql` - Adds Unimicro accounting integration tables
- `create_salon_settings.sql` - Creates salon settings table
- `fix-payment-providers.sql` - Fixes payment providers data
- `railway-add-ks-frisor.sql` - Railway-specific setup for KS Frisor
- `railway-ks-frisor-FIXED.sql` - Fixed version of KS Frisor setup

## Utility Scripts

Database checking and maintenance scripts:

- `check_appointments.mjs` - Check appointments data
- `check_orders.mjs` - Check orders/sales data
- `check_readers.mjs` - Check payment reader configurations
- `migrate-fiken.mjs` - Migrate data to Fiken accounting system
- `seed-ks-frisor.mjs` - Seed demo data for KS Frisor salon
- `translate-walkin.py` - Translation utility for walk-in related content

## Usage

### Running a migration

```bash
# Connect to your MySQL database
mysql -u username -p database_name < tools/database/manual-migrations/migration_file.sql
```

### Running a utility script

```bash
# Make sure DATABASE_URL is set in your .env
node tools/database/check_appointments.mjs
```

## Important Notes

⚠️ **Always backup your database before running migrations!**

⚠️ **Test migrations in a development environment first**

⚠️ **Review SQL files before executing them**
