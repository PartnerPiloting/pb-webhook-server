/**
 * Invoice PDF Generation Service
 * 
 * Generates ATO-compliant tax invoices as PDFs using PDFKit.
 * 
 * ATO Requirements for Tax Invoices:
 * - Business name and ABN
 * - Date of invoice
 * - Description of goods/services
 * - GST amount (if registered)
 * - Total amount
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../utils/contextLogger');

// Logo path - check for various possible filenames
const LOGO_PATHS = [
    path.join(__dirname, '..', 'assets', 'ash-logo.png'),
    path.join(__dirname, '..', 'assets', 'ASH-HighRes-white-bg.jpg'),
    path.join(__dirname, '..', 'assets', 'logo.png'),
    path.join(__dirname, '..', 'assets', 'logo.jpg')
];

function getLogoPath() {
    for (const logoPath of LOGO_PATHS) {
        if (fs.existsSync(logoPath)) {
            return logoPath;
        }
    }
    return null;
}

// Business details - configured via environment or hardcoded
const BUSINESS_CONFIG = {
    name: process.env.INVOICE_BUSINESS_NAME || 'Australian Side Hustles',
    tagline: process.env.INVOICE_BUSINESS_TAGLINE || 'CREATE YOUR FREEDOM',
    abn: process.env.INVOICE_ABN || '59 106 303 593',
    address: process.env.INVOICE_ADDRESS || '', // Optional
    email: process.env.INVOICE_EMAIL || 'support@australiansidehustles.com.au',
    gstRegistered: process.env.INVOICE_GST_REGISTERED !== 'false', // Default true
    logoPath: getLogoPath()
};

/**
 * Generate an ATO-compliant invoice PDF
 * 
 * @param {object} invoiceData - Invoice data from Stripe
 * @param {string} invoiceData.id - Stripe invoice ID
 * @param {string} invoiceData.number - Invoice number
 * @param {number} invoiceData.created - Unix timestamp
 * @param {number} invoiceData.amount_paid - Amount in cents
 * @param {string} invoiceData.status - Payment status
 * @param {string} invoiceData.customer_name - Customer name
 * @param {string} invoiceData.customer_email - Customer email
 * @param {object} invoiceData.lines - Line items
 * @returns {Promise<Buffer>} PDF as a buffer
 */
async function generateInvoicePdf(invoiceData) {
    const logger = createLogger({ 
        runId: 'PDF', 
        clientId: 'BILLING', 
        operation: 'generate_invoice_pdf' 
    });

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4'
            });
            
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Calculate amounts
            const totalCents = invoiceData.amount_paid || 0;
            const totalDollars = totalCents / 100;
            const gstAmount = BUSINESS_CONFIG.gstRegistered ? totalDollars / 11 : 0; // GST is 1/11 of total
            const subtotal = totalDollars - gstAmount;

            // Format date
            const invoiceDate = new Date(invoiceData.created * 1000);
            const formattedDate = invoiceDate.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            // Get invoice number (use Stripe's or generate one)
            const invoiceNumber = invoiceData.number || `ASH-${invoiceDate.getFullYear()}-${invoiceData.id.slice(-6).toUpperCase()}`;

            // === HEADER WITH LOGO ===
            let headerBottomY = 95;
            
            if (BUSINESS_CONFIG.logoPath && fs.existsSync(BUSINESS_CONFIG.logoPath)) {
                // Add logo on the left (scaled to reasonable size)
                doc.image(BUSINESS_CONFIG.logoPath, 50, 40, { width: 180 });
                headerBottomY = 110; // Adjust for logo height
            } else {
                // Fallback to text header if no logo
                doc.fontSize(24)
                   .font('Helvetica-Bold')
                   .fillColor('#1a365d')
                   .text(BUSINESS_CONFIG.name, 50, 50);
                
                if (BUSINESS_CONFIG.tagline) {
                    doc.fontSize(10)
                       .font('Helvetica')
                       .fillColor('#718096')
                       .text(BUSINESS_CONFIG.tagline, 50, 78);
                }
            }

            // ABN on right
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#4a5568')
               .text(`ABN: ${BUSINESS_CONFIG.abn}`, 400, 50, { align: 'right' });
            
            if (BUSINESS_CONFIG.address) {
                doc.text(BUSINESS_CONFIG.address, 400, 65, { align: 'right' });
            }

            // === TAX INVOICE TITLE ===
            doc.moveDown(2);
            doc.fontSize(28)
               .font('Helvetica-Bold')
               .fillColor('#2d3748')
               .text('TAX INVOICE', 50, 130, { align: 'center' });

            // Horizontal line
            doc.moveTo(50, 170)
               .lineTo(545, 170)
               .strokeColor('#e2e8f0')
               .lineWidth(2)
               .stroke();

            // === INVOICE DETAILS ===
            const detailsY = 190;
            
            // Left column - Invoice info
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .fillColor('#4a5568')
               .text('Invoice Number:', 50, detailsY);
            doc.font('Helvetica')
               .text(invoiceNumber, 150, detailsY);

            doc.font('Helvetica-Bold')
               .text('Date:', 50, detailsY + 18);
            doc.font('Helvetica')
               .text(formattedDate, 150, detailsY + 18);

            doc.font('Helvetica-Bold')
               .text('Status:', 50, detailsY + 36);
            
            // Status badge
            const statusColor = invoiceData.status === 'paid' ? '#48bb78' : '#f56565';
            const statusText = invoiceData.status === 'paid' ? 'PAID' : invoiceData.status.toUpperCase();
            doc.font('Helvetica-Bold')
               .fillColor(statusColor)
               .text(statusText, 150, detailsY + 36);

            // Right column - Customer info
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .fillColor('#4a5568')
               .text('Bill To:', 350, detailsY);
            
            doc.font('Helvetica')
               .fillColor('#2d3748')
               .text(invoiceData.customer_name || 'Customer', 350, detailsY + 18);
            doc.fillColor('#718096')
               .text(invoiceData.customer_email || '', 350, detailsY + 36);

            // === LINE ITEMS TABLE ===
            const tableTop = 290;
            
            // Table header
            doc.rect(50, tableTop, 495, 25)
               .fill('#f7fafc');
            
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .fillColor('#4a5568')
               .text('Description', 60, tableTop + 8)
               .text('Amount', 450, tableTop + 8, { align: 'right', width: 85 });

            // Table rows
            let rowY = tableTop + 35;
            
            // Get line items from Stripe invoice
            const lineItems = invoiceData.lines?.data || [];
            
            if (lineItems.length === 0) {
                // Fallback if no line items
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#2d3748')
                   .text('Subscription', 60, rowY)
                   .text(`$${subtotal.toFixed(2)}`, 450, rowY, { align: 'right', width: 85 });
                rowY += 25;
            } else {
                for (const item of lineItems) {
                    const itemAmount = (item.amount || 0) / 100;
                    const itemSubtotal = BUSINESS_CONFIG.gstRegistered ? itemAmount - (itemAmount / 11) : itemAmount;
                    
                    doc.fontSize(10)
                       .font('Helvetica')
                       .fillColor('#2d3748')
                       .text(item.description || 'Subscription', 60, rowY, { width: 380 })
                       .text(`$${itemSubtotal.toFixed(2)}`, 450, rowY, { align: 'right', width: 85 });
                    rowY += 25;
                }
            }

            // === TOTALS ===
            const totalsY = rowY + 20;
            
            // Horizontal line above totals
            doc.moveTo(300, totalsY)
               .lineTo(545, totalsY)
               .strokeColor('#e2e8f0')
               .lineWidth(1)
               .stroke();

            // Subtotal
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#4a5568')
               .text('Subtotal (excl GST):', 350, totalsY + 15)
               .text(`$${subtotal.toFixed(2)}`, 450, totalsY + 15, { align: 'right', width: 85 });

            // GST
            if (BUSINESS_CONFIG.gstRegistered) {
                doc.text('GST (10%):', 350, totalsY + 33)
                   .text(`$${gstAmount.toFixed(2)}`, 450, totalsY + 33, { align: 'right', width: 85 });
            }

            // Total line
            doc.moveTo(300, totalsY + 55)
               .lineTo(545, totalsY + 55)
               .strokeColor('#2d3748')
               .lineWidth(2)
               .stroke();

            // Total
            doc.fontSize(12)
               .font('Helvetica-Bold')
               .fillColor('#2d3748')
               .text('TOTAL AUD:', 350, totalsY + 65)
               .text(`$${totalDollars.toFixed(2)}`, 450, totalsY + 65, { align: 'right', width: 85 });

            // === PAYMENT INFO ===
            if (invoiceData.status === 'paid') {
                doc.moveDown(3);
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#48bb78')
                   .text(`Payment received ${formattedDate} via Credit Card`, 50, totalsY + 110, { align: 'center' });
            }

            // === FOOTER ===
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#a0aec0')
               .text('Thank you for your business!', 50, 700, { align: 'center' });

            // Finalize PDF
            doc.end();
            
            logger.info(`Invoice PDF generated: ${invoiceNumber}`);

        } catch (error) {
            logger.error('Error generating invoice PDF:', error.message);
            reject(error);
        }
    });
}

/**
 * Get business config (for display purposes)
 */
function getBusinessConfig() {
    return { ...BUSINESS_CONFIG };
}

module.exports = {
    generateInvoicePdf,
    getBusinessConfig,
    BUSINESS_CONFIG
};
