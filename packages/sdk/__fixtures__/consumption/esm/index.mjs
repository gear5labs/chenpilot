// ESM consumer fixture for the packed package (#1050)
// Exercises the public API through the package entry point.
import * as sdk from '@chen-pilot/sdk-core';

if (typeof sdk.canonicalize !== 'function') {
  throw new Error('canonicalize missing');
}
if (typeof sdk.ErrorRegistry === 'undefined') {
  throw new Error('ErrorRegistry missing');
}
if (typeof sdk.isAbortError !== 'function') {
  throw new Error('isAbortError missing');
}
if (typeof sdk.mapBackendError !== 'function') {
  throw new Error('mapBackendError missing');
}
if (typeof sdk.AgentClient !== 'function') {
  throw new Error('AgentClient missing');
}
export const ok = true;
