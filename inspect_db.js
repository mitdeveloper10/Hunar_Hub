const db = require('./database');

// Helper to print table content
function printTable(tableName) {
    try {
        const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
        console.log(`\n=== ${tableName.toUpperCase()} (${rows.length} rows) ===`);
        if (rows.length > 0) {
            console.table(rows);
        } else {
            console.log('No data found.');
        }
    } catch (err) {
        console.error(`Error reading ${tableName}:`, err.message);
    }
}

console.log('Inspecting Database: platform.sqlite');
printTable('users');
printTable('entrepreneurs');
printTable('products');
printTable('orders');
