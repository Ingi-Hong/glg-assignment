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

export type MutableOrderFields = Partial<Pick<Order, "receiptFilePath" | "details" | "updatedAt" | "completedAt" | "status">>
