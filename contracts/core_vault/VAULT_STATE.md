# Core vault state and roles

## Auth migration

`complete_auth_migration` is a one-way switch set by the legacy admin.

Before it is set, privileged calls still authorize the stored admin. After it is set, that same admin must hold the UnifiedAuth role for the operation. An admin with no matching role is rejected with `Unauthorized`.

| Operation | Role after migration |
| --- | --- |
| `pause`, `unpause` | EmergencyAdmin |
| `set_backend_status`, `recovery` | VaultAdmin or EmergencyAdmin |
| `propose_upgrade`, `cancel_upgrade` | UpgradeAdmin |
| `apply_upgrade` | none; anyone, after the timelock |

UpgradeAdmin cannot change backend status. VaultAdmin cannot pause or propose an upgrade. EmergencyAdmin can pause, change backend status, and recover a force-exit, and cannot propose an upgrade.

## Control-plane transitions

Repeated or stale commands return a stable `FailureReason` and do not change storage.

| Command | Allowed when | Error otherwise |
| --- | --- | --- |
| Set backend to the other value | not paused, no pending upgrade | `EmergencyMode`, `UpgradeMode`, or `InvalidState` if unchanged |
| Propose upgrade | not paused, no pending upgrade | `EmergencyMode` or `AlreadyExists` |
| Cancel upgrade | upgrade pending | `NoPendingUpgrade` |
| Apply upgrade | upgrade pending and timelock elapsed | `NoPendingUpgrade` or `TimelockNotExpired` |
| Pause | not paused | `InvalidState` |
| Unpause | paused | `InvalidState` |

## Depositor recovery transitions

| State | Deposit | Withdraw | Request exit | Complete exit | Recover |
| --- | --- | --- | --- | --- | --- |
| Idle | deposited, if backend online | `InsufficientBalance` | `InsufficientBalance` | `NoPendingForceExit` | `NoPendingForceExit` |
| Deposited | stays deposited, if backend online | allowed if backend online | exit pending, if backend offline | `NoPendingForceExit` | `NoPendingForceExit` |
| Exit pending | `InvalidState` | `InvalidState` | `ForceExitAlreadyPending` | idle, after the challenge period | deposited, if the deposit still matches the request |

Deposit or withdrawal while a force-exit is pending is rejected so recovery cannot observe a mismatched balance. A second recovery, or a completion after recovery, returns `NoPendingForceExit`. A pending request whose deposit no longer matches returns `DepositForceExitMismatch`. Backend-offline deposit or withdrawal returns `BackendOffline`. Requesting an exit while the backend is online returns `BackendOnline`. Completing an exit before the challenge period returns `ChallengePeriodNotElapsed`.
