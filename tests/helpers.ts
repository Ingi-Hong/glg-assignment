import { randomUUID } from "node:crypto";
import { vi } from "vitest";

import { OrdersDatabase as ApiOrdersDatabase } from "../app/src/databases/OrdersDatabase";
import { OrderFactory } from "../app/src/definitions/entities/Order";
import { OrdersDatabase } from "../pipeline/src/databases/OrdersDatabase";
import { Order } from "../pipeline/src/definitions/entities/Order";
import { OrderMessage } from "../pipeline/src/definitions/messages/OrderMessage";
import { QueueInstance } from "../pipeline/src/instances/classes/QueueInstance";
import { OrderIntakeInstance } from "../pipeline/src/instances/impl/OrderIntakeInstance";
import { OrderProcessorInstance } from "../pipeline/src/instances/impl/OrderProcessorInstance";
import { OrderEmailerInstance } from "../pipeline/src/instances/impl/OrderEmailerInstance";
import { OrderCancellationInstance } from "../pipeline/src/instances/impl/OrderCancellationInstance";
import { Email, EmailService } from "../pipeline/src/services/email/EmailService";
import { SimpleQueueService } from "../pipeline/src/services/sqs/SimpleQueueService";

/**
 * Run one pipeline step on an order, the way its worker would after receiving the order's message.
 * process() is protected; tests call it directly so they decide the order steps run in.
 */
const run = (instance: QueueInstance<OrderMessage>) => (orderId: string): Promise<void> =>
  (instance as unknown as { process(message: OrderMessage): Promise<void> }).process({ orderId });

export const pipeline = {
  intake: run(new OrderIntakeInstance()),
  processor: run(new OrderProcessorInstance()),
  emailer: run(new OrderEmailerInstance()),
  cancellation: run(new OrderCancellationInstance()),
};

/** The API's database operations: what POST /api/orders, POST /:id/cancel and DELETE /:id call. */
export const api = ApiOrdersDatabase;

/** Create a new order exactly as POST /api/orders stores it. */
export async function placeOrder(): Promise<string> {
  const order = OrderFactory.createOrder({ userId: "test-user", referenceId: randomUUID() });
  await ApiOrdersDatabase.createOrder(order);
  return order.orderId;
}

export async function getOrder(orderId: string): Promise<Order> {
  const order = await OrdersDatabase.getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  return order;
}

/**
 * Replace email sending and queue sends with spies. Steps are run by hand, so no message needs to reach a
 * queue, and emails are checked by what the pipeline tried to send.
 */
export function stubSideEffects() {
  const sendEmail = vi.spyOn(EmailService, "sendEmail").mockResolvedValue();
  vi.spyOn(SimpleQueueService, "sendMessage").mockResolvedValue();

  const sent = (): Email[] => sendEmail.mock.calls.map(([email]) => email);
  return {
    sendEmail,
    receiptEmails: () => sent().filter((email) => email.subject.startsWith("Receipt for Order")),
    cancellationEmails: () => sent().filter((email) => email.subject.endsWith("cancelled")),
  };
}
