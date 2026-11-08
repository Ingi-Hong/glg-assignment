import { Request, Response } from "express";

import { Controller } from "../Controller";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { getOrderStatus } from "../../definitions/enums/OrderStatus";
import { OrderFactory } from "../../definitions/entities/Order";
import { SimpleQueueService } from "../../services/sqs/SimpleQueueService";

const { SQS_ORDER_INTAKE_QUEUE_NAME } = process.env;

/**
 * @swagger
 * tags:
 *  name: Orders
 *  description: Endpoints for managing orders.
 */
export class OrdersController extends Controller {
  public constructor() {
    super("OrdersController");
  }

  /**
   * @swagger
   * /api/orders:
   *    get:
   *      tags: [Orders]
   *      summary: Get a list of orders.
   *      parameters:
   *        - in: query
   *          name: userId
   *          required: false
   *          schema:
   *            type: number
   *            description: The user ID to filter orders by.
   *        - in: query
   *          name: status
   *          required: false
   *          schema:
   *            type: string
   *            description: The status to filter orders by.
   *            enum: [PROCESSING, COMPLETED, ERROR]
   *        - in: query
   *          name: count
   *          required: true
   *          schema:
   *            type: number
   *            description: The number of orders to return.
   *      produces:
   *        - application/json
   *      responses:
   *        "200":
   *          description: OK
   *        "400":
   *          description: BAD REQUEST
   *        "500":
   *          description: ERROR
   */
  public async getOrders(req: Request, res: Response): Promise<void> {
    try {
      const { userId, status, count } = req.query;
      const orders = await OrdersDatabase.getOrders({
        userId: userId ? `${userId}` : undefined,
        status: status ? getOrderStatus(`${status}`) : undefined,
        count: Number(count)
      });
      res.status(200).json({ success: true, data: orders });
    }
    catch (error) {
      this.handleError(req, res, error);
    }
  }

  /**
    * @swagger
    * /api/orders/{orderId}:
    *    get:
    *      tags: [Orders]
    *      summary: Get an order by ID.
    *      parameters:
    *        - in: path
    *          name: orderId
    *          required: true
    *          schema:
    *            type: string
    *            description: The ID of the order to get.
    *      produces:
    *        - application/json
    *      responses:
    *        "200":
    *          description: OK
    *        "400":
    *          description: BAD REQUEST
    *        "404":
    *          description: ORDER NOT FOUND
    *        "500":
    *          description: ERROR
    */
  public async getOrderById(req: Request, res: Response): Promise<void> {
    try {
      const { orderId } = req.params;
      const order = await OrdersDatabase.getOrderById(orderId);
      if (!order) {
        res.status(404).json({ success: false, message: "ORDER_NOT_FOUND" });
        return;
      }
      res.status(200).json({ success: true, order });
    }
    catch (error) {
      this.handleError(req, res, error);
    }
  }

  /**
    * @swagger
    * /api/orders/reference/{referenceId}:
    *    get:
    *      tags: [Orders]
    *      summary: Get an order by reference ID.
    *      parameters:
    *        - in: path
    *          name: referenceId
    *          required: true
    *          schema:
    *            type: string
    *            description: The reference ID of the order to get.
    *      produces:
    *        - application/json
    *      responses:
    *        "200":
    *          description: OK
    *        "400":
    *          description: BAD REQUEST
    *        "404":
    *          description: ORDER NOT FOUND
    *        "500":
    *          description: ERROR
    */
  public async getOrderByReferenceId(req: Request, res: Response): Promise<void> {
    try {
      const { referenceId } = req.params;
      const order = await OrdersDatabase.getOrderByReferenceId(referenceId);
      if (!order) {
        res.status(404).json({ success: false, message: "ORDER_NOT_FOUND" });
        return;
      }
      res.status(200).json({ success: true, order });
    }
    catch (error) {
      this.handleError(req, res, error);
    }
  }

  /**
    * @swagger
    * /api/orders:
    *    post:
    *      tags: [Orders]
    *      summary: Create a new order.
    *      requestBody:
    *        required: true
    *        content:
    *          application/json:
    *            schema:
    *              type: object
    *              properties:
    *                userId:
    *                  type: string
    *                  description: The user ID for the order.
    *                referenceId:
    *                  type: string
    *                  description: The reference ID for the order.
    *                amount:
    *                  type: number
    *                  nullable: true
    *                  deprecated: true
    *                  description: >-
    *                    Deprecated. Any value sent is ignored.
    *      produces:
    *        - application/json
    *      responses:
    *        "200":
    *          description: OK
    *        "400":
    *          description: BAD REQUEST
    *        "500":
    *          description: ERROR
    */
  public async createOrder(req: Request, res: Response): Promise<void> {
    try {
      const { userId, referenceId } = req.body;
      const existing = await OrdersDatabase.getOrderByReferenceId(referenceId);
      if (existing) {
        res.status(400).json({ success: false, message: "ORDER_ALREADY_EXISTS" });
        return;
      }

      const order = OrderFactory.createOrder({ userId, referenceId });
      await OrdersDatabase.createOrder(order);

      await SimpleQueueService.sendMessage(SQS_ORDER_INTAKE_QUEUE_NAME, "Placing order from API", { orderId: order.orderId });
      res.status(200).json({ success: true, order });
    }
    catch (error) {
      this.handleError(req, res, error);
    }
  }

  /**
    * @swagger
    * /api/orders:
    *    delete:
    *      tags: [Orders]
    *      summary: Delete an order.
    *      requestBody:
    *        required: true
    *        content:
    *          application/json:
    *            schema:
    *              type: object
    *              properties:
    *                orderId:
    *                  type: string
    *                  description: The ID for the order.
    *      produces:
    *        - application/json
    *      responses:
    *        "200":
    *          description: OK
    *        "404":
    *          description: BAD REQUEST
    *        "400":
    *          description: BAD REQUEST
    *        "500":
    *          description: ERROR
    */
  public async deleteOrder(req: Request, res: Response): Promise<void> {
    try {
      const { orderId } = req.body;
      if (!orderId) {
        res.status(400).json({ success: false, message: "ORDER_ID_REQUIRED" });
        return;
      }

      const order = await OrdersDatabase.getOrderById(orderId);
      if (!order) {
        res.status(404).json({ success: false, message: "ORDER_NOT_FOUND" });
        return;
      }

      await OrdersDatabase.deleteOrder(orderId);
      res.status(200).json({ success: true, order });
    }
    catch (error) {
      this.handleError(req, res, error);
    }
  }
}
