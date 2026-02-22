const http = require('http');

console.log('Testing /api/products/recent on PORT 3001...');

http.get('http://localhost:3001/api/products/recent', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        try {
            const products = JSON.parse(data);
            console.log('Number of products returned:', products.length);
            console.log('Product Data:', JSON.stringify(products, null, 2));
        } catch (e) {
            console.log('Response is not JSON:', data.substring(0, 100));
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
