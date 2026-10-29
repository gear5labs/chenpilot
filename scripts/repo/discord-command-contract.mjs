import ts from "typescript";

const optionTypeByBuilder = new Map([
  ["addStringOption", "string"],
  ["addIntegerOption", "integer"],
  ["addNumberOption", "number"],
]);

const optionTypeByGetter = new Map([
  ["getString", "string"],
  ["getInteger", "integer"],
  ["getNumber", "number"],
]);

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function propertyName(expression) {
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : undefined;
}

function stringValue(node) {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function callChain(expression) {
  const calls = [];

  function collect(node) {
    if (ts.isParenthesizedExpression(node)) {
      collect(node.expression);
    } else if (ts.isCallExpression(node)) {
      collect(node.expression);
      calls.push(node);
    } else if (ts.isPropertyAccessExpression(node)) {
      collect(node.expression);
    }
  }

  collect(expression);
  return calls;
}

function parseOptionBuilder(methodName, callback) {
  const type = optionTypeByBuilder.get(methodName);
  if (!type || !callback || !ts.isArrowFunction(callback)) return undefined;

  const calls = callChain(callback.body);
  const nameCall = calls.find(
    (call) => propertyName(call.expression) === "setName"
  );
  const requiredCall = calls.find(
    (call) => propertyName(call.expression) === "setRequired"
  );
  const name = nameCall && stringValue(nameCall.arguments[0]);

  if (!name) return undefined;

  return {
    name,
    type,
    required: requiredCall?.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword,
  };
}

export function extractCommandDefinitions(
  sourceText,
  fileName = "slashCommands.ts"
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let declaration;
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "slashCommandDefinitions"
    ) {
      declaration = node;
    }
  });

  if (
    !declaration ||
    !declaration.initializer ||
    !ts.isArrayLiteralExpression(declaration.initializer)
  ) {
    throw new Error(
      `Could not find slashCommandDefinitions array in ${fileName}`
    );
  }

  return declaration.initializer.elements.map((element) => {
    const calls = callChain(element);
    const nameCall = calls.find(
      (call) => propertyName(call.expression) === "setName"
    );
    const name = nameCall && stringValue(nameCall.arguments[0]);
    if (!name)
      throw new Error(
        `Found a slash command without a static name in ${fileName}`
      );

    const options = [];
    for (const call of calls) {
      const option = parseOptionBuilder(
        propertyName(call.expression),
        call.arguments[0]
      );
      if (option) options.push(option);
    }

    return { name, options };
  });
}

export function extractAdapterCommandHandlers(
  sourceText,
  fileName = "discord.ts"
) {
  const methodStart = sourceText.indexOf("private async handleSlashCommand");
  if (methodStart === -1) {
    throw new Error(`Could not find handleSlashCommand method in ${fileName}`);
  }
  const bodyStart = sourceText.indexOf("{", methodStart);
  if (bodyStart === -1) {
    throw new Error(`Could not find handleSlashCommand body in ${fileName}`);
  }

  let braceDepth = 0;
  let methodEnd = -1;
  let quote;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    const nextCharacter = sourceText[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        methodEnd = index + 1;
        break;
      }
    }
  }
  if (methodEnd === -1) {
    throw new Error(
      `Could not find end of handleSlashCommand method in ${fileName}`
    );
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    `class ContractSource { ${sourceText.slice(methodStart, methodEnd)} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let handlerMethod;
  visit(sourceFile, (node) => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "handleSlashCommand"
    ) {
      handlerMethod = node;
    }
  });
  if (!handlerMethod?.body) {
    throw new Error(`Could not find handleSlashCommand method in ${fileName}`);
  }

  let commandSwitch;
  visit(handlerMethod.body, (node) => {
    if (
      ts.isSwitchStatement(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "commandName"
    ) {
      commandSwitch = node;
    }
  });
  if (!commandSwitch) {
    throw new Error(
      `Could not find commandName switch in handleSlashCommand in ${fileName}`
    );
  }

  return commandSwitch.caseBlock.clauses.flatMap((clause) => {
    if (!ts.isCaseClause(clause)) return [];
    const name = stringValue(clause.expression);
    if (!name) return [];

    const options = [];
    for (const statement of clause.statements) {
      visit(statement, (node) => {
        if (!ts.isCallExpression(node)) return;
        const getter = propertyName(node.expression);
        const type = optionTypeByGetter.get(getter);
        const receiver = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.expression
          : undefined;
        if (
          !type ||
          !receiver ||
          !ts.isPropertyAccessExpression(receiver) ||
          receiver.name.text !== "options" ||
          !ts.isIdentifier(receiver.expression) ||
          receiver.expression.text !== "interaction"
        ) {
          return;
        }

        const optionName = stringValue(node.arguments[0]);
        if (!optionName) return;
        options.push({
          name: optionName,
          type,
          required: node.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword,
        });
      });
    }

    return [{ name, options }];
  });
}

export function compareCommandContracts(definitions, handlers) {
  const result = { missing: [], stale: [], incompatible: [] };
  const definitionsByName = new Map();
  const handlersByName = new Map();

  for (const definition of definitions) {
    if (definitionsByName.has(definition.name)) {
      result.incompatible.push(
        `Duplicate registered definition for "/${definition.name}".`
      );
    } else {
      definitionsByName.set(definition.name, definition);
    }
  }
  for (const handler of handlers) {
    if (handlersByName.has(handler.name)) {
      result.incompatible.push(
        `Duplicate adapter handler for "/${handler.name}".`
      );
    } else {
      handlersByName.set(handler.name, handler);
    }
  }

  for (const handler of handlersByName.values()) {
    if (!definitionsByName.has(handler.name)) {
      result.missing.push(
        `Adapter handler "/${handler.name}" has no registered command definition.`
      );
      continue;
    }

    const definition = definitionsByName.get(handler.name);
    const definitionOptions = new Map();
    for (const option of definition.options) {
      if (definitionOptions.has(option.name)) {
        result.incompatible.push(
          `/${handler.name} defines option "${option.name}" more than once.`
        );
      } else {
        definitionOptions.set(option.name, option);
      }
    }

    const handlerOptions = new Map();
    for (const option of handler.options) {
      const previous = handlerOptions.get(option.name);
      if (
        previous &&
        (previous.type !== option.type || previous.required !== option.required)
      ) {
        result.incompatible.push(
          `/${handler.name} handler uses option "${option.name}" with inconsistent types or requiredness.`
        );
        continue;
      }
      handlerOptions.set(option.name, option);
    }

    for (const [name, usage] of handlerOptions) {
      const registered = definitionOptions.get(name);
      if (!registered) {
        result.incompatible.push(
          `/${handler.name} handler reads "${name}" (${usage.type}${usage.required ? ", required" : ", optional"}), but it is not registered.`
        );
        continue;
      }
      if (registered.type !== usage.type) {
        result.incompatible.push(
          `/${handler.name} option "${name}" is registered as ${registered.type}, but the adapter reads ${usage.type}.`
        );
      }
      if (registered.required !== usage.required) {
        result.incompatible.push(
          `/${handler.name} option "${name}" is registered ${registered.required ? "required" : "optional"}, but the adapter reads it as ${usage.required ? "required" : "optional"}.`
        );
      }
    }

    for (const name of definitionOptions.keys()) {
      if (!handlerOptions.has(name)) {
        result.incompatible.push(
          `/${handler.name} registers option "${name}", but the adapter does not read it.`
        );
      }
    }
  }

  for (const definition of definitionsByName.values()) {
    if (!handlersByName.has(definition.name)) {
      result.stale.push(
        `Registered command definition "/${definition.name}" has no adapter handler.`
      );
    }
  }

  return result;
}

export function checkCommandContract(definitionsSource, adapterSource) {
  return compareCommandContracts(
    extractCommandDefinitions(definitionsSource),
    extractAdapterCommandHandlers(adapterSource)
  );
}

export function formatCommandContractProblems(problems) {
  const sections = [
    ["missing", "Missing command definitions"],
    ["stale", "Stale command definitions"],
    ["incompatible", "Incompatible command definitions"],
  ];
  return sections
    .filter(([key]) => problems[key].length > 0)
    .map(
      ([key, title]) =>
        `${title}:\n${problems[key].map((problem) => `  - ${problem}`).join("\n")}`
    )
    .join("\n");
}
