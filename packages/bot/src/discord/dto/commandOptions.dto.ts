/**
 * Discord Command Options DTO
 * Versioned, platform-neutral data transfer object for Discord command interactions.
 */

export const ADAPTER_DTO_VERSION = '1.0.0' as const;
export type AdapterDtoVersion = typeof ADAPTER_DTO_VERSION;

/**
 * Normalized option types supported by the adapter.
 */
export type SupportedOptionType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'user'
  | 'channel'
  | 'role'
  | 'mentionable'
  | 'attachment';

/**
 * Validated details for a resolved user option.
 */
export interface ResolvedUserDto {
  id: string;
  username?: string;
  globalName?: string;
  bot?: boolean;
}

/**
 * Validated details for a resolved channel option.
 */
export interface ResolvedChannelDto {
  id: string;
  name?: string;
  type?: number | string;
}

/**
 * Validated details for a resolved role option.
 */
export interface ResolvedRoleDto {
  id: string;
  name?: string;
}

/**
 * Validated details for an attachment option.
 */
export interface ResolvedAttachmentDto {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  size: number;
}

/**
 * Container for resolved Discord entity details.
 */
export interface ResolvedEntitiesDto {
  user?: ResolvedUserDto;
  channel?: ResolvedChannelDto;
  role?: ResolvedRoleDto;
  attachment?: ResolvedAttachmentDto;
}

/**
 * Validated option metadata entry.
 */
export interface ValidatedOptionDto {
  name: string;
  type: SupportedOptionType;
  value: unknown;
  isOptional?: boolean;
  resolved?: ResolvedEntitiesDto;
}

/**
 * Versioned command options DTO forwarded from adapter to backend commands.
 */
export interface DiscordCommandDto {
  readonly version: AdapterDtoVersion;
  readonly commandName: string;
  readonly subcommandGroup?: string;
  readonly subcommand?: string;
  /**
   * Normalized key-value map of option names to resolved JavaScript primitives/objects.
   * e.g. { asset: 'XLM', limit: 10, verbose: true }
   */
  readonly options: Record<string, unknown>;
  /**
   * Complete typed metadata for each option.
   */
  readonly details: Record<string, ValidatedOptionDto>;
}

/**
 * Validation error codes for command options.
 */
export type CommandOptionValidationErrorCode =
  | 'UNSUPPORTED_OPTION_TYPE'
  | 'INVALID_OPTION_VALUE'
  | 'MALFORMED_SUBCOMMAND_STRUCTURE'
  | 'MISSING_COMMAND_NAME';

/**
 * Specific error thrown when command interaction options fail validation.
 */
export class CommandOptionValidationError extends Error {
  readonly code: CommandOptionValidationErrorCode;
  readonly optionName?: string;
  readonly optionType?: unknown;
  readonly receivedValue?: unknown;

  constructor(params: {
    message: string;
    code: CommandOptionValidationErrorCode;
    optionName?: string;
    optionType?: unknown;
    receivedValue?: unknown;
  }) {
    super(params.message);
    this.name = 'CommandOptionValidationError';
    this.code = params.code;
    this.optionName = params.optionName;
    this.optionType = params.optionType;
    this.receivedValue = params.receivedValue;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
