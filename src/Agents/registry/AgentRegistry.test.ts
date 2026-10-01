// src/Agents/registry/__tests__/AgentRegistry.test.ts

import { resolvePinnedTool, PinnedToolUnavailableError } from '../AgentRegistry';

describe('Pinned Tool Version Recovery (#810)', () => {
  const availableVersions = ['1.0.0', '1.1.0', '2.0.0'];

  it('successfully resolves when pinned tool version exists', () => {
    const version = resolvePinnedTool('data-parser', '1.1.0', availableVersions);
    expect(version).toBe('1.1.0');
  });

  it('throws structured PinnedToolUnavailableError when paused workflow references removed version', () => {
    expect(() => {
      resolvePinnedTool('data-parser', '0.9.0', availableVersions);
    }).toThrow(PinnedToolUnavailableError);
  });
});