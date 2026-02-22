const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secret-key-replace-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    const { name, email, password, role, business_name, bio, category, location } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Password too weak (8+ chars, 1 upper, 1 num, 1 special)' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const insertUser = db.prepare(`
            INSERT INTO users (name, email, password_hash, role) 
            VALUES (?, ?, ?, ?)
        `);

        // Transaction for entrepreneur creation
        const createUserTransaction = db.transaction(() => {
            const info = insertUser.run(name, email, hashedPassword, role);
            const userId = info.lastInsertRowid;

            if (role === 'entrepreneur') {
                if (!business_name) throw new Error('Business name required for entrepreneurs');
                const insertEntrepreneur = db.prepare(`
                    INSERT INTO entrepreneurs (user_id, business_name, bio, category, location)
                    VALUES (?, ?, ?, ?, ?)
                `);
                insertEntrepreneur.run(userId, business_name, bio || null, category || null, location || null);
            }
            return userId;
        });

        const newUserId = createUserTransaction();
        res.status(201).json({ message: 'User created successfully', userId: newUserId });

    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Email already exists' });
        }
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = stmt.get(email);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.user = { id: user.id, name: user.name, role: user.role };
        res.json({ message: 'Login successful', user: req.session.user });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Entrepreneurs List
app.get('/api/entrepreneurs', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT u.id, u.name, e.business_name, e.bio, e.category, e.location 
            FROM users u
            JOIN entrepreneurs e ON u.id = e.user_id
            WHERE u.role = 'entrepreneur'
        `);
        const entrepreneurs = stmt.all();
        res.json(entrepreneurs);
    } catch (err) {
        console.error('Error fetching entrepreneurs:', err);
        res.status(500).json({ error: 'Failed to fetch entrepreneurs' });
    }
});

// Get Recent Products (Public)
app.get('/api/products/recent', (req, res) => {
    try {
        console.log('Fetching recent products...');
        const stmt = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 50');
        const products = stmt.all();

        const imgStmt = db.prepare('SELECT image_url FROM product_images WHERE product_id = ?');

        for (const product of products) {
            const images = imgStmt.all(product.id).map(i => i.image_url);
            product.images = images.length > 0 ? images : (product.image_url ? [product.image_url] : []);
        }

        console.log(`Found ${products.length} recent products.`);
        res.json(products);
    } catch (err) {
        console.error('Error fetching recent products:', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Get Products for an Entrepreneur (Summary)
app.get('/api/products/:entrepreneurId', (req, res) => {
    const { entrepreneurId } = req.params;
    try {
        const stmt = db.prepare('SELECT * FROM products WHERE entrepreneur_id = ?');
        const products = stmt.all(entrepreneurId);

        const imgStmt = db.prepare('SELECT image_url FROM product_images WHERE product_id = ?');

        for (const product of products) {
            const images = imgStmt.all(product.id).map(i => i.image_url);
            // Fallback to legacy image_url if no new images found, or mix them? 
            // Better to prefer product_images, but if empty use legacy.
            product.images = images.length > 0 ? images : (product.image_url ? [product.image_url] : []);
        }

        res.json(products);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Get Single Product with Images
app.get('/api/product/:id', (req, res) => {
    const { id } = req.params;
    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const images = db.prepare('SELECT image_url FROM product_images WHERE product_id = ?').all(id);
        product.images = images.map(img => img.image_url);

        // If no images in product_images table, fall back to the main image_url (backward compatibility)
        if (product.images.length === 0 && product.image_url) {
            product.images = [product.image_url];
        }

        res.json(product);
    } catch (err) {
        console.error('Error fetching product details:', err);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

const multer = require('multer');

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Add Product (Entrepreneur only) - Supports Multiple Images
app.post('/api/products', upload.array('images', 5), (req, res) => {
    if (!req.session.user || req.session.user.role !== 'entrepreneur') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { name, description, price } = req.body;
    const files = req.files; // Array of files

    if (!name || !price) {
        return res.status(400).json({ error: 'Name and price are required' });
    }

    try {
        // use transaction
        const createProductTransaction = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO products (entrepreneur_id, name, description, price, image_url)
                VALUES (?, ?, ?, ?, ?)
            `);
            // Use the first image as the main thumbnail for backward compatibility
            const mainImage = files && files.length > 0 ? `/uploads/${files[0].filename}` : null;
            const info = stmt.run(req.session.user.id, name, description, price, mainImage);
            const productId = info.lastInsertRowid;

            if (files && files.length > 0) {
                const imgStmt = db.prepare('INSERT INTO product_images (product_id, image_url) VALUES (?, ?)');
                for (const file of files) {
                    imgStmt.run(productId, `/uploads/${file.filename}`);
                }
            }
            return productId;
        });

        const newProductId = createProductTransaction();
        res.status(201).json({ message: 'Product added', productId: newProductId });
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

// Place Order (Customer only)
app.post('/api/orders', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { entrepreneur_id, product_id, payment_method } = req.body;
    if (!entrepreneur_id || !product_id || !payment_method) {
        return res.status(400).json({ error: 'Missing order details or payment method' });
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO orders (customer_id, entrepreneur_id, product_id, payment_method)
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(req.session.user.id, entrepreneur_id, product_id, payment_method);
        res.status(201).json({ message: 'Order placed', orderId: info.lastInsertRowid });
    } catch (err) {
        console.error('Error placing order:', err);
        res.status(500).json({ error: 'Failed to place order' });
    }
});

// Update Order Status (Entrepreneur only)
app.post('/api/orders/:id/status', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'entrepreneur') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { status } = req.body;
    const { id } = req.params;

    try {
        const stmt = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND entrepreneur_id = ?');
        const info = stmt.run(status, id, req.session.user.id);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Order not found or unauthorized' });
        }
        res.json({ message: `Order ${status}` });
    } catch (err) {
        console.error('Error updating order:', err);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// Get My Orders
app.get('/api/my-orders', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        let stmt;
        if (req.session.user.role === 'customer') {
            stmt = db.prepare(`
                SELECT o.id, o.status, o.payment_method, o.created_at, p.name as product_name, p.price, p.image_url, e.business_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN entrepreneurs e ON o.entrepreneur_id = e.user_id
                WHERE o.customer_id = ?
            `);
        } else {
            stmt = db.prepare(`
                SELECT o.id, o.status, o.payment_method, o.created_at, p.name as product_name, p.price, p.image_url, u.name as customer_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users u ON o.customer_id = u.id
                WHERE o.entrepreneur_id = ?
            `);
        }
        const orders = stmt.all(req.session.user.id);
        res.json(orders);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.json({ message: 'Logged out successfully' });
    });
});

// --- NEW APIs (HunarHub) ---

// 1. Manage Services (Entrepreneur)
app.post('/api/services', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'entrepreneur') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { name, description, price_range } = req.body;
    if (!name) return res.status(400).json({ error: 'Service name is required' });

    try {
        const stmt = db.prepare('INSERT INTO services (entrepreneur_id, name, description, price_range) VALUES (?, ?, ?, ?)');
        const info = stmt.run(req.session.user.id, name, description, price_range);
        res.status(201).json({ message: 'Service added', serviceId: info.lastInsertRowid });
    } catch (err) {
        console.error('Error adding service:', err);
        res.status(500).json({ error: 'Failed to add service' });
    }
});

app.get('/api/services/:entrepreneurId', (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM services WHERE entrepreneur_id = ?');
        const services = stmt.all(req.params.entrepreneurId);
        res.json(services);
    } catch (err) {
        console.error('Error fetching services:', err);
        res.status(500).json({ error: 'Failed to fetch services' });
    }
});

// 2. Service Requests
app.post('/api/service-requests', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { entrepreneur_id, service_id, details } = req.body;

    try {
        const stmt = db.prepare('INSERT INTO service_requests (customer_id, entrepreneur_id, service_id, details) VALUES (?, ?, ?, ?)');
        const info = stmt.run(req.session.user.id, entrepreneur_id, service_id, details);
        res.status(201).json({ message: 'Service requested', requestId: info.lastInsertRowid });
    } catch (err) {
        console.error('Error requesting service:', err);
        res.status(500).json({ error: 'Failed to request service' });
    }
});

app.get('/api/service-requests', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        let stmt;
        if (req.session.user.role === 'customer') {
            stmt = db.prepare(`
                SELECT sr.*, s.name as service_name, e.business_name 
                FROM service_requests sr
                JOIN services s ON sr.service_id = s.id
                JOIN entrepreneurs e ON sr.entrepreneur_id = e.user_id
                WHERE sr.customer_id = ?
            `);
        } else {
            stmt = db.prepare(`
                SELECT sr.*, s.name as service_name, u.name as customer_name
                FROM service_requests sr
                JOIN services s ON sr.service_id = s.id
                JOIN users u ON sr.customer_id = u.id
                WHERE sr.entrepreneur_id = ?
            `);
        }
        const requests = stmt.all(req.session.user.id);
        res.json(requests);
    } catch (err) {
        console.error('Error fetching requests:', err);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

app.post('/api/service-requests/:id/status', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'entrepreneur') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { status } = req.body;
    try {
        const stmt = db.prepare('UPDATE service_requests SET status = ? WHERE id = ? AND entrepreneur_id = ?');
        const info = stmt.run(status, req.params.id, req.session.user.id);

        if (info.changes === 0) return res.status(404).json({ error: 'Request not found' });
        res.json({ message: `Request ${status}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update request' });
    }
});

// 3. Reviews
app.post('/api/reviews', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { entrepreneur_id, rating, comment } = req.body;

    try {
        const stmt = db.prepare('INSERT INTO reviews (customer_id, entrepreneur_id, rating, comment) VALUES (?, ?, ?, ?)');
        stmt.run(req.session.user.id, entrepreneur_id, rating, comment);
        res.status(201).json({ message: 'Review added' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add review' });
    }
});

app.get('/api/reviews/:entrepreneurId', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT r.*, u.name as customer_name 
            FROM reviews r
            JOIN users u ON r.customer_id = u.id
            WHERE r.entrepreneur_id = ?
        `);
        const reviews = stmt.all(req.params.entrepreneurId);
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// 4. Admin
app.get('/api/admin/stats', (req, res) => {
    // Basic auth check for admin (in production use proper middleware)
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        const entrepreneurCount = db.prepare('SELECT COUNT(*) as count FROM entrepreneurs').get();
        const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get();
        const requestCount = db.prepare('SELECT COUNT(*) as count FROM service_requests').get();

        const pendingVerifications = db.prepare('SELECT COUNT(*) as count FROM entrepreneurs WHERE verified = 0').get();

        res.json({
            users: userCount.count,
            entrepreneurs: entrepreneurCount.count,
            orders: orderCount.count,
            requests: requestCount.count,
            pending_verifications: pendingVerifications.count
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.post('/api/admin/verify/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const stmt = db.prepare('UPDATE entrepreneurs SET verified = 1 WHERE user_id = ?');
        stmt.run(req.params.id);
        res.json({ message: 'Entrepreneur verified' });
    } catch (err) {
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.get('/api/admin/pending-entrepreneurs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const stmt = db.prepare(`
            SELECT u.id, u.name, u.email, e.business_name, e.category, e.verified
            FROM users u
            JOIN entrepreneurs e ON u.id = e.user_id
            WHERE e.verified = 0
        `);
        const pending = stmt.all();
        res.json(pending);
    } catch (err) {
        console.error('Error fetching pending entrepreneurs:', err);
        res.status(500).json({ error: 'Failed to fetch pending entrepreneurs' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
