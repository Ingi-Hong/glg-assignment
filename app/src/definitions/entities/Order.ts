import { randomUUID } from "node:crypto";

import { OrderStatus } from "../enums/OrderStatus";
import { OrderDetails } from "./OrderDetails";

export interface Order {
  orderId: string;
  userId: string;
  referenceId: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  receiptFilePath?: string;
  details?: OrderDetails;
  completedAt?: number;
}

export class OrderFactory {
  public static createOrder(params: Pick<Order, "userId" | "referenceId">): Order {
    return {
      orderId: randomUUID(),
      userId: params.userId,
      referenceId: params.referenceId,
      status: OrderStatus.PROCESSING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}
