import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:JGQvGPHQXfMjjxBXmVQqrUfQZbwTxhvf@autorack.proxy.rlwy.net:55082/railway';

async function testReaderLinks() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  try {
    console.log('🔍 Fetching iZettle provider for platform-admin-tenant...');
    
    const [providers] = await connection.execute(
      `SELECT id, providerType, accessToken, refreshToken, config 
       FROM payment_providers 
       WHERE tenantId = ? AND providerType = ?`,
      ['platform-admin-tenant', 'izettle']
    );
    
    if (providers.length === 0) {
      console.log('❌ No iZettle provider found');
      return;
    }
    
    console.log('✅ Provider found:', {
      id: providers[0].id,
      hasAccessToken: !!providers[0].accessToken,
      hasRefreshToken: !!providers[0].refreshToken,
      config: providers[0].config
    });
    
    // Decrypt access token
    const crypto = await import('crypto');
    const ENCRYPTION_KEY = process.env.JWT_SECRET || 'default-encryption-key-change-me';
    
    function decryptToken(encryptedToken) {
      const parts = encryptedToken.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = Buffer.from(parts[1], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY).slice(0, 32), iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString();
    }
    
    const accessToken = decryptToken(providers[0].accessToken);
    console.log('🔑 Access token decrypted (length:', accessToken.length, ')');
    
    // Fetch Reader Links from iZettle API
    console.log('\n📡 Fetching Reader Links from iZettle API...');
    const response = await fetch('https://reader-connect.zettle.com/v1/integrator/links', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      console.log('❌ API Error:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return;
    }
    
    const links = await response.json();
    console.log('\n✅ Reader Links found:', links.length);
    console.log(JSON.stringify(links, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await connection.end();
  }
}

testReaderLinks();
