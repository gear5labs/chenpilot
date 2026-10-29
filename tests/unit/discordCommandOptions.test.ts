import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  mapDiscordCommandOptions,
  normalizeOptionType,
} from '../../packages/bot/src/discord/commandOptionsMapper';
import {
  ADAPTER_DTO_VERSION,
  CommandOptionValidationError,
} from '../../packages/bot/src/discord/dto/commandOptions.dto';
import {
  nestedSubcommandGroupFixture,
  nestedSubcommandFixture,
  optionalValuesFixture,
  unsupportedTypeFixture,
  unsupportedStringOptionTypeFixture,
  invalidIntegerOptionValueFixture,
  nonIntegerFloatOptionValueFixture,
  malformedSubcommandGroupFixture,
  allSupportedTypesFixture,
  emptyOptionsFixture,
} from '../../packages/bot/src/discord/fixtures/commandInteractionFixtures';
import { DiscordAdapter } from '../../packages/bot/src/discord/DiscordAdapter';

describe('Discord Command Options Mapper & DTO', () => {
  describe('Versioned DTO Contract', () => {
    it('always generates a versioned DTO tagged with ADAPTER_DTO_VERSION (1.0.0)', () => {
      const result = mapDiscordCommandOptions('test_cmd', []);
      expect(result.version).toBe(ADAPTER_DTO_VERSION);
      expect(result.version).toBe('1.0.0');
      expect(result.commandName).toBe('test_cmd');
      expect(result.options).toEqual({});
      expect(result.details).toEqual({});
    });

    it('throws when command name is missing or invalid', () => {
      expect(() => mapDiscordCommandOptions('')).toThrow(CommandOptionValidationError);
      expect(() => mapDiscordCommandOptions('' as string)).toThrow(
        expect.objectContaining({ code: 'MISSING_COMMAND_NAME' })
      );
    });
  });

  describe('Supported Option Types Mapping', () => {
    it('correctly maps all supported primitive and entity option types', () => {
      const dto = mapDiscordCommandOptions(
        allSupportedTypesFixture.commandName,
        allSupportedTypesFixture.options
      );

      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('omnibus');

      // Normalized option values map
      expect(dto.options.text_arg).toBe('stellar_asset');
      expect(dto.options.int_arg).toBe(100);
      expect(dto.options.num_arg).toBe(99.95);
      expect(dto.options.bool_arg).toBe(true);
      expect(dto.options.user_arg).toBe('user-777');
      expect(dto.options.channel_arg).toBe('chan-123');
      expect(dto.options.role_arg).toBe('role-999');
      expect(dto.options.mentionable_arg).toBe('mention-456');
      expect(dto.options.attachment_arg).toEqual({
        id: 'att-1',
        name: 'receipt.pdf',
        url: 'https://cdn.discordapp.com/attachments/1/receipt.pdf',
        contentType: 'application/pdf',
        size: 2048,
      });

      // Strongly-typed details
      expect(dto.details.text_arg.type).toBe('string');
      expect(dto.details.int_arg.type).toBe('integer');
      expect(dto.details.num_arg.type).toBe('number');
      expect(dto.details.bool_arg.type).toBe('boolean');
      expect(dto.details.user_arg.type).toBe('user');
      expect(dto.details.user_arg.resolved?.user?.username).toBe('stellar_dev');
      expect(dto.details.channel_arg.type).toBe('channel');
      expect(dto.details.channel_arg.resolved?.channel?.name).toBe('trading-alerts');
      expect(dto.details.role_arg.type).toBe('role');
      expect(dto.details.role_arg.resolved?.role?.name).toBe('LiquidityProvider');
      expect(dto.details.attachment_arg.type).toBe('attachment');
    });

    it('normalizes string type names correctly', () => {
      expect(normalizeOptionType('STRING', 'test')).toBe('string');
      expect(normalizeOptionType('Integer', 'test')).toBe('integer');
      expect(normalizeOptionType('BOOLEAN', 'test')).toBe('boolean');
      expect(normalizeOptionType('Number', 'test')).toBe('number');
      expect(normalizeOptionType('USER', 'test')).toBe('user');
      expect(normalizeOptionType('Channel', 'test')).toBe('channel');
      expect(normalizeOptionType('ROLE', 'test')).toBe('role');
      expect(normalizeOptionType('mentionable', 'test')).toBe('mentionable');
      expect(normalizeOptionType('ATTACHMENT', 'test')).toBe('attachment');
    });
  });

  describe('Nested Subcommands Fixtures & Mapping', () => {
    it('unboxes direct subcommand and maps its options', () => {
      const dto = mapDiscordCommandOptions(
        nestedSubcommandFixture.commandName,
        nestedSubcommandFixture.options
      );

      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('portfolio');
      expect(dto.subcommand).toBe('view');
      expect(dto.subcommandGroup).toBeUndefined();
      expect(dto.options).toEqual({
        asset: 'USDC',
        limit: 5,
      });
      expect(dto.details.asset.type).toBe('string');
      expect(dto.details.limit.type).toBe('integer');
    });

    it('unboxes nested subcommand group hierarchy and maps leaf options', () => {
      const dto = mapDiscordCommandOptions(
        nestedSubcommandGroupFixture.commandName,
        nestedSubcommandGroupFixture.options
      );

      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('settings');
      expect(dto.subcommandGroup).toBe('alert');
      expect(dto.subcommand).toBe('price');
      expect(dto.options).toEqual({
        asset: 'XLM',
        threshold: 0.15,
        enabled: true,
      });
      expect(dto.details.asset.type).toBe('string');
      expect(dto.details.threshold.type).toBe('number');
      expect(dto.details.enabled.type).toBe('boolean');
    });
  });

  describe('Optional Values Fixtures & Handling', () => {
    it('handles provided, explicit null, and undefined optional values without crashing', () => {
      const dto = mapDiscordCommandOptions(
        optionalValuesFixture.commandName,
        optionalValuesFixture.options
      );

      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('trade');
      expect(dto.options.pair).toBe('XLM/USDC');
      expect(dto.options.slippage).toBeNull();
      expect(dto.options.memo).toBeNull();
      expect(dto.options.tag).toBe(42);

      expect(dto.details.pair.isOptional).toBe(false);
      expect(dto.details.slippage.isOptional).toBe(true);
      expect(dto.details.memo.isOptional).toBe(true);
      expect(dto.details.tag.isOptional).toBe(false);
    });

    it('handles empty options array as valid boundary case', () => {
      const dto = mapDiscordCommandOptions(
        emptyOptionsFixture.commandName,
        emptyOptionsFixture.options
      );

      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('ping');
      expect(dto.options).toEqual({});
      expect(dto.details).toEqual({});
    });

    it('handles null/undefined options parameter gracefully', () => {
      const dto = mapDiscordCommandOptions('status', null);
      expect(dto.version).toBe('1.0.0');
      expect(dto.commandName).toBe('status');
      expect(dto.options).toEqual({});
    });
  });

  describe('Failure and Boundary Cases', () => {
    it('throws UNSUPPORTED_OPTION_TYPE when numeric option type is unsupported', () => {
      expect(() =>
        mapDiscordCommandOptions(
          unsupportedTypeFixture.commandName,
          unsupportedTypeFixture.options
        )
      ).toThrow(CommandOptionValidationError);

      try {
        mapDiscordCommandOptions(
          unsupportedTypeFixture.commandName,
          unsupportedTypeFixture.options
        );
      } catch (err) {
        const error = err as CommandOptionValidationError;
        expect(error.code).toBe('UNSUPPORTED_OPTION_TYPE');
        expect(error.optionName).toBe('quantum_state');
        expect(error.optionType).toBe(99);
      }
    });

    it('throws UNSUPPORTED_OPTION_TYPE when string option type is unrecognized', () => {
      expect(() =>
        mapDiscordCommandOptions(
          unsupportedStringOptionTypeFixture.commandName,
          unsupportedStringOptionTypeFixture.options
        )
      ).toThrow(CommandOptionValidationError);

      try {
        mapDiscordCommandOptions(
          unsupportedStringOptionTypeFixture.commandName,
          unsupportedStringOptionTypeFixture.options
        );
      } catch (err) {
        const error = err as CommandOptionValidationError;
        expect(error.code).toBe('UNSUPPORTED_OPTION_TYPE');
        expect(error.optionName).toBe('tensor_weights');
        expect(error.optionType).toBe('UNKNOWN_FUTURE_TYPE');
      }
    });

    it('throws INVALID_OPTION_VALUE when integer option receives non-numeric string', () => {
      expect(() =>
        mapDiscordCommandOptions(
          invalidIntegerOptionValueFixture.commandName,
          invalidIntegerOptionValueFixture.options
        )
      ).toThrow(CommandOptionValidationError);

      try {
        mapDiscordCommandOptions(
          invalidIntegerOptionValueFixture.commandName,
          invalidIntegerOptionValueFixture.options
        );
      } catch (err) {
        const error = err as CommandOptionValidationError;
        expect(error.code).toBe('INVALID_OPTION_VALUE');
        expect(error.optionName).toBe('amount');
        expect(error.receivedValue).toBe('not_an_integer');
      }
    });

    it('throws INVALID_OPTION_VALUE when integer option receives non-integer float', () => {
      expect(() =>
        mapDiscordCommandOptions(
          nonIntegerFloatOptionValueFixture.commandName,
          nonIntegerFloatOptionValueFixture.options
        )
      ).toThrow(CommandOptionValidationError);

      try {
        mapDiscordCommandOptions(
          nonIntegerFloatOptionValueFixture.commandName,
          nonIntegerFloatOptionValueFixture.options
        );
      } catch (err) {
        const error = err as CommandOptionValidationError;
        expect(error.code).toBe('INVALID_OPTION_VALUE');
        expect(error.optionName).toBe('count');
        expect(error.receivedValue).toBe(12.34);
      }
    });

    it('throws MALFORMED_SUBCOMMAND_STRUCTURE when subcommand group is missing child subcommand', () => {
      expect(() =>
        mapDiscordCommandOptions(
          malformedSubcommandGroupFixture.commandName,
          malformedSubcommandGroupFixture.options
        )
      ).toThrow(CommandOptionValidationError);

      try {
        mapDiscordCommandOptions(
          malformedSubcommandGroupFixture.commandName,
          malformedSubcommandGroupFixture.options
        );
      } catch (err) {
        const error = err as CommandOptionValidationError;
        expect(error.code).toBe('MALFORMED_SUBCOMMAND_STRUCTURE');
        expect(error.optionName).toBe('manage');
      }
    });
  });

  describe('DiscordAdapter Integration with Versioned DTO', () => {
    let adapter: DiscordAdapter;

    beforeEach(() => {
      adapter = new DiscordAdapter({
        token: 'test-token',
        backendUrl: 'http://localhost:8080',
        adminRoleIds: [],
      });
    });

    it('forwards versioned DTO instead of raw discord.js options to backendClient.executeCommand', async () => {
      const backendClient = adapter.getBackendClient();
      const executeCommandSpy = jest
        .spyOn(backendClient, 'executeCommand')
        .mockResolvedValue({ success: true, result: 'ok' } as never);

      const replyFn = jest.fn(async () => undefined);

      const mockInteraction = {
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        commandName: 'portfolio',
        user: { id: 'user-456' },
        guildId: null,
        options: {
          data: nestedSubcommandFixture.options,
        },
        reply: replyFn,
      };

      adapter.getClient().emit('interactionCreate', mockInteraction as never);

      // Allow async handlers to run
      await new Promise((resolve) => setImmediate(resolve));

      expect(executeCommandSpy).toHaveBeenCalledTimes(1);
      const [cmd, forwardedDto, userId] = executeCommandSpy.mock.calls[0];

      expect(cmd).toBe('portfolio');
      expect(userId).toBe('user-456');

      // Crucial: verify that the forwarded object is the versioned DTO, NOT raw interaction.options.data
      expect(forwardedDto).not.toBe(mockInteraction.options.data);
      expect((forwardedDto as Record<string, unknown>).version).toBe('1.0.0');
      expect((forwardedDto as Record<string, unknown>).subcommand).toBe('view');
      expect((forwardedDto as Record<string, unknown>).options).toEqual({
        asset: 'USDC',
        limit: 5,
      });

      expect(replyFn).toHaveBeenCalledWith({
        content: JSON.stringify({ success: true, result: 'ok' }),
        ephemeral: false,
      });
    });

    it('catches validation error on unsupported option type and replies with ephemeral error message', async () => {
      const backendClient = adapter.getBackendClient();
      const executeCommandSpy = jest.spyOn(backendClient, 'executeCommand');
      const replyFn = jest.fn(async () => undefined);

      const mockInteraction = {
        isButton: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isChatInputCommand: () => true,
        commandName: 'custom',
        user: { id: 'user-456' },
        guildId: null,
        options: {
          data: unsupportedTypeFixture.options,
        },
        reply: replyFn,
      };

      adapter.getClient().emit('interactionCreate', mockInteraction as never);

      await new Promise((resolve) => setImmediate(resolve));

      // Backend command should NOT have been called with invalid options
      expect(executeCommandSpy).not.toHaveBeenCalled();

      // Interaction replied with ephemeral error
      expect(replyFn).toHaveBeenCalledTimes(1);
      const replyArg = replyFn.mock.calls[0][0] as { content: string; ephemeral: boolean };
      expect(replyArg.ephemeral).toBe(true);
      expect(replyArg.content).toContain('Invalid command options');
      expect(replyArg.content).toContain('Unsupported option type');
    });
  });
});
