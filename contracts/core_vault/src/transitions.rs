//! Allowed vault and per-user recovery transitions.
//!
//! Repeated, stale, and out-of-order operations return a stable
//! [`FailureReason`] instead of mutating storage. The contract entry points
//! call these functions so the table below is the behavior, not a comment.

use contract_failure::FailureReason;

/// Control-plane flags that gate privileged and user operations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultControl {
    pub backend_online: bool,
    pub upgrade_pending: bool,
    pub paused: bool,
    pub timelock_expired: bool,
}

/// Privileged or lifecycle command applied to [`VaultControl`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultCommand {
    SetBackend { online: bool },
    ProposeUpgrade,
    CancelUpgrade,
    ApplyUpgrade,
    Pause,
    Unpause,
}

/// Where a single depositor sits in the force-exit / recovery flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionState {
    /// No deposit and no force-exit request.
    Idle,
    /// Deposit is recorded and no force-exit is pending.
    Deposited,
    /// Force-exit requested; deposit must stay unchanged until recovery or completion.
    ExitPending,
}

/// User or admin operation on a depositor position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionOp {
    Deposit,
    Withdraw,
    RequestExit,
    CompleteExit,
    Recover,
}

/// Apply one control-plane command. `Err` is the contract error to return.
pub fn transit_control(
    state: VaultControl,
    command: VaultCommand,
) -> Result<VaultControl, FailureReason> {
    match command {
        VaultCommand::SetBackend { online } => {
            if state.paused {
                return Err(FailureReason::EmergencyMode);
            }
            if state.upgrade_pending {
                return Err(FailureReason::UpgradeMode);
            }
            if state.backend_online == online {
                return Err(FailureReason::InvalidState);
            }
            Ok(VaultControl {
                backend_online: online,
                ..state
            })
        }
        VaultCommand::ProposeUpgrade => {
            if state.paused {
                return Err(FailureReason::EmergencyMode);
            }
            if state.upgrade_pending {
                return Err(FailureReason::AlreadyExists);
            }
            Ok(VaultControl {
                upgrade_pending: true,
                timelock_expired: false,
                ..state
            })
        }
        VaultCommand::CancelUpgrade => {
            if !state.upgrade_pending {
                return Err(FailureReason::NoPendingUpgrade);
            }
            Ok(VaultControl {
                upgrade_pending: false,
                timelock_expired: false,
                ..state
            })
        }
        VaultCommand::ApplyUpgrade => {
            if !state.upgrade_pending {
                return Err(FailureReason::NoPendingUpgrade);
            }
            if !state.timelock_expired {
                return Err(FailureReason::TimelockNotExpired);
            }
            Ok(VaultControl {
                upgrade_pending: false,
                timelock_expired: false,
                ..state
            })
        }
        VaultCommand::Pause => {
            if state.paused {
                return Err(FailureReason::InvalidState);
            }
            Ok(VaultControl {
                paused: true,
                ..state
            })
        }
        VaultCommand::Unpause => {
            if !state.paused {
                return Err(FailureReason::InvalidState);
            }
            Ok(VaultControl {
                paused: false,
                ..state
            })
        }
    }
}

/// Apply one depositor operation.
///
/// `deposit_matches_exit` is meaningful only for [`PositionOp::Recover`].
/// `challenge_elapsed` is meaningful only for [`PositionOp::CompleteExit`].
pub fn transit_position(
    state: PositionState,
    op: PositionOp,
    backend_online: bool,
    challenge_elapsed: bool,
    deposit_matches_exit: bool,
) -> Result<PositionState, FailureReason> {
    match op {
        PositionOp::Deposit => {
            if !backend_online {
                return Err(FailureReason::BackendOffline);
            }
            if state == PositionState::ExitPending {
                return Err(FailureReason::InvalidState);
            }
            Ok(PositionState::Deposited)
        }
        PositionOp::Withdraw => {
            if !backend_online {
                return Err(FailureReason::BackendOffline);
            }
            if state == PositionState::ExitPending {
                return Err(FailureReason::InvalidState);
            }
            if state == PositionState::Idle {
                return Err(FailureReason::InsufficientBalance);
            }
            Ok(PositionState::Deposited)
        }
        PositionOp::RequestExit => {
            if backend_online {
                return Err(FailureReason::BackendOnline);
            }
            if state == PositionState::ExitPending {
                return Err(FailureReason::ForceExitAlreadyPending);
            }
            if state == PositionState::Idle {
                return Err(FailureReason::InsufficientBalance);
            }
            Ok(PositionState::ExitPending)
        }
        PositionOp::CompleteExit => {
            if state != PositionState::ExitPending {
                return Err(FailureReason::NoPendingForceExit);
            }
            if !challenge_elapsed {
                return Err(FailureReason::ChallengePeriodNotElapsed);
            }
            Ok(PositionState::Idle)
        }
        PositionOp::Recover => {
            if state != PositionState::ExitPending {
                return Err(FailureReason::NoPendingForceExit);
            }
            if !deposit_matches_exit {
                return Err(FailureReason::DepositForceExitMismatch);
            }
            Ok(PositionState::Deposited)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn control(online: bool, upgrade: bool, paused: bool, expired: bool) -> VaultControl {
        VaultControl {
            backend_online: online,
            upgrade_pending: upgrade,
            paused,
            timelock_expired: expired,
        }
    }

    #[test]
    fn control_transitions_accept_each_valid_edge_and_reject_the_rest() {
        let cases: &[(VaultControl, VaultCommand, Result<bool, FailureReason>)] = &[
            (
                control(true, false, false, false),
                VaultCommand::SetBackend { online: false },
                Ok(false),
            ),
            (
                control(false, false, false, false),
                VaultCommand::SetBackend { online: true },
                Ok(true),
            ),
            (
                control(true, false, false, false),
                VaultCommand::SetBackend { online: true },
                Err(FailureReason::InvalidState),
            ),
            (
                control(false, false, false, false),
                VaultCommand::SetBackend { online: false },
                Err(FailureReason::InvalidState),
            ),
            (
                control(true, false, true, false),
                VaultCommand::SetBackend { online: false },
                Err(FailureReason::EmergencyMode),
            ),
            (
                control(true, true, false, false),
                VaultCommand::SetBackend { online: false },
                Err(FailureReason::UpgradeMode),
            ),
            (
                control(true, false, false, false),
                VaultCommand::ProposeUpgrade,
                Ok(true),
            ),
            (
                control(false, false, false, false),
                VaultCommand::ProposeUpgrade,
                Ok(true),
            ),
            (
                control(true, true, false, false),
                VaultCommand::ProposeUpgrade,
                Err(FailureReason::AlreadyExists),
            ),
            (
                control(true, false, true, false),
                VaultCommand::ProposeUpgrade,
                Err(FailureReason::EmergencyMode),
            ),
            (
                control(true, true, false, false),
                VaultCommand::CancelUpgrade,
                Ok(false),
            ),
            (
                control(true, false, false, false),
                VaultCommand::CancelUpgrade,
                Err(FailureReason::NoPendingUpgrade),
            ),
            (
                control(true, true, false, true),
                VaultCommand::ApplyUpgrade,
                Ok(false),
            ),
            (
                control(true, true, false, false),
                VaultCommand::ApplyUpgrade,
                Err(FailureReason::TimelockNotExpired),
            ),
            (
                control(true, false, false, true),
                VaultCommand::ApplyUpgrade,
                Err(FailureReason::NoPendingUpgrade),
            ),
            (
                control(true, false, false, false),
                VaultCommand::Pause,
                Ok(true),
            ),
            (
                control(true, false, true, false),
                VaultCommand::Pause,
                Err(FailureReason::InvalidState),
            ),
            (
                control(true, false, true, false),
                VaultCommand::Unpause,
                Ok(false),
            ),
            (
                control(true, false, false, false),
                VaultCommand::Unpause,
                Err(FailureReason::InvalidState),
            ),
        ];

        for (state, command, expected) in cases {
            let got = transit_control(*state, *command);
            match expected {
                Ok(online_or_flag) => {
                    let next = got.expect("valid transition");
                    match command {
                        VaultCommand::SetBackend { .. } => {
                            assert_eq!(next.backend_online, *online_or_flag);
                        }
                        VaultCommand::ProposeUpgrade => assert!(next.upgrade_pending),
                        VaultCommand::CancelUpgrade | VaultCommand::ApplyUpgrade => {
                            assert!(!next.upgrade_pending);
                        }
                        VaultCommand::Pause => assert!(next.paused),
                        VaultCommand::Unpause => assert!(!next.paused),
                    }
                }
                Err(reason) => assert_eq!(got, Err(*reason)),
            }
        }
    }

    #[test]
    fn position_transitions_cover_recovery_and_stale_operations() {
        let cases: &[(
            PositionState,
            PositionOp,
            bool,
            bool,
            bool,
            Result<PositionState, FailureReason>,
        )] = &[
            (
                PositionState::Idle,
                PositionOp::Deposit,
                true,
                false,
                true,
                Ok(PositionState::Deposited),
            ),
            (
                PositionState::Deposited,
                PositionOp::Deposit,
                true,
                false,
                true,
                Ok(PositionState::Deposited),
            ),
            (
                PositionState::Idle,
                PositionOp::Deposit,
                false,
                false,
                true,
                Err(FailureReason::BackendOffline),
            ),
            (
                PositionState::ExitPending,
                PositionOp::Deposit,
                true,
                false,
                true,
                Err(FailureReason::InvalidState),
            ),
            (
                PositionState::Deposited,
                PositionOp::Withdraw,
                true,
                false,
                true,
                Ok(PositionState::Deposited),
            ),
            (
                PositionState::Idle,
                PositionOp::Withdraw,
                true,
                false,
                true,
                Err(FailureReason::InsufficientBalance),
            ),
            (
                PositionState::Deposited,
                PositionOp::Withdraw,
                false,
                false,
                true,
                Err(FailureReason::BackendOffline),
            ),
            (
                PositionState::ExitPending,
                PositionOp::Withdraw,
                true,
                false,
                true,
                Err(FailureReason::InvalidState),
            ),
            (
                PositionState::Deposited,
                PositionOp::RequestExit,
                false,
                false,
                true,
                Ok(PositionState::ExitPending),
            ),
            (
                PositionState::Deposited,
                PositionOp::RequestExit,
                true,
                false,
                true,
                Err(FailureReason::BackendOnline),
            ),
            (
                PositionState::ExitPending,
                PositionOp::RequestExit,
                false,
                false,
                true,
                Err(FailureReason::ForceExitAlreadyPending),
            ),
            (
                PositionState::Idle,
                PositionOp::RequestExit,
                false,
                false,
                true,
                Err(FailureReason::InsufficientBalance),
            ),
            (
                PositionState::ExitPending,
                PositionOp::CompleteExit,
                false,
                true,
                true,
                Ok(PositionState::Idle),
            ),
            (
                PositionState::ExitPending,
                PositionOp::CompleteExit,
                false,
                false,
                true,
                Err(FailureReason::ChallengePeriodNotElapsed),
            ),
            (
                PositionState::Idle,
                PositionOp::CompleteExit,
                false,
                true,
                true,
                Err(FailureReason::NoPendingForceExit),
            ),
            (
                PositionState::Deposited,
                PositionOp::CompleteExit,
                false,
                true,
                true,
                Err(FailureReason::NoPendingForceExit),
            ),
            (
                PositionState::ExitPending,
                PositionOp::Recover,
                false,
                false,
                true,
                Ok(PositionState::Deposited),
            ),
            (
                PositionState::ExitPending,
                PositionOp::Recover,
                true,
                false,
                false,
                Err(FailureReason::DepositForceExitMismatch),
            ),
            (
                PositionState::Idle,
                PositionOp::Recover,
                false,
                false,
                true,
                Err(FailureReason::NoPendingForceExit),
            ),
            (
                PositionState::Deposited,
                PositionOp::Recover,
                false,
                false,
                true,
                Err(FailureReason::NoPendingForceExit),
            ),
        ];

        for (state, op, online, elapsed, matches, expected) in cases {
            assert_eq!(
                transit_position(*state, *op, *online, *elapsed, *matches),
                *expected
            );
        }
    }
}
