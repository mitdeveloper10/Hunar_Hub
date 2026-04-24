require('dotenv').config();
const Brevo = require('sib-api-v3-sdk');
const nodemailer = require('nodemailer');

const defaultClient = Brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.SMTP_PASS;
const apiInstance = new Brevo.TransactionalEmailsApi();

console.log('--- HunarHub Email Diagnostic ---');
console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
console.log('SMTP_USER:', process.env.SMTP_USER);
console.log('API KEY PREVIEW:', process.env.SMTP_PASS ? process.env.SMTP_PASS.substring(0, 15) + '...' : 'MISSING');

async function runTest() {
    console.log('\n[1/2] Testing Brevo API SDK...');
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.subject = "HunarHub - Diagnostic Test";
    sendSmtpEmail.htmlContent = "<h3>Test Email</h3><p>If you see this, your Brevo API is working!</p>";
    sendSmtpEmail.sender = { name: "HunarHub Diagnostic", email: process.env.EMAIL_FROM };
    sendSmtpEmail.to = [{ email: process.env.EMAIL_FROM, name: "Admin" }]; // Sending to self

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('SUCCESS: API Request accepted. Message ID:', data.messageId);
    } catch (error) {
        console.error('FAILED: API Request rejected.');
        if (error.response && error.response.body) {
            console.error('Error Body:', JSON.stringify(error.response.body, null, 2));
            if (error.response.body.code === 'unauthorized') {
                console.error('TIP: Your API Key (SMTP_PASS) might be invalid.');
            }
            if (error.response.body.message.includes('sender')) {
                console.error('TIP: Ensure "' + process.env.EMAIL_FROM + '" is a VERIFIED SENDER in Brevo.');
            }
        } else {
            console.error('Error Message:', error.message);
        }
    }

    console.log('\n[2/2] Testing SMTP Relay Fallback...');
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    try {
        await transporter.verify();
        console.log('SUCCESS: SMTP connection established.');
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_FROM,
            subject: "HunarHub - SMTP Test",
            text: "SMTP is working!"
        });
        console.log('SUCCESS: SMTP email sent.');
    } catch (err) {
        console.error('FAILED: SMTP testing failed.');
        console.error('Reason:', err.message);
    }
}

runTest();
