declare module "nodemailer" {
  export interface Transporter {
    sendMail(
      mailOptions: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
  }
  export function createTransport(
    options: Record<string, unknown>
  ): Transporter;
}
