const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testAdmin() {
    // We can't easily test session-based APIs without a cookie
    // But we can check if the server is running and the endpoints exist
    try {
        const res = await fetch('http://localhost:3001/api/admin/stats');
        console.log('Status:', res.status);
        const data = await res.json();
        console.log('Data:', data);
    } catch (err) {
        console.error('Error:', err.message);
    }
}

testAdmin();
