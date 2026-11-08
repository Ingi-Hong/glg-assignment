export enum OrderStatus {
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
  PROCESSING = 'processing',
  SENDING_RECEIPT = 'sending_receipt',
}

export const getOrderStatus = (status: string): OrderStatus | undefined =>
  Object.values(OrderStatus).find((orderStatus) => orderStatus === status);
