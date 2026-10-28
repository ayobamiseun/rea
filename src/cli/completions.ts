import { Cli, Completions, Help, z } from "incur";

import {
  CLI_COMPLETION_SHELLS,
  cliCompletionShell,
  INCUR_BUILTIN_FLAGS,
  OUTPUT_SWITCHES,
  VALUED_OUTPUT_FLAGS,
  normalizeCliArguments,
  splitIncurBuiltinArguments,
} from "../cliBuiltinArguments.js";
import {
  CLI_DOCUMENT_OUTPUT_FORMATS,
  CLI_OUTPUT_FORMATS,
  parseCliOutputArguments,
} from "../cliOutput.js";
import { bashCompletionScript } from "./bashCompletionRegistration.js";

type Commands = Parameters<typeof Completions.complete>[0];
type CompletionCli = Parameters<typeof Cli.toCommands.get>[0];
type ServeOptions = NonNullable<Parameters<CompletionCli["serve"]>[1]>;
const ROOT_FLAGS = new Set(["--mcp", "--update", "--version"]);
type CompletionShell = (typeof CLI_COMPLETION_SHELLS)[number];
const COMPLETIONS_DESCRIPTION = "Generate shell completion script";

const standardGlobals = (root: boolean, doctor: boolean): z.ZodObject =>
  z.object(
    Object.fromEntries([
      ...[...VALUED_OUTPUT_FLAGS].map(
        (flag) =>
          [
            flag.slice(2),
            flag === "--format"
              ? z
                  .enum(
                    doctor ? CLI_DOCUMENT_OUTPUT_FORMATS : CLI_OUTPUT_FORMATS,
                  )
                  .optional()
              : z.string().optional(),
          ] as const,
      ),
      ...[...INCUR_BUILTIN_FLAGS]
        .filter(
          (flag) =>
            flag.startsWith("--") &&
            flag !== "--incur-update-check" &&
            (root || !ROOT_FLAGS.has(flag)),
        )
        .map((flag) => [flag.slice(2), z.boolean().optional()] as const),
      ...(root ? [["version", z.boolean().optional()] as const] : []),
    ]),
  );

/** Pinned Incur builtins are not exported in its registered command map. */
const completionCommands = (cli: CompletionCli): Commands => {
  const commands: Commands = new Map(Cli.toCommands.get(cli));
  commands.set("mcp", {
    _group: true,
    description: "Register as MCP server",
    commands: new Map([
      [
        "add",
        {
          description: "Register as MCP server",
          alias: { command: "c" },
          options: z.object({
            agent: z.string().optional(),
            command: z.string().optional(),
            noGlobal: z.boolean().optional(),
          }),
        },
      ],
      [
        "doctor",
        { description: "Validate MCP server startup and tool listing" },
      ],
    ]),
  });
  commands.set("completions", {
    _group: true,
    description: COMPLETIONS_DESCRIPTION,
    commands: new Map(CLI_COMPLETION_SHELLS.map((shell) => [shell, {}])),
  });
  // REA uses sync:false, so the framework's skills integration is disabled.
  return commands;
};

/**
 * Startup-file setup for each shell. The Zsh hook registers through `compdef`,
 * which exists only after `compinit`; evaluated earlier, it prints
 * `command not found: compdef` and registers nothing.
 */
const completionSetup = (
  name: string,
): Record<CompletionShell, readonly [command: string, note: string]> => ({
  bash: [`eval "$(${name} completions bash)"`, "# add to ~/.bashrc"],
  zsh: [
    `eval "$(${name} completions zsh)"`,
    "# add to ~/.zshrc after `autoload -Uz compinit && compinit`",
  ],
  fish: [
    `${name} completions fish | source`,
    "# add to ~/.config/fish/config.fish",
  ],
  nushell: [`see \`${name} completions nushell\``, "# add to config.nu"],
});

/** REA owns the completions help so the setup instructions match its hooks. */
const completionsHelp = (name: string): string => {
  const setup = completionSetup(name);
  const rows = CLI_COMPLETION_SHELLS.map(
    (shell) => [shell, ...setup[shell]] as const,
  );
  const shellWidth = Math.max(...rows.map(([shell]) => shell.length));
  const commandWidth = Math.max(...rows.map(([, command]) => command.length));
  return Help.formatCommand(`${name} completions`, {
    args: z.object({
      shell: z
        .enum(CLI_COMPLETION_SHELLS)
        .describe("Shell to generate completions for"),
    }),
    description: COMPLETIONS_DESCRIPTION,
    hideGlobalOptions: true,
    hint: [
      "Setup:",
      ...rows.map(
        ([shell, command, note]) =>
          `  ${shell.padEnd(shellWidth)}  ${command.padEnd(commandWidth)}  ${note}`,
      ),
    ].join("\n"),
  });
};

/** One tree owns command scope; the framework retains option/enum binding and shell formatting. */
export const createCliCompletions = (
  cli: CompletionCli,
  environment: Readonly<NodeJS.ProcessEnv>,
) => {
  const script = (shell: CompletionShell) =>
    shell === "bash"
      ? bashCompletionScript(cli.name)
      : Completions.register(shell, cli.name);
  return (arguments_: readonly string[], options: ServeOptions): boolean => {
    const write =
      options.stdout ?? ((text: string) => process.stdout.write(text));
    const shell = cliCompletionShell(environment);
    if (shell !== undefined) {
      const separator = arguments_.indexOf("--");
      const words =
        separator < 0 ? arguments_ : arguments_.slice(separator + 1);
      if (words.length === 0) {
        write(script(shell));
        return true;
      }
      const index = Number(environment._COMPLETE_INDEX ?? words.length - 1);
      if (!Number.isSafeInteger(index) || index < 0 || index > words.length)
        return true;
      // Consume global option values before scope resolution. A value named
      // 'mcp' is still data; leave an unfinished flag for Incur's enum hints.
      const before = splitIncurBuiltinArguments(
        normalizeCliArguments(words.slice(1, index)),
      ).command;
      const input = [cli.name, ...before, words[index] ?? ""];
      const candidates = Completions.complete(
        completionCommands(cli),
        undefined,
        input,
        input.length - 1,
        {
          schema: standardGlobals(
            before.length === 0,
            before[0] === "mcp" && before[1] === "doctor",
          ),
          alias: { help: "h" },
        },
      );
      const result = Completions.format(shell, candidates);
      if (result !== "") write(result);
      return true;
    }
    const normalized = normalizeCliArguments(arguments_);
    const split = splitIncurBuiltinArguments(normalized);
    const offset = split.command[0] === cli.name ? 1 : 0;
    if (split.command[offset] !== "completions") return false;
    const selected = CLI_COMPLETION_SHELLS.find(
      (value) => value === split.command[offset + 1],
    );
    const values = new Set(split.outputValues.map(({ index }) => index));
    const builtins = normalized.filter(
      (token, index) =>
        !values.has(index) &&
        ((INCUR_BUILTIN_FLAGS.has(token) && !OUTPUT_SWITCHES.has(token)) ||
          token === "--version"),
    );
    if (!parseCliOutputArguments(normalized).validation.ok) return false;
    // REA owns the completions help, with or without a shell. Manifests,
    // schema, version and server controls keep framework precedence.
    const help =
      builtins.length > 0 &&
      builtins.every((token) => token === "--help" || token === "-h");
    if (
      help ||
      (builtins.length === 0 && split.command.length === offset + 1)
    ) {
      write(`${completionsHelp(cli.name)}\n`);
      return true;
    }
    if (
      builtins.length > 0 ||
      selected === undefined ||
      split.command.length !== offset + 2
    )
      return false;
    write(`${script(selected)}\n`);
    return true;
  };
};
