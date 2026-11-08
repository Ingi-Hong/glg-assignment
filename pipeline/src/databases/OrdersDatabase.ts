import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";

import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

import { MutableOrderFields, Order } from "../definitions/entities/Order";
import { OrderStatus } from "../definitions/enums/OrderStatus";
import { DynamoService } from "../services/dynamo/DynamoService";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface DynamoUpdateParams {
  UpdateExpression: string;
  ExpressionAttributeValues: {
    [key: string]: AttributeValue;
  };
  ExpressionAttributeNames?: {
    [key: string]: string;
  };
}

const { DYNAMO_TABLE_ORDERS } = process.env;

export class OrdersDatabase {
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

  public static async update(orderId: string, mutableFields: MutableOrderFields): Promise<void> {
    const { status } = mutableFields;

    const params: DynamoUpdateParams = {
      UpdateExpression: "set updatedAt = :updatedAt",
      ExpressionAttributeValues: { ":updatedAt": { N: `${Date.now()}` } },
      ExpressionAttributeNames: {}
    };

    const manualFields = ["status"];

    Object.entries(mutableFields).forEach((entry) => {
      const [key, value] = entry;
      if (!manualFields.includes(key) && value !== undefined && value !== null) {
        params.UpdateExpression += `, ${key} = :${key}`;
        params.ExpressionAttributeValues[`:${key}`] = marshall({ [key]: value })[key];
      }
    });

    if (status !== undefined) {
      params.UpdateExpression += ", #status = :status";
      params.ExpressionAttributeValues[":status"] = { S: status };
      params.ExpressionAttributeNames!["#status"] = "status";
    }

    /* If unused, remove because dynamo won't allow this to be empty */
    if (params.ExpressionAttributeNames && Object.keys(params.ExpressionAttributeNames).length === 0) {
      delete params.ExpressionAttributeNames;
    }

    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS!,
      Key: { orderId: { S: orderId } },
      ...params
    });

    const dynamo = DynamoService.getClient();
    await dynamo.send(command);
  }

  /**
   * Claim an order's receipt before sending it: move it to SENDING_RECEIPT, after which the API refuses to
   * cancel it. Re-claiming an order already in SENDING_RECEIPT succeeds, so an SQS retry can resend.
   * Returns false if the order was cancelled (or otherwise left PROCESSING) before the claim.
   */
  public static async claimReceipt(orderId: string): Promise<boolean> {
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "SET #status = :sending, updatedAt = :now",
      ConditionExpression: "#status IN (:processing, :sending)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":sending": { S: OrderStatus.SENDING_RECEIPT },
        ":processing": { S: OrderStatus.PROCESSING },
        ":now": { N: `${Date.now()}` },
      },
    });

    try {
      await DynamoService.getClient().send(command);
      return true;
    }
    catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  /**
   * Move an order whose receipt has been sent from SENDING_RECEIPT to COMPLETED.
   * Returns false if the order was not in SENDING_RECEIPT.
   */
  public static async completeOrder(orderId: string): Promise<boolean> {
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const now = Date.now();
    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "SET #status = :completed, completedAt = :now, updatedAt = :now",
      ConditionExpression: "#status = :sending",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":completed": { S: OrderStatus.COMPLETED },
        ":sending": { S: OrderStatus.SENDING_RECEIPT },
        ":now": { N: `${now}` },
      },
    });

    try {
      await DynamoService.getClient().send(command);
      return true;
    }
    catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  /**
   * Record that a cancelled order's cancellation has been processed (customer emailed, receipt removed)
   * by setting cancelProcessedAt. Once set, the API allows the order to be deleted.
   * Returns false if the order is no longer CANCELLED or cancelProcessedAt was already set.
   */
  public static async markCancellationProcessed(orderId: string): Promise<boolean> {
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const now = Date.now();
    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "SET cancelProcessedAt = :now, updatedAt = :now",
      ConditionExpression: "#status = :cancelled AND attribute_not_exists(cancelProcessedAt)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":cancelled": { S: OrderStatus.CANCELLED },
        ":now": { N: `${now}` },
      },
    });

    try {
      await DynamoService.getClient().send(command);
      return true;
    }
    catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}
