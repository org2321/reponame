import yargs from "yargs";
import { setAutoMode } from "./lib/console_io";

export type Command = (y: yargs.Argv) => yargs.Argv;

const commands: {
  cmd: Command;
  completion?: { name: string; fn: yargs.PromiseCompletionFunction };
}[] = [];
const completionsByName: Record<string, yargs.PromiseCompletionFunction> = {};

export const addCommand = (
  cmd: Command,
  completion?: { name: string; fn: yargs.PromiseCompletionFunction }
) => commands.push({ cmd, completion });

export const init = () => {
  yargs
    // built-in --version this does NOT work from inside webpack. it is handled in index.ts
    .version(false)
    .option("account", {
      type: "string",
      coerce: (s: string) => s.toLowerCase().trim(),
      describe: "Your EnvKey account's email",
    })
    .option("org", {
      type: "string",
      coerce: (s: string) => s.toLowerCase().trim(),
      describe:
        "Name of the organization (when you belong to more than one with the same email)",
    })
    .option("cli-envkey", {
      type: "string",
      conflicts: ["account", "org"],
      describe:
        "An access key for automating the CLI (can also be set by the CLI_ENVKEY environment variable)",
    })
    .option("json", {
      type: "boolean",
      describe:
        "Output JSON data on success and disable prompts (not all commands are supported)",
    })
    .option("json-pretty", {
      type: "boolean",
      describe:
        "Same as --json but formatted for readability",
    })
    .option("json-path", {
      type: "string",
      describe:
        "Filter --json output with an indexing expression",
    })
    .middleware((argv) => {
      if (argv["cli-envkey"] || process.env.CLI_ENVKEY || argv.json || argv["json-pretty"]) {
        setAutoMode(true, argv["json-path"], argv["json-pretty"]);
      }
      return argv;
    })
    .option("verbose", {
      type: "boolean",
      describe: "Certain commands have additional output available",
    });

  for (let { cmd, completion } of commands) {
    cmd(yargs);
    if (completion) {
      completionsByName[completion.name] = completion.fn;
    }
  }

  yargs
    .help()
    .alias({
      help: "h",
    })
    .completion(
      "get-shell-completion",
      "Output shell code to be added to bash profile, enabling autocomplete."
    )
    .demandCommand()
    .recommendCommands()
    .showHelpOnFail(true)
    .wrap(Math.min(yargs.terminalWidth(), 110))
    // prevents perpetual hang when partial commands like `accounts:notreal` are given,
    // instead will print "Unknown argument"
    .strict()
    .parse();
};
