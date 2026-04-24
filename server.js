require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const Brevo = require('sib-api-v3-sdk');

// Configure Brevo API
const defaultClient = Brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.SMTP_PASS;
const apiInstance = new Brevo.TransactionalEmailsApi();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
});

async function sendEmailOTP(toEmail, toName, otpCode) {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.subject = "HunarHub - Your Verification Code";
    sendSmtpEmail.htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3E362E;">
            <div style="text-align: center; padding: 20px 0; background-color: #fcfcfc;">
                <h2 style="color: #865D36;">HunarHub</h2>
            </div>
            <div style="padding: 30px; background-color: #ffffff; border: 1px solid #eeeeee; border-radius: 8px;">
                <h3>Hello ${toName},</h3>
                <p>Welcome to HunarHub! To activate your account, please enter the following 6-digit verification code below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #865D36; padding: 10px 20px; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #A69080;">${otpCode}</span>
                </div>
                <p style="color: #666; font-size: 14px;"><em>This code will expire in 5 minutes.</em></p>
                <hr style="border: none; border-top: 1px solid #eeeeee; margin: 20px 0;" />
                <p style="color: #999; font-size: 12px; margin: 0;">If you didn't request this, please ignore this email.</p>
            </div>
        </div>
    `;
    sendSmtpEmail.sender = { name: "HunarHub Welcome", email: process.env.EMAIL_FROM };
    sendSmtpEmail.to = [{ email: toEmail, name: toName }];

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`[Brevo API] OTP Email successfully sent to ${toEmail}. Message ID:`, data.messageId || 'N/A');
        return true;
    } catch (error) {
        const errorDetail = error.response ? JSON.stringify(error.response.body) : error.message;
        console.error('[Brevo API] Failed to send email:', errorDetail);
        
        // Fallback to SMTP if API fails
        try {
            console.log('[SMTP] Attempting fallback to SMTP relay...');
            await transporter.sendMail({
                from: `"HunarHub Welcome" <${process.env.EMAIL_FROM}>`,
                to: toEmail,
                subject: "HunarHub - Your Verification Code (Fallback)",
                html: sendSmtpEmail.htmlContent
            });
            console.log('[SMTP] Fallback email sent successfully.');
            return true;
        } catch (smtpError) {
            console.error('[SMTP Fallback] Final failure:', smtpError.message);
            return false;
        }
    }
}

async function sendPasswordResetOTP(toEmail, toName, otpCode) {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.subject = "HunarHub - Password Reset Code";
    sendSmtpEmail.htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3E362E;">
            <div style="text-align: center; padding: 20px 0; background-color: #fcfcfc;">
                <h2 style="color: #865D36;">HunarHub</h2>
            </div>
            <div style="padding: 30px; background-color: #ffffff; border: 1px solid #eeeeee; border-radius: 8px;">
                <h3>Hello ${toName},</h3>
                <p>We received a request to reset the password for your HunarHub account. Enter the following 6-digit code to securely reset your password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #865D36; padding: 10px 20px; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #A69080;">${otpCode}</span>
                </div>
                <p style="color: #666; font-size: 14px;"><em>This code will expire in 5 minutes.</em></p>
                <hr style="border: none; border-top: 1px solid #eeeeee; margin: 20px 0;" />
                <p style="color: #999; font-size: 12px; margin: 0;">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
            </div>
        </div>
    `;
    sendSmtpEmail.sender = { name: "HunarHub Security", email: process.env.EMAIL_FROM };
    sendSmtpEmail.to = [{ email: toEmail, name: toName }];

    try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`[Brevo API] Password Reset OTP Email successfully sent to ${toEmail}`);
        return true;
    } catch (error) {
        console.error('[Brevo API] Error sending password reset email:', error);
        return false;
    }
}

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
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const { name, password, role, business_name, bio, category, location } = req.body;

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
            INSERT INTO users (name, email, password_hash, role, is_verified) 
            VALUES (?, ?, ?, ?, ?)
        `);

        // Transaction for user creation
        const createUserTransaction = db.transaction(() => {
            const info = insertUser.run(name, email, hashedPassword, role, 0); // is_verified is 0
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

        // Generate OTP and send email
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 mins from now (Unix timestamp)

        db.prepare('DELETE FROM otps WHERE email = ?').run(email);
        db.prepare('INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)').run(email, otpCode, expiresAt);

        // Send actual email via Brevo – asynchronous to prevent UI hang
        sendEmailOTP(email, name, otpCode).catch(err => {
            console.error(`[Background Task] Failed to send OTP to ${email}:`, err.message);
        });

        res.status(201).json({ message: 'User created successfully. Please verify your email.', email: email });

    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Email already exists' });
        }
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Verify OTP
app.post('/api/register/verify', (req, res) => {
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const { otp_code } = req.body;
    if (!email || !otp_code) return res.status(400).json({ error: 'Email and OTP code are required' });

    try {
        const currentTime = Math.floor(Date.now() / 1000);
        const otpCheck = db.prepare('SELECT * FROM otps WHERE email = ? AND code = ? AND expires_at > ?').get(email, otp_code, currentTime);
        if (!otpCheck) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        db.prepare('UPDATE users SET is_verified = 1 WHERE email = ?').run(email);
        db.prepare('DELETE FROM otps WHERE email = ?').run(email);

        res.json({ message: 'Email verified successfully! You can now log in.' });
    } catch (err) {
        console.error('Verification error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const { password } = req.body;

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

        if (user.is_verified === 0) {
            return res.status(401).json({ error: 'Please verify your email address before logging in.', unverified: true });
        }

        req.session.user = { id: user.id, name: user.name, role: user.role };
        res.json({ message: 'Login successful', user: req.session.user });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Forgot Password - Send OTP
app.post('/api/password/forgot', async (req, res) => {
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    if (!email) return res.status(400).json({ error: 'Email address is required' });

    try {
        const user = db.prepare('SELECT name FROM users WHERE email = ?').get(email);
        if (!user) {
            // Standard practice: Don't leak whether an email exists, but for UX we can say it here.
            return res.status(404).json({ error: 'No account found with this email address' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 mins

        // Delete previous OTPs for this email
        db.prepare('DELETE FROM otps WHERE email = ?').run(email);

        // Store new OTP
        db.prepare('INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);

        // Send Email asynchronously via Nodemailer
        sendPasswordResetOTP(email, user.name, code);
        
        res.json({ message: 'Password recovery code sent to your email.' });
    } catch (err) {
        console.error('Forgot Password error:', err);
        res.status(500).json({ error: 'An error occurred processing your request' });
    }
});

// Reset Password - Verify OTP & Update DB
app.post('/api/password/reset', async (req, res) => {
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const { otp_code, new_password } = req.body;

    if (!email || !otp_code || !new_password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(new_password)) {
        return res.status(400).json({ error: 'Password does not meet complexity requirements' });
    }

    try {
        const currentTime = Math.floor(Date.now() / 1000);
        const otpCheck = db.prepare('SELECT * FROM otps WHERE email = ? AND code = ? AND expires_at > ?').get(email, otp_code, currentTime);
        if (!otpCheck) {
            return res.status(400).json({ error: 'Invalid or expired recovery code' });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        
        // Update password and clear OTP
        db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashedPassword, email);
        db.prepare('DELETE FROM otps WHERE email = ?').run(email);

        res.json({ message: 'Password successfully updated' });
    } catch (err) {
        console.error('Reset Password error:', err);
        res.status(500).json({ error: 'Failed to reset your password' });
    }
});

// ----------------------------------------------------------------------
// DYNAMIC QR PAYMENT ENDPOINT

app.post('/api/payment/generate-qr', async (req, res) => {
    const { amount, upiId } = req.body;
    
    if (!amount || !upiId) {
        return res.status(400).json({ error: 'Missing correct amount or tracking UPI ID' });
    }

    try {
        // Construct standard unified payment interface (UPI) linking string
        const upiString = `upi://pay?pa=hunarhub@axisbank&pn=HunarHub%20Secure%20Checkout&am=${amount}&cu=INR`;
        
        // Generate high-resolution base64 Image of the QR code using HunarHub primary color palette
        const qrBase64 = await QRCode.toDataURL(upiString, {
            color: {
                dark: '#3E362E',  // HunarHub Primary Dark Brown
                light: '#FFFFFF'
            },
            width: 300,
            margin: 2
        });
        
        // Give the code exactly 5 strict minutes to live
        const expiresAt = Date.now() + 5 * 60 * 1000;

        res.json({
            success: true,
            qrImage: qrBase64,
            expiresAt: expiresAt
        });

    } catch (err) {
        console.error('Error violently generating payment QR:', err);
        res.status(500).json({ error: 'Failed to generate your payment QR Code' });
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

// Get Recent Products (Public) with Search & Filtering
app.get('/api/products/recent', (req, res) => {
    const { q, category, sort } = req.query;
    try {
        let sql = `
            SELECT p.* 
            FROM products p
            JOIN entrepreneurs e ON p.entrepreneur_id = e.user_id
        `;
        let conditions = [];
        let params = [];

        if (q) {
            conditions.push("p.name LIKE ?");
            params.push(`%${q}%`);
        }

        if (category && category !== '') {
            conditions.push("e.category = ?");
            params.push(category);
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        if (sort === 'price-low') {
            sql += " ORDER BY p.price ASC";
        } else if (sort === 'price-high') {
            sql += " ORDER BY p.price DESC";
        } else {
            sql += " ORDER BY p.id DESC";
        }

        sql += " LIMIT 50";

        const stmt = db.prepare(sql);
        const products = stmt.all(...params);

        const imgStmt = db.prepare('SELECT image_url FROM product_images WHERE product_id = ?');

        for (const product of products) {
            const images = imgStmt.all(product.id).map(i => i.image_url);
            product.images = images.length > 0 ? images : (product.image_url ? [product.image_url] : []);
        }

        res.json(products);
    } catch (err) {
        console.error('Error fetching filtered products:', err);
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

// Place Order (Customer only) - Supports Bulk Actions (Cart)
app.post('/api/orders', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { items, payment_method, payment_status } = req.body;
    
    // Fallback for older singular checkout format (just in case)
    const orderItems = items || [];
    if (!items && req.body.product_id) {
        orderItems.push({ 
            entrepreneur_id: req.body.entrepreneur_id, 
            product_id: req.body.product_id 
        });
    }

    if (orderItems.length === 0 || !payment_method) {
        return res.status(400).json({ error: 'Cart is completely empty or missing payment method' });
    }

    try {
        const processOrderBatch = db.transaction((cart) => {
            const stmt = db.prepare(`
                INSERT INTO orders (customer_id, entrepreneur_id, product_id, payment_method, payment_status)
                VALUES (?, ?, ?, ?, ?)
            `);
            const insertedIds = [];
            for (const item of cart) {
                const info = stmt.run(req.session.user.id, item.entrepreneur_id, item.product_id, payment_method, payment_status || 'Pending');
                insertedIds.push(info.lastInsertRowid);
            }
            return insertedIds;
        });

        const successfulIds = processOrderBatch(orderItems);
        res.status(201).json({ message: 'Orders placed successfully!', orderIds: successfulIds });

    } catch (err) {
        console.error('Error placing order batch:', err);
        res.status(500).json({ error: 'Failed to complete checkout processing' });
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
                SELECT o.id, o.status, o.payment_method, o.payment_status, o.created_at, p.name as product_name, p.price, p.image_url, e.business_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN entrepreneurs e ON o.entrepreneur_id = e.user_id
                WHERE o.customer_id = ?
            `);
        } else {
            stmt = db.prepare(`
                SELECT o.id, o.status, o.payment_method, o.payment_status, o.created_at, p.name as product_name, p.price, p.image_url, u.name as customer_name
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

// Admin: List all users
app.get('/api/admin/users', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const users = db.prepare('SELECT id, name, email, role, created_at FROM users').all();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Admin: List all entrepreneurs
app.get('/api/admin/entrepreneurs-all', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const ents = db.prepare(`
            SELECT u.id, u.name, u.email, e.business_name, e.category, e.location, e.verified
            FROM users u
            JOIN entrepreneurs e ON u.id = e.user_id
        `).all();
        res.json(ents);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch entrepreneurs' });
    }
});

// Admin: List all orders
app.get('/api/admin/orders', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const orders = db.prepare(`
            SELECT o.id, o.status, o.payment_method, o.created_at, 
                   p.name as product_name, p.price,
                   u.name as customer_name,
                   e.business_name as entrepreneur_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            JOIN users u ON o.customer_id = u.id
            JOIN entrepreneurs e ON o.entrepreneur_id = e.user_id
        `).all();
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Admin: List all service requests
app.get('/api/admin/requests', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const requests = db.prepare(`
            SELECT sr.*, s.name as service_name, 
                   u.name as customer_name,
                   e.business_name as entrepreneur_name
            FROM service_requests sr
            JOIN services s ON sr.service_id = s.id
            JOIN users u ON sr.customer_id = u.id
            JOIN entrepreneurs e ON sr.entrepreneur_id = e.user_id
        `).all();
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Admin: List all reviews (Feedback)
app.get('/api/admin/reviews', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const reviews = db.prepare(`
            SELECT r.*, u.name as customer_name, e.business_name 
            FROM reviews r
            JOIN users u ON r.customer_id = u.id
            JOIN entrepreneurs e ON r.entrepreneur_id = e.user_id
        `).all();
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// --- Stats Overview (for Landing Page) ---
app.get('/api/stats-overview', (req, res) => {
    try {
        const artisanCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('entrepreneur').count;
        const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
        const categoryCount = db.prepare('SELECT COUNT(DISTINCT category) as count FROM entrepreneurs').get().count;
        const avgRatingRow = db.prepare('SELECT AVG(rating) as avg FROM reviews').get();
        const averageRating = avgRatingRow.avg ? parseFloat(avgRatingRow.avg).toFixed(1) : "4.9"; // Fallback to 4.9 if no reviews

        res.json({
            artisanCount,
            productCount,
            categoryCount: categoryCount || 10, // Fallback if 0
            averageRating
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error fetching stats' });
    }
});

// OTP Resend Implementation
app.post('/api/otp/resend', async (req, res) => {
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    if (!email) return res.status(400).json({ error: 'Email required' });

    try {
        const user = db.prepare('SELECT name FROM users WHERE email = ?').get(email);
        if (!user) return res.status(404).json({ error: 'Account not found. Please register.' });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 mins

        // Delete previous OTPs for this email
        db.prepare('DELETE FROM otps WHERE email = ?').run(email);

        // Store new OTP
        db.prepare('INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);

        // Send via Brevo asynchronously
        sendEmailOTP(email, user.name, code);
        
        res.json({ message: 'New verification code sent successfully to your email' });
    } catch (err) {
        console.error('OTP Resend Error:', err);
        res.status(500).json({ error: 'Failed to request new code' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
