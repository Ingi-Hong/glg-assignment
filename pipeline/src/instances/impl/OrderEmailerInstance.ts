import { existsSync, promises as fs } from "fs";

import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { EmailService } from "../../services/email/EmailService";

const { SQS_ORDER_EMAIL_QUEUE_NAME } = process.env;

export class OrderEmailerInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderEmailerInstance", queueName: SQS_ORDER_EMAIL_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Email the customer with the order details and receipt.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    const order = await OrdersDatabase.getOrderById(orderId);

    if (!order) throw new Error(`Order not found: ${orderId}`);
    /* SENDING_RECEIPT means a previous attempt claimed the receipt but did not finish; retry the send */
    if (order.status !== OrderStatus.PROCESSING && order.status !== OrderStatus.SENDING_RECEIPT) {
      this.logger.warn(`Order ${orderId} is not in PROCESSING or SENDING_RECEIPT state`);
      return;
    }

    /* The processor sets receiptFilePath before queueing this message, so a missing one is a fault: retry, then dead-letter */
    if (!order.receiptFilePath) throw new Error(`Order ${orderId} does not have a receipt file path`);

    const receipt = await fs.readFile(order.receiptFilePath);
    const email = EmailService.buildReceiptEmail(order, receipt);

    // Past this claim the order can no longer be cancelled
    if (!(await OrdersDatabase.claimReceipt(orderId))) {
      this.logger.info(`Order ${orderId} was cancelled before its receipt was claimed; receipt not sent`);
      return;
    }

    await EmailService.sendEmail(email);
    this.logger.info(`Order ${orderId} email sent`);

    if (!(await OrdersDatabase.completeOrder(orderId))) {
      this.logger.error(`Order ${orderId} left SENDING_RECEIPT while its receipt was being sent; not completed`);
    }
    else {
      this.logger.info(`Order ${orderId} status updated`);
    }

    if (existsSync(order.receiptFilePath)) {
      await fs.unlink(order.receiptFilePath);
    }
  }
}
