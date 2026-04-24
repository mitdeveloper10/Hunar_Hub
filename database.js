const sqlite3 = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'platform.sqlite');
console.log('Opening database at:', dbPath);
const db = new sqlite3(dbPath, { verbose: console.log });

// Enable foreign key constraints in SQLite (required for ON DELETE CASCADE)
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('customer', 'entrepreneur', 'admin')) NOT NULL,
    is_verified INTEGER DEFAULT 0,
    profile_image TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS entrepreneurs (
    user_id INTEGER PRIMARY KEY,
    business_name TEXT NOT NULL,
    bio TEXT,
    category TEXT,
    location TEXT,
    verified INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entrepreneur_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    FOREIGN KEY(entrepreneur_id) REFERENCES users(id) ON DELETE CASCADE
  );
  
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    entrepreneur_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(entrepreneur_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entrepreneur_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_range TEXT,
    FOREIGN KEY(entrepreneur_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    entrepreneur_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', 
    request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT,
    FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(entrepreneur_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    entrepreneur_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(entrepreneur_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`;

db.exec(schema);

// Migrations
try {
  // Migration for users table
  const userColumns = db.pragma('table_info(users)');
  if (!userColumns.some(c => c.name === 'phone')) {
    db.prepare('ALTER TABLE users ADD COLUMN phone TEXT').run();
    console.log('Added phone column to users table');
  }
  if (!userColumns.some(c => c.name === 'is_verified')) {
    db.prepare('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1').run();
    console.log('Added is_verified column to users table, defaulted to 1 for existing users');
  }
  if (!userColumns.some(c => c.name === 'profile_image')) {
    db.prepare('ALTER TABLE users ADD COLUMN profile_image TEXT DEFAULT NULL').run();
    console.log('Added profile_image column to users table');
  }

  // Migration for orders table
  const orderColumns = db.pragma('table_info(orders)');
  if (!orderColumns.some(c => c.name === 'payment_method')) {
    db.prepare('ALTER TABLE orders ADD COLUMN payment_method TEXT').run();
    console.log('Added payment_method column to orders table');
  }
  if (!orderColumns.some(c => c.name === 'payment_status')) {
    db.prepare("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'Pending'").run();
    console.log('Added payment_status column to orders table');
  }
} catch (err) {
  console.error('Database migration error:', err);
}

// Automatic Admin Seeding
const seedAdmin = () => {
  try {
    const adminEmail = 'admin@hunarhub.com';
    const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

    if (!adminExists) {
      console.log('Seeding: No admin found, creating default admin account...');
      const hashedPassword = bcrypt.hashSync('adminpassword', 10);
      db.prepare('INSERT INTO users (name, email, password_hash, role, is_verified) VALUES (?, ?, ?, ?, ?)').run(
        'Admin User',
        adminEmail,
        hashedPassword,
        'admin',
        1
      );
      console.log('Seeding: Admin account created (admin@hunarhub.com / adminpassword)');
    } else {
      console.log('Seeding Check: Admin account already exists.');
    }
  } catch (err) {
    console.error('Seeding Error:', err.message);
  }
};

seedAdmin();

module.exports = db;
