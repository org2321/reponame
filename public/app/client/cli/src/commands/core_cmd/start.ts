import { exit } from "../../lib/process";
import { Argv } from "yargs";
import { BaseArgs } from "../../types";
import { startCore } from "../../lib/core";

export const command = "start";
export const desc = "Start the EnvKey core process";
export const builder = (yargs: Argv<BaseArgs>) => yargs;
export const handler = async (
  argv: BaseArgs & {}
): Promise<void> => {
  const res = await startCore();
  console.log(
    res ? "Started EnvKey core process." : "EnvKey core already running."
  );
  // need to manually exit process since yargs doesn't properly wait for async handlers
  return exit();
};
