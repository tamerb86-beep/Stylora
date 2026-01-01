import fetch from 'node-fetch';

const baseUrl = 'http://localhost:3000';

// Test the appointments.list endpoint
const startDate = new Date();
startDate.setDate(startDate.getDate() - 7);
const endDate = new Date();
endDate.setDate(endDate.getDate() + 60);

const input = {
  "0": {
    "json": {
      "startDate": startDate.toISOString(),
      "endDate": endDate.toISOString()
    },
    "meta": {
      "values": {
        "startDate": ["Date"],
        "endDate": ["Date"]
      }
    }
  }
};

const url = `${baseUrl}/api/trpc/appointments.list?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;

console.log('Testing URL:', url);
console.log('Date range:', {
  start: startDate.toISOString().split('T')[0],
  end: endDate.toISOString().split('T')[0]
});

try {
  const response = await fetch(url, {
    headers: {
      'Cookie': 'session=test' // This won't work without real session, but let's try
    }
  });
  
  const data = await response.json();
  console.log('\nResponse:', JSON.stringify(data, null, 2));
} catch (error) {
  console.error('Error:', error.message);
}
