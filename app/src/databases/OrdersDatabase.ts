import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

import { Order } from "../definitions/entities/Order";
import { OrderStatus } from "../definitions/enums/OrderStatus";
import { DynamoService } from "../services/dynamo/DynamoService";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface GetOrdersParams {
  userId?: string;
  status?: OrderStatus;
  referenceId?: string;
  count: number;
}

export type CancelOrderResult =
  | { outcome: "cancelled"; order: Order }
  | { outcome: "cancellation_pending"; order: Order }
  | { outcome: "already_cancelled"; order: Order }
  | { outcome: "not_cancellable"; order: Order }
  | { outcome: "not_found" };

export type DeleteOrderResult =
  | { outcome: "deleted"; order: Order }
  | { outcome: "cancellation_pending"; order: Order }
  | { outcome: "not_deletable"; order: Order }
  | { outcome: "not_found" };

const { DYNAMO_TABLE_ORDERS } = process.env;

export class OrdersDatabase {
  public static async createOrder(order: Order): Promise<void> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new PutItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Item: marshall(order, { removeUndefinedValues: true }),
    });

    await client.send(command);
  }

  public static async getOrders(params: GetOrdersParams): Promise<Order[]> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const { count } = params;

    /* Build filter expression */
    const filterExpression: Array<string> = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    const filters = ['userId', 'status', 'referenceId'];
    for (const filter of filters) {
      if (params[filter]) {
        filterExpression.push(`#${filter} = :${filter}`);
        expressionAttributeNames[`#${filter}`] = filter;
        expressionAttributeValues[`:${filter}`] = { S: params[filter] };
      }
    }

    const command = new ScanCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Limit: count,
      FilterExpression: filterExpression.length > 0 ? filterExpression.join(" AND ") : undefined,
      ExpressionAttributeNames: filterExpression.length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: filterExpression.length > 0 ? expressionAttributeValues : undefined,
      Select: "ALL_ATTRIBUTES"
    });

    const response = await client.send(command);
    if (!response.Items) return [];

    return response.Items.map((item) => unmarshall(item) as Order);
  }

  public static async getOrderById(orderId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new GetItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
    });

    const response = await client.send(command);
    if (!response.Item) return null;
    return unmarshall(response.Item) as Order;
  }

  public static async getOrderByReferenceId(referenceId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new QueryCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      IndexName: "referenceIdIndex",
      KeyConditionExpression: "referenceId = :referenceId",
      ExpressionAttributeValues: {
        ":referenceId": referenceId,
      },
      Select: "ALL_ATTRIBUTES",
      Limit: 1,
    });

    const response = await client.send(command);
    if (!response.Items || response.Items.length === 0) return null;
    return response.Items[0] as Order;
  }

  /**
   * Delete an order. Only a cancelled order whose cancellation the pipeline has finished processing
   * (cancelProcessedAt is set) can be deleted; the check and the delete are one conditional write.
   */
  public static async deleteOrder(orderId: string): Promise<DeleteOrderResult> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new DeleteItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      ConditionExpression: "#status = :cancelled AND attribute_exists(cancelProcessedAt)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":cancelled": { S: OrderStatus.CANCELLED } },
      ReturnValues: "ALL_OLD",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
    });

    try {
      const response = await client.send(command);
      return { outcome: "deleted", order: unmarshall(response.Attributes!) as Order };
    }
    catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      if (!error.Item) return { outcome: "not_found" };

      const order = unmarshall(error.Item) as Order;
      if (order.status === OrderStatus.CANCELLED) return { outcome: "cancellation_pending", order };
      return { outcome: "not_deletable", order };
    }
  }

  /**
   * Mark an order cancelled. cancelProcessedAt is left unset: the pipeline sets it once it has emailed the
   * customer and cleaned up, which is what makes the order deletable.
   */
  public static async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const now = Date.now();
    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "SET #status = :cancelled, updatedAt = :now",
      // attribute_exists stops UpdateItem from upserting a new order for an unknown ID
      ConditionExpression: "attribute_exists(orderId) AND #status IN (:processing, :error)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":cancelled": { S: OrderStatus.CANCELLED },
        ":processing": { S: OrderStatus.PROCESSING },
        ":error": { S: OrderStatus.ERROR },
        ":now": { N: `${now}` },
      },
      ReturnValues: "ALL_NEW",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
    });

    try {
      const response = await client.send(command);
      return { outcome: "cancelled", order: unmarshall(response.Attributes!) as Order };
    }
    catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      if (!error.Item) return { outcome: "not_found" };

      const order = unmarshall(error.Item) as Order;
      if (order.status !== OrderStatus.CANCELLED) return { outcome: "not_cancellable", order };
      if (order.cancelProcessedAt === undefined) return { outcome: "cancellation_pending", order };
      return { outcome: "already_cancelled", order };
    }
  }
}
