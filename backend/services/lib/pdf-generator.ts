/**
 * PDF Generator Service
 * 
 * Generates PDF documents for address verification letters.
 * Supports bilingual content (English and Serbian) with LocalStays branding.
 */

import PDFDocument from 'pdfkit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.BUCKET_NAME!;

interface AddressVerificationLetterData {
  hostName: string;
  businessName?: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    locality: string;
    administrativeArea?: string;
    postalCode: string;
    country: string;
    countryCode: string;
  };
  verificationCode: string;
  language: 'en' | 'sr';
}

interface LetterContent {
  title: string;
  greeting: string;
  bodyParagraph1: string;
  bodyParagraph2: string;
  instructionsTitle: string;
  instructions: string[];
  closingLine: string;
  signature: string;
  footer: string;
}

/**
 * Get letter content based on language
 */
function getLetterContent(language: 'en' | 'sr'): LetterContent {
  if (language === 'sr') {
    return {
      title: 'Verifikacija Nekretnine',
      greeting: 'Postovani',
      bodyParagraph1: 'Da biste zavrsili verifikaciju vaseg oglasa, molimo vas da unesete sledeci verifikacioni kod u vas LocalStays kontrolni panel:',
      bodyParagraph2: 'Ovaj kod je jedinstven za vasu nekretninu i moze se koristiti samo jednom.',
      instructionsTitle: 'Uputstva:',
      instructions: [
        '1. Prijavite se na vas LocalStays nalog',
        '2. Kliknite na vasu nekretninu da otvorite detalje',
        '3. Idite na deo "Zahtevi" (Requests)',
        '4. Otvorite zahtev "Verifikacija Adrese"',
        '5. Unesite gornji kod u polje za unos'
      ],
      closingLine: 'Ako imate bilo kakvih pitanja, molimo vas kontaktirajte nasu podrsku.',
      signature: 'Srdacan pozdrav,\nLocalStays Tim',
      footer: 'localstays.me'
    };
  }

  // Default to English
  return {
    title: 'Property Verification',
    greeting: 'Dear',
    bodyParagraph1: 'To complete the verification of your property listing, please enter the following verification code in your LocalStays dashboard:',
    bodyParagraph2: 'This code is unique to your property and can only be used once.',
    instructionsTitle: 'Instructions:',
    instructions: [
      '1. Log into your LocalStays account',
      '2. Click on your property listing to open details',
      '3. Go to the "Requests" section',
      '4. Open the "Address Verification" request',
      '5. Enter the code above in the input field'
    ],
    closingLine: 'If you have any questions, please contact our support team.',
    signature: 'Best regards,\nThe LocalStays Team',
    footer: 'localstays.me'
  };
}

/**
 * Format address for letter
 */
function formatAddress(address: AddressVerificationLetterData['address']): string[] {
  const lines: string[] = [];
  
  lines.push(address.addressLine1);
  if (address.addressLine2) {
    lines.push(address.addressLine2);
  }
  
  let cityLine = address.locality;
  if (address.postalCode) {
    cityLine += `, ${address.postalCode}`;
  }
  lines.push(cityLine);
  
  if (address.administrativeArea) {
    lines.push(address.administrativeArea);
  }
  
  // Use the country name from the listing address (not the code)
  lines.push(address.country);
  
  return lines;
}

/**
 * Generate address verification letter PDF
 */
export async function generateAddressVerificationLetter(
  data: AddressVerificationLetterData,
  hostId: string,
  listingId: string,
  requestId: string
): Promise<string> {
  console.log('Generating address verification letter:', {
    listingId,
    requestId,
    language: data.language,
  });

  // Create PDF document with custom font path
  // This ensures pdfkit can find font files in Lambda environment
  const doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: 72,
      bottom: 72,
      left: 72,
      right: 72,
    },
  });

  // Register Roboto font for Serbian Latin character support (Č, Ć, Ž, Š, Đ)
  const robotoPath = path.join(__dirname, 'fonts', 'Roboto-Regular.ttf');
  const robotoBoldPath = path.join(__dirname, 'fonts', 'Roboto-Bold.ttf');
  
  doc.registerFont('Roboto', robotoPath);
  doc.registerFont('Roboto-Bold', robotoBoldPath);
  
  // Use Roboto as default font
  doc.font('Roboto');

  // Collect PDF data in buffer
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Get content based on language
  const content = getLetterContent(data.language);

  // Add letterhead with LocalStays branding colors
  doc
    .fontSize(28)
    .fillColor('#334155')  // Dark slate blue for "Local"
    .text('Local', 72, 72, { continued: true })
    .fillColor('#ef4444')  // Red for "Stays"
    .text('Stays', { continued: false });

  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor('#64748b')  // Slate gray
    .text('localstays.me', 72);

  // Add horizontal line
  doc
    .moveTo(72, 135)
    .lineTo(523, 135)
    .strokeColor('#e2e8f0')  // Light slate
    .stroke();

  doc.moveDown(2);

  // Add recipient address (right-aligned)
  const recipientName = data.businessName || data.hostName;
  const addressLines = formatAddress(data.address);

  doc
    .fontSize(11)
    .fillColor('#000000');

  let yPosition = 160;
  doc.text(recipientName, 350, yPosition, { align: 'left' });
  yPosition += 15;

  addressLines.forEach((line) => {
    doc.text(line, 350, yPosition, { align: 'left' });
    yPosition += 15;
  });

  doc.moveDown(3);

  // Add greeting
  doc
    .fontSize(11)
    .fillColor('#000000')
    .text(`${content.greeting} ${data.hostName},`, 72);

  doc.moveDown(1);

  // Add body paragraph 1
  doc
    .fontSize(11)
    .fillColor('#000000')
    .text(content.bodyParagraph1, 72, undefined, {
      width: 450,
      align: 'left',
    });

  doc.moveDown(2);

  // Add verification code (centered, large, bold)
  doc
    .fontSize(32)
    .fillColor('#ef4444')  // Match LocalStays red
    .font('Roboto-Bold')
    .text(data.verificationCode, 72, undefined, {
      width: 450,
      align: 'center',
    });

  doc.moveDown(2);

  // Add body paragraph 2 (switch back to regular font)
  doc
    .fontSize(11)
    .fillColor('#000000')
    .font('Roboto')
    .text(content.bodyParagraph2, 72, undefined, {
      width: 450,
      align: 'left',
    });

  doc.moveDown(1.5);

  // Add instructions
  doc
    .fontSize(11)
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .text(content.instructionsTitle, 72);

  doc.moveDown(0.5);

  doc.font('Helvetica');
  content.instructions.forEach((instruction) => {
    doc.text(instruction, 72);
  });

  doc.moveDown(1.5);

  // Add closing line
  doc
    .fontSize(11)
    .fillColor('#000000')
    .text(content.closingLine, 72, undefined, {
      width: 450,
      align: 'left',
    });

  doc.moveDown(2);

  // Add signature
  doc
    .fontSize(11)
    .fillColor('#000000')
    .text(content.signature, 72);

  // Add footer at bottom of page
  doc
    .fontSize(9)
    .fillColor('#666666')
    .text(content.footer, 72, 750, {
      width: 450,
      align: 'center',
    });

  // Finalize PDF
  doc.end();

  // Wait for PDF to be generated
  const pdfBuffer = await pdfPromise;

  // Upload to S3 following the structure: {hostId}/listings/{listingId}/verification/
  const s3Key = `${hostId}/listings/${listingId}/verification/address-verification-${requestId}.pdf`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      Metadata: {
        hostId,
        listingId,
        requestId,
        language: data.language,
        generatedAt: new Date().toISOString(),
      },
    })
  );

  console.log(`✅ PDF uploaded to S3: ${s3Key}`);

  // Return S3 URL
  const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
  return s3Url;
}

/**
 * Generate random 6-character verification code
 * Excludes ambiguous characters: 0, O, 1, I, l
 */
export function generateVerificationCode(): string {
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let code = '';
  
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    code += charset[randomIndex];
  }
  
  return code;
}

/**
 * Encrypt verification code for storage
 * Uses simple crypto for now - can be enhanced with AWS KMS if needed
 */
export function encryptVerificationCode(code: string): string {
  // For now, use base64 encoding with a salt
  // In production, consider using AWS KMS or stronger encryption
  const salt = process.env.VERIFICATION_CODE_SALT || 'localstays-verification-salt';
  const combined = `${salt}:${code}`;
  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypt verification code
 */
export function decryptVerificationCode(encrypted: string): string {
  const combined = Buffer.from(encrypted, 'base64').toString('utf-8');
  const parts = combined.split(':');
  return parts[1] || '';
}

