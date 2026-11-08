import { Router as ExpressRouter } from "express";

import { OrdersController } from "./OrdersController";
import { ControllerRouter } from "../ControllerRouter";

export class OrdersRouter extends ControllerRouter<OrdersController> {
  constructor() {
    super(OrdersController);
  }

  public getRouter(): ExpressRouter {
    this.router.get("/", this.controller.getOrders.bind(this.controller));
    this.router.get("/:orderId", this.controller.getOrderById.bind(this.controller));
    this.router.get("/reference/:referenceId", this.controller.getOrderByReferenceId.bind(this.controller));
    this.router.post("/", this.controller.createOrder.bind(this.controller));
    this.router.delete("/:orderId", this.controller.deleteOrder.bind(this.controller));
    this.router.post("/:orderId/cancel", this.controller.cancelOrder.bind(this.controller));
    return this.router;
  }
}
