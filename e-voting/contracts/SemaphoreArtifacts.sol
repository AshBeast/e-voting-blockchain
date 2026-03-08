// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/Semaphore.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";

/// @dev Local wrappers so Hardhat emits deployable artifacts for UI usage.
contract LocalSemaphoreVerifier is SemaphoreVerifier {}

/// @dev Deploy this with a LocalSemaphoreVerifier address.
contract LocalSemaphore is Semaphore {
    constructor(
        ISemaphoreVerifier verifier
    ) Semaphore(verifier) {}
}
