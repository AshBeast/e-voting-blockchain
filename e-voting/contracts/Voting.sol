// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";

/// @title Simple Voting MVP with Semaphore zero-knowledge ballots
/// @notice Admin registers wallet addresses, voters link a private Semaphore
/// identity before the election opens, and the relayer later submits anonymous
/// votes backed by a zero-knowledge membership proof.
contract Voting {
    using MessageHashUtils for bytes32;

    // Basic election roles and external protocol contracts.
    address public admin;
    address public relayer;
    ISemaphore public immutable semaphore;
    ISemaphoreGroups private immutable _semaphoreGroups;

    // Each election gets its own Semaphore group and proof scope.
    // The group contains identity commitments linked during PENDING.
    // The scope binds "one vote" to this specific election.
    uint256 public immutable semaphoreGroupId;
    uint256 public immutable voteScope;

    // Human-readable election configuration.
    string public title;
    string[] private _candidates;
    uint64 public startTs;
    uint64 public endTs;

    // candidate index => count
    uint256[] private _tally;

    // registered[voter] means the wallet is eligible for this election.
    // This is separate from Semaphore membership.
    mapping(address => bool) public registered;

    // Each wallet may link exactly one identity commitment for this election.
    mapping(address => bool) public hasLinkedIdentity;
    mapping(address => uint256) public linkedIdentityCommitment;

    // Prevent reusing the same commitment for multiple wallets or elections.
    mapping(uint256 => bool) public commitmentUsed;

    // Receipt hashes are public inclusion handles shown back to the voter.
    // Reusing a receipt is rejected to prevent replay.
    mapping(bytes32 => bool) private _receiptUsed;

    // Off-chain link authorization signed by the voter wallet.
    bytes32 private constant _LINK_TYPEHASH =
        keccak256(
            "EVoteLink(address voter,uint256 identityCommitment,uint256 expiry,uint256 chainId,address voting)"
        );

    event VoterRegistered(address indexed voter);
    event IdentityLinked(uint256 indexed identityCommitment);
    event VoteCast(bytes32 indexed receipt);
    event RelayerUpdated(address indexed relayer);
    event ElectionConfigured(string title, uint64 startTs, uint64 endTs);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "not relayer");
        _;
    }

    modifier inWindow() {
        require(
            block.timestamp >= startTs && block.timestamp <= endTs,
            "not in voting window"
        );
        _;
    }

    constructor(
        string memory _title,
        string[] memory candidateNames,
        uint64 _startTs,
        uint64 _endTs,
        address relayer_,
        address semaphore_
    ) {
        require(candidateNames.length >= 2, "need >= 2 candidates");
        require(_endTs > _startTs, "bad time window");
        require(relayer_ != address(0), "bad relayer");
        require(semaphore_ != address(0), "bad semaphore");

        // The deployer becomes the admin for this election instance.
        admin = msg.sender;
        relayer = relayer_;
        semaphore = ISemaphore(semaphore_);
        _semaphoreGroups = ISemaphoreGroups(semaphore_);

        // Create a fresh Semaphore group for this election only.
        semaphoreGroupId = semaphore.createGroup(address(this));

        // Proofs are scoped per election so the same identity cannot reuse a
        // valid nullifier across this contract instance.
        voteScope = uint256(
            keccak256(
                abi.encodePacked("EVOTE_SCOPE", block.chainid, address(this))
            )
        );
        title = _title;
        _candidates = candidateNames;
        startTs = _startTs;
        endTs = _endTs;

        _tally = new uint256[](candidateNames.length);
        emit RelayerUpdated(relayer_);
        emit ElectionConfigured(_title, _startTs, _endTs);
    }

    /* ===================== Admin actions ===================== */

    function registerVoters(address[] calldata addrs) external onlyAdmin {
        require(block.timestamp < startTs, "registration closed");
        for (uint256 i = 0; i < addrs.length; i++) {
            address voter = addrs[i];
            require(voter != address(0), "bad voter");

            // Registration only allowlists the wallet.
            // It does not add anything to the Semaphore group yet.
            registered[voter] = true;
            emit VoterRegistered(voter);
        }
    }

    function closeEarly() external onlyAdmin {
        require(block.timestamp < endTs, "already ended");
        endTs = uint64(block.timestamp);
        emit ElectionConfigured(title, startTs, endTs);
    }

    function updateWindow(uint64 _startTs, uint64 _endTs) external onlyAdmin {
        require(block.timestamp < startTs, "already started");
        require(_endTs > _startTs, "bad time window");
        startTs = _startTs;
        endTs = _endTs;
        emit ElectionConfigured(title, _startTs, _endTs);
    }

    function updateRelayer(address newRelayer) external onlyAdmin {
        require(newRelayer != address(0), "bad relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function linkPayloadHash(
        address voter,
        uint256 identityCommitment,
        uint256 expiry
    ) public view returns (bytes32) {
        // The voter signs this exact payload off-chain. Including chainId and
        // contract address prevents replay on a different network or election.
        return
            keccak256(
                abi.encode(
                    _LINK_TYPEHASH,
                    voter,
                    identityCommitment,
                    expiry,
                    block.chainid,
                    address(this)
                )
            );
    }

    function linkIdentity(
        address voter,
        uint256 identityCommitment,
        uint256 expiry,
        bytes calldata signature
    ) external onlyRelayer {
        // Linking is a one-time bootstrap step and must happen before voting.
        require(block.timestamp < startTs, "linking closed");
        require(block.timestamp <= expiry, "link expired");
        require(registered[voter], "not registered");
        require(!hasLinkedIdentity[voter], "identity linked");
        require(identityCommitment != 0, "bad commitment");
        require(!commitmentUsed[identityCommitment], "commitment used");

        // Recover the wallet that signed the link authorization.
        bytes32 digest = linkPayloadHash(voter, identityCommitment, expiry)
            .toEthSignedMessageHash();
        address signer = ECDSA.recover(digest, signature);
        require(signer == voter, "bad link signature");

        // Persist the wallet -> commitment relationship for this election.
        hasLinkedIdentity[voter] = true;
        linkedIdentityCommitment[voter] = identityCommitment;
        commitmentUsed[identityCommitment] = true;

        // This is the moment the voter actually joins the Semaphore group.
        semaphore.addMember(semaphoreGroupId, identityCommitment);
        emit IdentityLinked(identityCommitment);
    }

    /* ===================== Voting ===================== */

    function voteMessage(
        uint256 optionIndex,
        bytes32 receipt
    ) public pure returns (uint256) {
        // The proof must be tied to the exact candidate choice and receipt that
        // are later submitted on-chain.
        return uint256(keccak256(abi.encodePacked(optionIndex, receipt)));
    }

    function vote(
        uint256 optionIndex,
        ISemaphore.SemaphoreProof calldata proof,
        bytes32 receipt
    ) external onlyRelayer inWindow {
        // Cheap local checks first before running the heavier zk verifier path.
        require(optionIndex < _tally.length, "bad option");
        require(!_receiptUsed[receipt], "receipt used");
        require(
            proof.message == voteMessage(optionIndex, receipt),
            "bad proof message"
        );
        require(proof.scope == voteScope, "bad proof scope");

        // Semaphore enforces group membership and one-vote-per-identity using
        // the proof, merkle root, and nullifier.
        semaphore.validateProof(semaphoreGroupId, proof);

        // Once the proof is accepted, the receipt becomes a public inclusion
        // handle and the tally is updated for the chosen option.
        _receiptUsed[receipt] = true;

        _tally[optionIndex] += 1;

        emit VoteCast(receipt);
    }

    /* ===================== Views ===================== */

    function candidates() external view returns (string[] memory) {
        return _candidates;
    }

    function tally() external view returns (uint256[] memory) {
        return _tally;
    }

    function candidateCount() external view returns (uint256) {
        return _tally.length;
    }

    function hasReceipt(bytes32 receipt) external view returns (bool) {
        return _receiptUsed[receipt];
    }

    function groupRoot() external view returns (uint256) {
        // Exposed mainly for debugging, UI inspection, and tests.
        return _semaphoreGroups.getMerkleTreeRoot(semaphoreGroupId);
    }

    function groupDepth() external view returns (uint256) {
        return _semaphoreGroups.getMerkleTreeDepth(semaphoreGroupId);
    }

    function groupSize() external view returns (uint256) {
        return _semaphoreGroups.getMerkleTreeSize(semaphoreGroupId);
    }

    function electionInfo()
        external
        view
        returns (string memory, uint64, uint64)
    {
        return (title, startTs, endTs);
    }

    function status() public view returns (string memory) {
        // Derived from time only; there is no separate mutable status flag.
        if (block.timestamp < startTs) {
            return "PENDING";
        } else if (block.timestamp >= startTs && block.timestamp <= endTs) {
            return "OPEN";
        } else {
            return "CLOSED";
        }
    }
}
