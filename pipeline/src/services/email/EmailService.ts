import nodemailer from 'nodemailer';
import { Order } from "../../definitions/entities/Order";

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

const { SMTP_HOST, SMTP_PORT } = process.env;

const FROM = '"Your Company" <no-reply@yourcompany.com>';

export class EmailService {
  /**
   * Build the email that delivers a completed order's receipt.
   */
  public static buildReceiptEmail(order: Order, receipt: Buffer): Email {
    return {
      to: EmailService.getRecipient(order),
      subject: `Receipt for Order ${order.orderId}`,
      text: `Dear ${order.details?.customer.name},
      Thank you for your purchase! Please find your receipt attached.

      Best regards,
      Your Company`,
      attachments: [
        {
          filename: `receipt_${order.orderId}.pdf`,
          content: receipt,
          contentType: 'application/pdf',
        },
      ],
    };
  }

  /**
   * Build the email telling the customer their order has been cancelled.
   */
  public static buildCancellationEmail(order: Order): Email {
    return {
      to: EmailService.getRecipient(order),
      subject: `Order ${order.referenceId} cancelled`,
      text: `Dear ${order.details?.customer.name},
      Your order has been cancelled. You can disregard any receipts or confirmations you may have received.

      Order ID: ${order.orderId}
      Reference: ${order.referenceId}

      Best regards,
      Your Company`,
    };
  }

  public static async sendEmail(email: Email): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: false,
    });

    await transporter.sendMail({ from: FROM, ...email });
  }

  private static getRecipient(order: Order): string {
    const email = order.details?.customer.email;
    if (!email) throw new Error(`Order ${order.orderId} has no customer email`);
    return email;
  }
}
