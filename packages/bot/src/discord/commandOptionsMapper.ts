/**
 * Discord Command Options Mapper
 * Converts raw Discord interaction option arrays into a validated, versioned adapter DTO.
 */

import {
  ADAPTER_DTO_VERSION,
  DiscordCommandDto,
  SupportedOptionType,
  ValidatedOptionDto,
  CommandOptionValidationError,
  ResolvedEntitiesDto,
} from './dto/commandOptions.dto';

/**
 * Raw Discord option structure matching discord.js CommandInteractionOption.
 */
export interface RawDiscordOption {
  name: string;
  type: number | string;
  value?: unknown;
  options?: RawDiscordOption[];
  user?: {
    id: string;
    username?: string;
    globalName?: string;
    bot?: boolean;
  };
  channel?: {
    id: string;
    name?: string;
    type?: number | string;
  };
  role?: {
    id: string;
    name?: string;
  };
  attachment?: {
    id: string;
    name: string;
    url: string;
    contentType?: string;
    size: number;
  };
}

/**
 * Normalizes Discord's ApplicationCommandOptionType numeric enum or string name into SupportedOptionType.
 * Throws CommandOptionValidationError if the type is unknown or unsupported.
 */
export function normalizeOptionType(
  rawType: number | string,
  optionName: string
): SupportedOptionType {
  if (typeof rawType === 'number') {
    switch (rawType) {
      case 3:
        return 'string';
      case 4:
        return 'integer';
      case 5:
        return 'boolean';
      case 6:
        return 'user';
      case 7:
        return 'channel';
      case 8:
        return 'role';
      case 9:
        return 'mentionable';
      case 10:
        return 'number';
      case 11:
        return 'attachment';
      default:
        throw new CommandOptionValidationError({
          message: `Unsupported option type ${rawType} for option '${optionName}'`,
          code: 'UNSUPPORTED_OPTION_TYPE',
          optionName,
          optionType: rawType,
        });
    }
  }

  const normalized = String(rawType).toLowerCase().replace(/_/g, '');
  switch (normalized) {
    case 'string':
      return 'string';
    case 'integer':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'user':
      return 'user';
    case 'channel':
      return 'channel';
    case 'role':
      return 'role';
    case 'mentionable':
      return 'mentionable';
    case 'number':
      return 'number';
    case 'attachment':
      return 'attachment';
    default:
      throw new CommandOptionValidationError({
        message: `Unsupported option type '${rawType}' for option '${optionName}'`,
        code: 'UNSUPPORTED_OPTION_TYPE',
        optionName,
        optionType: rawType,
      });
  }
}

/**
 * Validates and extracts a single leaf option's value and resolved metadata.
 */
function mapLeafOption(rawOption: RawDiscordOption): ValidatedOptionDto {
  const { name, type: rawType, value: rawValue } = rawOption;

  if (!name || typeof name !== 'string') {
    throw new CommandOptionValidationError({
      message: 'Option missing valid name',
      code: 'INVALID_OPTION_VALUE',
      optionName: name,
    });
  }

  const type = normalizeOptionType(rawType, name);
  const hasEntityPayload = Boolean(
    rawOption.attachment || rawOption.user || rawOption.channel || rawOption.role
  );
  const isOptional = (rawValue === undefined || rawValue === null) && !hasEntityPayload;

  // Handle optional / omitted values
  if (isOptional) {
    return {
      name,
      type,
      value: null,
      isOptional: true,
    };
  }

  const resolved: ResolvedEntitiesDto = {};

  switch (type) {
    case 'string': {
      if (typeof rawValue !== 'string') {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected string, received ${typeof rawValue}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      return { name, type, value: rawValue, isOptional: false };
    }

    case 'integer': {
      if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected integer number, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      return { name, type, value: rawValue, isOptional: false };
    }

    case 'number': {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected finite number, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      return { name, type, value: rawValue, isOptional: false };
    }

    case 'boolean': {
      if (typeof rawValue !== 'boolean') {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected boolean, received ${typeof rawValue}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      return { name, type, value: rawValue, isOptional: false };
    }

    case 'user': {
      const userId = rawOption.user?.id ?? (typeof rawValue === 'string' ? rawValue : undefined);
      if (!userId) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected valid user reference, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      if (rawOption.user) {
        resolved.user = {
          id: rawOption.user.id,
          username: rawOption.user.username,
          globalName: rawOption.user.globalName,
          bot: rawOption.user.bot,
        };
      }
      return { name, type, value: userId, isOptional: false, resolved };
    }

    case 'channel': {
      const channelId = rawOption.channel?.id ?? (typeof rawValue === 'string' ? rawValue : undefined);
      if (!channelId) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected valid channel reference, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      if (rawOption.channel) {
        resolved.channel = {
          id: rawOption.channel.id,
          name: rawOption.channel.name,
          type: rawOption.channel.type,
        };
      }
      return { name, type, value: channelId, isOptional: false, resolved };
    }

    case 'role': {
      const roleId = rawOption.role?.id ?? (typeof rawValue === 'string' ? rawValue : undefined);
      if (!roleId) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected valid role reference, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      if (rawOption.role) {
        resolved.role = {
          id: rawOption.role.id,
          name: rawOption.role.name,
        };
      }
      return { name, type, value: roleId, isOptional: false, resolved };
    }

    case 'mentionable': {
      const mentionableId =
        rawOption.user?.id ??
        rawOption.role?.id ??
        (typeof rawValue === 'string' ? rawValue : undefined);
      if (!mentionableId) {
        throw new CommandOptionValidationError({
          message: `Option '${name}' expected mentionable ID, received ${JSON.stringify(rawValue)}`,
          code: 'INVALID_OPTION_VALUE',
          optionName: name,
          optionType: type,
          receivedValue: rawValue,
        });
      }
      return { name, type, value: mentionableId, isOptional: false };
    }

    case 'attachment': {
      if (rawOption.attachment) {
        resolved.attachment = {
          id: rawOption.attachment.id,
          name: rawOption.attachment.name,
          url: rawOption.attachment.url,
          contentType: rawOption.attachment.contentType,
          size: rawOption.attachment.size,
        };
        return {
          name,
          type,
          value: resolved.attachment,
          isOptional: false,
          resolved,
        };
      }
      if (typeof rawValue === 'string' || typeof rawValue === 'object') {
        return { name, type, value: rawValue, isOptional: false };
      }
      throw new CommandOptionValidationError({
        message: `Option '${name}' expected attachment object or ID, received ${JSON.stringify(rawValue)}`,
        code: 'INVALID_OPTION_VALUE',
        optionName: name,
        optionType: type,
        receivedValue: rawValue,
      });
    }

    default:
      throw new CommandOptionValidationError({
        message: `Unsupported option type ${type} for option '${name}'`,
        code: 'UNSUPPORTED_OPTION_TYPE',
        optionName: name,
        optionType: type,
      });
  }
}

/**
 * Checks whether an option type corresponds to Subcommand (1) or SubcommandGroup (2).
 */
function isSubcommandType(type: number | string): boolean {
  if (type === 1 || type === 2) return true;
  if (typeof type === 'string') {
    const lower = type.toLowerCase().replace(/_/g, '');
    return lower === 'subcommand' || lower === 'subcommandgroup';
  }
  return false;
}

function isSubcommandGroupType(type: number | string): boolean {
  if (type === 2) return true;
  if (typeof type === 'string') {
    const lower = type.toLowerCase().replace(/_/g, '');
    return lower === 'subcommandgroup';
  }
  return false;
}

/**
 * Maps raw Discord command interaction options into a versioned, validated DTO.
 *
 * @param commandName Name of the invoked command
 * @param rawOptions  Array of CommandInteractionOption from interaction.options.data
 * @returns Validated, platform-neutral DiscordCommandDto
 */
export function mapDiscordCommandOptions(
  commandName: string,
  rawOptions?: readonly RawDiscordOption[] | null
): DiscordCommandDto {
  if (!commandName || typeof commandName !== 'string') {
    throw new CommandOptionValidationError({
      message: 'Command name is required',
      code: 'MISSING_COMMAND_NAME',
    });
  }

  let subcommandGroup: string | undefined;
  let subcommand: string | undefined;
  let leafOptions: readonly RawDiscordOption[] = rawOptions ?? [];

  // Check for nested subcommands / subcommand groups
  if (leafOptions.length === 1 && isSubcommandType(leafOptions[0].type)) {
    const firstOption = leafOptions[0];

    if (isSubcommandGroupType(firstOption.type)) {
      subcommandGroup = firstOption.name;
      const groupChildren = firstOption.options ?? [];
      if (groupChildren.length === 0 || !isSubcommandType(groupChildren[0].type)) {
        throw new CommandOptionValidationError({
          message: `Subcommand group '${subcommandGroup}' must contain a valid subcommand`,
          code: 'MALFORMED_SUBCOMMAND_STRUCTURE',
          optionName: subcommandGroup,
        });
      }
      const subcommandOption = groupChildren[0];
      subcommand = subcommandOption.name;
      leafOptions = subcommandOption.options ?? [];
    } else {
      subcommand = firstOption.name;
      leafOptions = firstOption.options ?? [];
    }
  }

  const options: Record<string, unknown> = {};
  const details: Record<string, ValidatedOptionDto> = {};

  for (const rawOpt of leafOptions) {
    const validated = mapLeafOption(rawOpt);
    details[validated.name] = validated;
    options[validated.name] = validated.value;
  }

  return {
    version: ADAPTER_DTO_VERSION,
    commandName,
    subcommandGroup,
    subcommand,
    options,
    details,
  };
}
