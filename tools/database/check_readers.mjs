import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== Checking Payment Providers ===\n');

const [providers] = await connection.execute(
  'SELECT id, tenantId, provider, providerAccountId, config, createdAt FROM payment_providers ORDER BY createdAt DESC'
);

if (providers.length === 0) {
  console.log('No payment providers found.');
} else {
  providers.forEach(p => {
    console.log(`Provider ID: ${p.id}`);
    console.log(`Tenant ID: ${p.tenantId}`);
    console.log(`Provider: ${p.provider}`);
    console.log(`Account ID: ${p.providerAccountId || 'N/A'}`);
    console.log(`Created: ${p.createdAt}`);
    
    if (p.config) {
      try {
        const config = JSON.parse(p.config);
        console.log(`Config:`, JSON.stringify(config, null, 2));
        
        if (config.readerLinks && config.readerLinks.length > 0) {
          console.log(`\n📱 Reader Links Found: ${config.readerLinks.length}`);
          config.readerLinks.forEach((link, idx) => {
            console.log(`  ${idx + 1}. Link ID: ${link.linkId}`);
            console.log(`     Name: ${link.linkName}`);
            console.log(`     Created: ${link.createdAt}`);
          });
        }
      } catch (e) {
        console.log(`Config (raw): ${p.config}`);
      }
    }
    console.log('---\n');
  });
}

await connection.end();
