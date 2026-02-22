const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new sqlite3('platform.sqlite');

const name = 'Admin User';
const email = 'admin@hunarhub.com';
const password = 'adminpassword';
const role = 'admin';

const hash = bcrypt.hashSync(password, 10);

try {
    const stmt = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
    stmt.run(name, email, hash, role);
    console.log(`Admin created: ${email} / ${password}`);
} catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        console.log('Admin already exists.');
    } else {
        console.error('Error creating admin:', err);
    }
}
