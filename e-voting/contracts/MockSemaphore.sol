// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";

/// @dev Test-only mock to exercise Voting.sol flows without generating real zk proofs.
contract MockSemaphore is ISemaphore, ISemaphoreGroups {
    struct GroupState {
        address admin;
        address pendingAdmin;
        uint256 merkleTreeDuration;
        uint256 root;
        uint256 depth;
        uint256 size;
        mapping(uint256 => bool) memberExists;
        mapping(uint256 => uint256) memberIndex;
        mapping(uint256 => bool) nullifierUsed;
    }

    mapping(uint256 => GroupState) private _groups;
    mapping(uint256 => uint256[]) private _members;

    uint256 public override groupCounter;

    modifier onlyExistingGroup(uint256 groupId) {
        if (_groups[groupId].admin == address(0)) {
            revert Semaphore__GroupDoesNotExist();
        }
        _;
    }

    modifier onlyGroupAdmin(uint256 groupId) {
        if (_groups[groupId].admin != msg.sender) {
            revert Semaphore__CallerIsNotTheGroupAdmin();
        }
        _;
    }

    function _computeRoot(uint256 groupId) private view returns (uint256) {
        return uint256(keccak256(abi.encode(_members[groupId])));
    }

    function _computeDepth(uint256 size) private pure returns (uint256) {
        if (size <= 1) return 1;
        uint256 d = 0;
        uint256 n = size;
        while (n > 1) {
            n = (n + 1) / 2;
            d++;
        }
        return d;
    }

    function createGroup() external override returns (uint256 groupId) {
        return createGroup(msg.sender);
    }

    function createGroup(address admin) public override returns (uint256 groupId) {
        groupId = groupCounter++;
        GroupState storage g = _groups[groupId];
        g.admin = admin;
        g.merkleTreeDuration = 1 hours;
        g.depth = 1;
        emit GroupCreated(groupId);
    }

    function createGroup(
        address admin,
        uint256 merkleTreeDuration
    ) external override returns (uint256 groupId) {
        groupId = createGroup(admin);
        _groups[groupId].merkleTreeDuration = merkleTreeDuration;
    }

    function updateGroupAdmin(
        uint256 groupId,
        address newAdmin
    ) external override onlyGroupAdmin(groupId) {
        GroupState storage g = _groups[groupId];
        g.pendingAdmin = newAdmin;
        emit GroupAdminPending(groupId, g.admin, newAdmin);
    }

    function acceptGroupAdmin(uint256 groupId) external override onlyExistingGroup(groupId) {
        GroupState storage g = _groups[groupId];
        if (g.pendingAdmin != msg.sender) {
            revert Semaphore__CallerIsNotThePendingGroupAdmin();
        }

        address oldAdmin = g.admin;
        g.admin = g.pendingAdmin;
        g.pendingAdmin = address(0);
        emit GroupAdminUpdated(groupId, oldAdmin, g.admin);
    }

    function updateGroupMerkleTreeDuration(
        uint256 groupId,
        uint256 newMerkleTreeDuration
    ) external override onlyGroupAdmin(groupId) {
        GroupState storage g = _groups[groupId];
        uint256 oldDuration = g.merkleTreeDuration;
        g.merkleTreeDuration = newMerkleTreeDuration;
        emit GroupMerkleTreeDurationUpdated(groupId, oldDuration, newMerkleTreeDuration);
    }

    function addMember(
        uint256 groupId,
        uint256 identityCommitment
    ) public override onlyGroupAdmin(groupId) {
        GroupState storage g = _groups[groupId];
        if (!g.memberExists[identityCommitment]) {
            g.memberExists[identityCommitment] = true;
            g.memberIndex[identityCommitment] = _members[groupId].length;
            _members[groupId].push(identityCommitment);
            g.size = _members[groupId].length;
            g.depth = _computeDepth(g.size);
            g.root = _computeRoot(groupId);
            emit MemberAdded(groupId, g.size - 1, identityCommitment, g.root);
        }
    }

    function addMembers(
        uint256 groupId,
        uint256[] calldata identityCommitments
    ) external override onlyGroupAdmin(groupId) {
        uint256 startIndex = _members[groupId].length;
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            addMember(groupId, identityCommitments[i]);
        }
        emit MembersAdded(groupId, startIndex, identityCommitments, _groups[groupId].root);
    }

    function updateMember(
        uint256,
        uint256,
        uint256,
        uint256[] calldata
    ) external pure override {
        revert("not implemented");
    }

    function removeMember(
        uint256,
        uint256,
        uint256[] calldata
    ) external pure override {
        revert("not implemented");
    }

    function validateProof(
        uint256 groupId,
        SemaphoreProof calldata proof
    ) external override onlyExistingGroup(groupId) {
        if (_groups[groupId].nullifierUsed[proof.nullifier]) {
            revert Semaphore__YouAreUsingTheSameNullifierTwice();
        }
        if (!verifyProof(groupId, proof)) {
            revert Semaphore__InvalidProof();
        }
        _groups[groupId].nullifierUsed[proof.nullifier] = true;
        emit ProofValidated(
            groupId,
            proof.merkleTreeDepth,
            proof.merkleTreeRoot,
            proof.nullifier,
            proof.message,
            proof.scope,
            proof.points
        );
    }

    function verifyProof(
        uint256 groupId,
        SemaphoreProof calldata proof
    ) public view override onlyExistingGroup(groupId) returns (bool) {
        GroupState storage g = _groups[groupId];
        if (g.size == 0) {
            revert Semaphore__GroupHasNoMembers();
        }
        if (proof.merkleTreeRoot != g.root) {
            revert Semaphore__MerkleTreeRootIsNotPartOfTheGroup();
        }
        // Test shortcut: proof is considered valid when first point is 1.
        return proof.points[0] == 1;
    }

    function getGroupAdmin(uint256 groupId) external view override returns (address) {
        return _groups[groupId].admin;
    }

    function hasMember(
        uint256 groupId,
        uint256 identityCommitment
    ) external view override returns (bool) {
        return _groups[groupId].memberExists[identityCommitment];
    }

    function indexOf(
        uint256 groupId,
        uint256 identityCommitment
    ) external view override returns (uint256) {
        return _groups[groupId].memberIndex[identityCommitment];
    }

    function getMerkleTreeRoot(uint256 groupId) external view override returns (uint256) {
        return _groups[groupId].root;
    }

    function getMerkleTreeDepth(uint256 groupId) external view override returns (uint256) {
        return _groups[groupId].depth;
    }

    function getMerkleTreeSize(uint256 groupId) external view override returns (uint256) {
        return _groups[groupId].size;
    }
}
