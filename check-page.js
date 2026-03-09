// Simple check to see if we can fetch the page
const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 8123,
  path: '/mvp-box-demo.html',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`\nPage size: ${data.length} bytes`);
    console.log('\nPage structure:');
    console.log('- Has canvas:', data.includes('<canvas id="viewport">'));
    console.log('- Has Three.js import:', data.includes('import * as THREE'));
    console.log('- Has schema.js import:', data.includes('./js/core/schema.js'));
    console.log('- Has model-ops.js import:', data.includes('./js/core/model-ops.js'));
    console.log('- Has macro-models.js import:', data.includes('./js/core/macro-models.js'));
    console.log('- Has assembly-renderer.js import:', data.includes('./js/core/assembly-renderer.js'));
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
