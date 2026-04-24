const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'platform.sqlite');
console.log('Seed: Opening database at:', dbPath);
const db = new sqlite3(dbPath);

const name = 'Admin User';
const email = 'admin@hunarhub.com';
const password = 'adminpassword';
const role = 'admin';

const hash = bcrypt.hashSync(password, 10);

try {
    const stmt = db.prepare('INSERT INTO users (name, email, password_hash, role, is_verified) VALUES (?, ?, ?, ?, ?)');
    stmt.run(name, email, hash, role, 1);
    console.log(`\n###########################################`);
    console.log(`ADMIN ACCOUNT CREATED SUCCESSFULLY!`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`###########################################\n`);
} catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        console.log('Seed Check: Admin account already exists in database.');
    } else {
        console.error('Seed Error:', err.message);
    }
}
