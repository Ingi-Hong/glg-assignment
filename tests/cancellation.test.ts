import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrdersDatabase } from "../pipeline/src/databases/OrdersDatabase";
import { OrderStatus } from "../pipeline/src/definitions/enums/OrderStatus";
import { api, getOrder, pipeline, placeOrder, stubSideEffects } from "./helpers";

/*
 * The pipeline runs each order through intake -> processor -> emailer. These tests place a cancel at each
 * point along that path and check the customer ends up with exactly one outcome: a receipt or a cancellation.
 */

let emails: ReturnType<typeof stubSideEffects>;

beforeEach(() => {
  emails = stubSideEffects();
});

/** Run an order through intake and the processor: details generated and the receipt PDF rendered. */
async function placeAndRender(): Promise<string> {
  const orderId = await placeOrder();
  await pipeline.intake(orderId);
  await pipeline.processor(orderId);
  return orderId;
}

describe("an order that is not cancelled", () => {
  it("completes and the customer receives one receipt", async () => {
    const orderId = await placeAndRender();
    const { receiptFilePath } = await getOrder(orderId);

    await pipeline.emailer(orderId);

    const order = await getOrder(orderId);
    expect(order.status).toBe(OrderStatus.COMPLETED);
    expect(emails.receiptEmails()).toHaveLength(1);
    expect(emails.receiptEmails()[0].to).toBe(order.details!.customer.email);
    expect(emails.receiptEmails()[0].attachments).toHaveLength(1);
    expect(existsSync(receiptFilePath!)).toBe(false);
  });

  it("totals its amount from the generated items", async () => {
    const orderId = await placeOrder();
    await pipeline.intake(orderId);

    const { details } = await getOrder(orderId);
    const itemsTotal = details!.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    expect(details!.amount).toBeCloseTo(itemsTotal, 2);
  });
});

describe("cancelling at each point in the pipeline", () => {
  it("before intake: the order is cancelled and, with no customer yet, no email is sent", async () => {
    const orderId = await placeOrder();

    expect((await api.cancelOrder(orderId)).outcome).toBe("cancelled");
    await pipeline.intake(orderId);
    await pipeline.cancellation(orderId);

    const order = await getOrder(orderId);
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(order.details).toBeUndefined();
    expect(order.cancelProcessedAt).toBeDefined();
    expect(emails.sendEmail).not.toHaveBeenCalled();
  });

  it("after the receipt is rendered, before it is emailed: the customer gets a cancellation, not a receipt", async () => {
    const orderId = await placeAndRender();
    const { receiptFilePath } = await getOrder(orderId);

    expect((await api.cancelOrder(orderId)).outcome).toBe("cancelled");
    await pipeline.emailer(orderId);
    await pipeline.cancellation(orderId);

    const order = await getOrder(orderId);
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(order.cancelProcessedAt).toBeDefined();
    expect(emails.receiptEmails()).toHaveLength(0);
    expect(emails.cancellationEmails()).toHaveLength(1);
    expect(emails.cancellationEmails()[0].to).toBe(order.details!.customer.email);
    expect(existsSync(receiptFilePath!)).toBe(false);
  });

  it("after the emailer read the order, before it claims the receipt: the claim fails and no receipt is sent", async () => {
    const orderId = await placeAndRender();

    /* The emailer has already seen PROCESSING; the cancel lands just before its claim reaches the database */
    const claimReceipt = OrdersDatabase.claimReceipt.bind(OrdersDatabase);
    let cancelOutcome: string | undefined;
    vi.spyOn(OrdersDatabase, "claimReceipt").mockImplementationOnce(async (id) => {
      cancelOutcome = (await api.cancelOrder(id)).outcome;
      return claimReceipt(id);
    });

    await pipeline.emailer(orderId);

    expect(cancelOutcome).toBe("cancelled");
    expect((await getOrder(orderId)).status).toBe(OrderStatus.CANCELLED);
    expect(emails.receiptEmails()).toHaveLength(0);
  });

  it("while the receipt email is being sent: the cancel is refused and the order completes", async () => {
    const orderId = await placeAndRender();

    /* The cancel request arrives in the middle of sending the receipt */
    let cancelOutcome: string | undefined;
    emails.sendEmail.mockImplementationOnce(async () => {
      cancelOutcome = (await api.cancelOrder(orderId)).outcome;
    });
    await pipeline.emailer(orderId);

    expect(cancelOutcome).toBe("not_cancellable");
    expect((await getOrder(orderId)).status).toBe(OrderStatus.COMPLETED);
    expect(emails.receiptEmails()).toHaveLength(1);
    expect(emails.cancellationEmails()).toHaveLength(0);
  });

  it("after the order completes: the cancel is refused", async () => {
    const orderId = await placeAndRender();
    await pipeline.emailer(orderId);

    expect((await api.cancelOrder(orderId)).outcome).toBe("not_cancellable");
    expect((await getOrder(orderId)).status).toBe(OrderStatus.COMPLETED);
  });

  it("after the order errored: the order can be cancelled", async () => {
    const orderId = await placeAndRender();
    await OrdersDatabase.update(orderId, { status: OrderStatus.ERROR });

    expect((await api.cancelOrder(orderId)).outcome).toBe("cancelled");
  });

  it("an unknown order: not found, and no order is created", async () => {
    const orderId = randomUUID();

    expect((await api.cancelOrder(orderId)).outcome).toBe("not_found");
    expect(await OrdersDatabase.getOrderById(orderId)).toBeNull();
  });
});

describe("repeated cancels and redelivered messages", () => {
  it("the customer receives one cancellation email however many times it is cancelled or processed", async () => {
    const orderId = await placeAndRender();

    expect((await api.cancelOrder(orderId)).outcome).toBe("cancelled");
    /* A repeat cancel before the pipeline catches up: the API queues the cancellation again */
    expect((await api.cancelOrder(orderId)).outcome).toBe("cancellation_pending");

    /* Both queued messages (or one message delivered twice) are processed */
    await pipeline.cancellation(orderId);
    await pipeline.cancellation(orderId);

    /* A repeat cancel after processing is a no-op */
    expect((await api.cancelOrder(orderId)).outcome).toBe("already_cancelled");
    expect(emails.cancellationEmails()).toHaveLength(1);
  });

  it("KNOWN LIMITATION: if the emailer fails after sending, the retry sends a second receipt", async () => {
    /*
     * Receipts are sent at least once. Sending an email can't be in the same transaction as the status update,
     * so a crash after the send but before the order completes means the redelivered message sends again.
     * The alternative (refusing to re-claim) would leave an order stuck in SENDING_RECEIPT, never receipted
     * and impossible to cancel. A duplicate receipt is the lesser failure.
     */
    const orderId = await placeAndRender();

    vi.spyOn(OrdersDatabase, "completeOrder").mockRejectedValueOnce(new Error("worker crashed"));
    await expect(pipeline.emailer(orderId)).rejects.toThrow("worker crashed");
    expect((await getOrder(orderId)).status).toBe(OrderStatus.SENDING_RECEIPT);

    /* SQS redelivers the message */
    await pipeline.emailer(orderId);

    expect((await getOrder(orderId)).status).toBe(OrderStatus.COMPLETED);
    expect(emails.receiptEmails()).toHaveLength(2);
  });
});

describe("deleting an order", () => {
  it("is refused until its cancellation is processed, then succeeds", async () => {
    const orderId = await placeAndRender();
    await api.cancelOrder(orderId);

    expect((await api.deleteOrder(orderId)).outcome).toBe("cancellation_pending");

    await pipeline.cancellation(orderId);

    expect((await api.deleteOrder(orderId)).outcome).toBe("deleted");
    expect(await OrdersDatabase.getOrderById(orderId)).toBeNull();
  });

  it("is refused for an order that was never cancelled", async () => {
    const orderId = await placeAndRender();
    await pipeline.emailer(orderId);

    expect((await api.deleteOrder(orderId)).outcome).toBe("not_deletable");
    expect((await getOrder(orderId)).status).toBe(OrderStatus.COMPLETED);
  });

  it("is not found for an unknown order", async () => {
    expect((await api.deleteOrder(randomUUID())).outcome).toBe("not_found");
  });
});
