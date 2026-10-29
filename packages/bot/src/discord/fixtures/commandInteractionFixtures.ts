/**
 * Command Interaction Options Fixtures
 * Fixtures for nested subcommands, optional values, unsupported types, and boundary cases.
 */

import { RawDiscordOption } from '../commandOptionsMapper';

/**
 * Fixture: SubcommandGroup containing a nested Subcommand and leaf options.
 * Matches: `/settings alert price asset:XLM threshold:0.15 enabled:true`
 */
export const nestedSubcommandGroupFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'settings',
  options: [
    {
      name: 'alert',
      type: 2, // ApplicationCommandOptionType.SubcommandGroup
      options: [
        {
          name: 'price',
          type: 1, // ApplicationCommandOptionType.Subcommand
          options: [
            {
              name: 'asset',
              type: 3, // String
              value: 'XLM',
            },
            {
              name: 'threshold',
              type: 10, // Number
              value: 0.15,
            },
            {
              name: 'enabled',
              type: 5, // Boolean
              value: true,
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture: Direct Subcommand containing options.
 * Matches: `/portfolio view asset:USDC limit:5`
 */
export const nestedSubcommandFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'portfolio',
  options: [
    {
      name: 'view',
      type: 1, // ApplicationCommandOptionType.Subcommand
      options: [
        {
          name: 'asset',
          type: 3, // String
          value: 'USDC',
        },
        {
          name: 'limit',
          type: 4, // Integer
          value: 5,
        },
      ],
    },
  ],
};

/**
 * Fixture: Command options with optional values.
 * Contains:
 * - 'pair': required string provided
 * - 'slippage': optional number with explicit null
 * - 'memo': optional string with undefined value
 * - 'tag': optional integer provided
 */
export const optionalValuesFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'trade',
  options: [
    {
      name: 'pair',
      type: 3, // String
      value: 'XLM/USDC',
    },
    {
      name: 'slippage',
      type: 10, // Number
      value: null,
    },
    {
      name: 'memo',
      type: 3, // String
      value: undefined,
    },
    {
      name: 'tag',
      type: 4, // Integer
      value: 42,
    },
  ],
};

/**
 * Fixture: Unsupported option type (numeric type 99).
 */
export const unsupportedTypeFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'custom',
  options: [
    {
      name: 'quantum_state',
      type: 99, // Unknown / unsupported type ID
      value: 'superposition',
    },
  ],
};

/**
 * Fixture: Unsupported option type (unrecognized string name).
 */
export const unsupportedStringOptionTypeFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'analytics',
  options: [
    {
      name: 'tensor_weights',
      type: 'UNKNOWN_FUTURE_TYPE',
      value: 'blob_data',
    },
  ],
};

/**
 * Fixture: Invalid option value (type mismatch - expected Integer but received string).
 */
export const invalidIntegerOptionValueFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'transfer',
  options: [
    {
      name: 'amount',
      type: 4, // Integer
      value: 'not_an_integer',
    },
  ],
};

/**
 * Fixture: Invalid option value (type mismatch - expected Integer but received float).
 */
export const nonIntegerFloatOptionValueFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'transfer',
  options: [
    {
      name: 'count',
      type: 4, // Integer
      value: 12.34,
    },
  ],
};

/**
 * Fixture: Malformed subcommand group with no child subcommand.
 */
export const malformedSubcommandGroupFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'admin',
  options: [
    {
      name: 'manage',
      type: 2, // SubcommandGroup
      options: [], // Missing child subcommand
    },
  ],
};

/**
 * Fixture: Flat command with all supported option types.
 */
export const allSupportedTypesFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'omnibus',
  options: [
    {
      name: 'text_arg',
      type: 3,
      value: 'stellar_asset',
    },
    {
      name: 'int_arg',
      type: 4,
      value: 100,
    },
    {
      name: 'num_arg',
      type: 10,
      value: 99.95,
    },
    {
      name: 'bool_arg',
      type: 5,
      value: true,
    },
    {
      name: 'user_arg',
      type: 6,
      value: 'user-777',
      user: {
        id: 'user-777',
        username: 'stellar_dev',
        bot: false,
      },
    },
    {
      name: 'channel_arg',
      type: 7,
      value: 'chan-123',
      channel: {
        id: 'chan-123',
        name: 'trading-alerts',
        type: 0,
      },
    },
    {
      name: 'role_arg',
      type: 8,
      value: 'role-999',
      role: {
        id: 'role-999',
        name: 'LiquidityProvider',
      },
    },
    {
      name: 'mentionable_arg',
      type: 9,
      value: 'mention-456',
    },
    {
      name: 'attachment_arg',
      type: 11,
      attachment: {
        id: 'att-1',
        name: 'receipt.pdf',
        url: 'https://cdn.discordapp.com/attachments/1/receipt.pdf',
        contentType: 'application/pdf',
        size: 2048,
      },
    },
  ],
};

/**
 * Fixture: Empty command options.
 */
export const emptyOptionsFixture: {
  commandName: string;
  options: RawDiscordOption[];
} = {
  commandName: 'ping',
  options: [],
};
