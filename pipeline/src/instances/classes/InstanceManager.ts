import { EventEmitter } from "events";

import { Instance } from "./Instance";
import { InstanceType } from "./InstanceType";
import { InstanceSignal } from "./InstanceSignal";

import { Logger } from "../../utilities/logger/Logger";

import { ProjectSetupInstance } from "../impl/ProjectSetupInstance";
import { OrderIntakeInstance } from "../impl/OrderIntakeInstance";
import { OrderProcessorInstance } from "../impl/OrderProcessorInstance";
import { OrderEmailerInstance } from "../impl/OrderEmailerInstance";
import { OrderCancellationInstance } from "../impl/OrderCancellationInstance";
import { DeadLetterInstance } from "../impl/DeadLetterInstance";

const { INSTANCE_TYPE } = process.env;

const logger = new Logger("InstanceManager");

export class InstanceManager extends EventEmitter {
  private readonly instance: Instance;

  constructor() {
    super();

    const validInstanceTypes = Object.values(InstanceType);
    if (!INSTANCE_TYPE || !validInstanceTypes.includes(INSTANCE_TYPE as any)) {
      logger.error(
        `Invalid Instance Type Supplied! Expected: [${validInstanceTypes.join(", ")}] Received: ${
          INSTANCE_TYPE || "Not Supplied"
        }`
      );
      process.exit(1);
    }

    const registry = InstanceManager.getRegistry();

    const InstanceForType = registry.get(INSTANCE_TYPE as any);
    if (!InstanceForType) throw Error(`Expected to have instance for ${INSTANCE_TYPE} in registry`);

    const ReflectedInstance = Object.create(InstanceForType);
    this.instance = new ReflectedInstance.constructor();

    this.instance.on(InstanceSignal.CLEAN_SHUTDOWN, () => this.emit(InstanceSignal.CLEAN_SHUTDOWN));
    this.instance.on(InstanceSignal.ERROR_SHUTDOWN, () => this.emit(InstanceSignal.ERROR_SHUTDOWN));
  }

  private static getRegistry(): Map<InstanceType, Instance> {
    const registry = new Map<InstanceType, Instance>();
    registry.set(InstanceType.PROJECT_SETUP, ProjectSetupInstance.prototype);
    registry.set(InstanceType.ORDER_INTAKE, OrderIntakeInstance.prototype);
    registry.set(InstanceType.ORDER_PROCESSOR, OrderProcessorInstance.prototype);
    registry.set(InstanceType.ORDER_EMAILER, OrderEmailerInstance.prototype);
    registry.set(InstanceType.ORDER_CANCELLATION, OrderCancellationInstance.prototype);
    registry.set(InstanceType.DEAD_LETTER_QUEUE, DeadLetterInstance.prototype);
    return registry;
  }

  public async start(): Promise<void> {
    await this.instance.start();
  }

  public async stop(): Promise<void> {
    try {
      await this.instance.stop();
    } catch (error: any) {
      logger.error(error);
      process.exit(1);
    }
  }
}
