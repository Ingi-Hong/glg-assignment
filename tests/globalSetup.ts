import { ProjectSetupInstance } from "../pipeline/src/instances/impl/ProjectSetupInstance";
import { InstanceSignal } from "../pipeline/src/instances/classes/InstanceSignal";

/**
 * Recreate the test stage's tables and receipt directory with the project's own setup instance.
 * STAGE=test (set by the compose service) keeps this away from the dev tables.
 */
export default async function setup(): Promise<void> {
  if (process.env.STAGE !== "test") {
    throw new Error(`Refusing to run: STAGE must be "test" (got "${process.env.STAGE}"); setup drops and recreates tables`);
  }

  const instance = new ProjectSetupInstance();
  await new Promise<void>((resolve, reject) => {
    instance.once(InstanceSignal.CLEAN_SHUTDOWN, resolve);
    instance.once(InstanceSignal.ERROR_SHUTDOWN, () => reject(new Error("Project setup failed")));
    instance.start();
  });
}
