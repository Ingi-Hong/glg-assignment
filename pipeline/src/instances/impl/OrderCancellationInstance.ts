import { promises as fs } from "fs";

import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { EmailService } from "../../services/email/EmailService";

const { SQS_ORDER_CANCELLATION_QUEUE_NAME } = process.env;

export class OrderCancellationInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderCancellationInstance", queueName: SQS_ORDER_CANCELLATION_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Email the customer that their order was cancelled and clean up any receipt rendered before the cancellation,
   * then set cancelProcessedAt to record that the cancellation is processed. The API has already set the order to
   * CANCELLED, and only allows deleting it once cancelProcessedAt is set.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    const order = await OrdersDatabase.getOrderById(orderId);

    /* Delete requires cancelProcessedAt, so a missing order was already processed and then deleted */
    if (!order) {
      this.logger.warn(`Order ${orderId} not found; assuming its cancellation was processed and it was deleted`);
      return;
    }
    if (order.status !== OrderStatus.CANCELLED) {
      this.logger.warn(`Order ${orderId} is not in CANCELLED state`);
      return;
    }
    /* SQS redelivery or a re-queue from a repeat cancel: the customer has already been emailed */
    if (order.cancelProcessedAt !== undefined) {
      this.logger.info(`Order ${orderId} cancellation already processed; skipping`);
      return;
    }

    /* The receipt emailer skips cancelled orders, so it will never delete this file */
    if (order.receiptFilePath) {
      await fs.unlink(order.receiptFilePath).catch(() => {});
      this.logger.info(`Order ${orderId} receipt removed: ${order.receiptFilePath}`);
    }

    /* Cancelled before intake ran: there is no customer to notify */
    if (!order.details?.customer.email) {
      this.logger.warn(`Order ${orderId} has no customer details; cancellation email skipped`);
    }
    else {
      await EmailService.sendEmail(EmailService.buildCancellationEmail(order));
      this.logger.info(`Order ${orderId} cancellation email sent`);
    }

    await OrdersDatabase.markCancellationProcessed(orderId);
    this.logger.info(`Order ${orderId} cancellation processed`);
  }
}
