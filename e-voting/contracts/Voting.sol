// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @title Simple Voting MVP with Receipts + ERC-2771 (meta-tx ready)
contract Voting is ERC2771Context {
    address public admin;

    string public title;
    string[] private _candidates;
    uint64 public startTs;
    uint64 public endTs;

    // candidate index => count
    uint256[] private _tally;

    // voter allowlist + one-vote check
    mapping(address => bool) public registered;
    mapping(address => bool) public hasVoted;

    // receipt hash => used?
    mapping(bytes32 => bool) private _receiptUsed;

    event VoterRegistered(address indexed voter);
    event VoteCast(address indexed voter, bytes32 indexed receipt);
    event ElectionConfigured(string title, uint64 startTs, uint64 endTs);

    modifier onlyAdmin() {
        require(_msgSender() == admin, "not admin");
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
        address trustedForwarder_
    ) ERC2771Context(trustedForwarder_) {
        require(candidateNames.length >= 2, "need >= 2 candidates");
        require(_endTs > _startTs, "bad time window");

        admin = _msgSender(); // IMPORTANT for meta-tx compatibility
        title = _title;
        _candidates = candidateNames;
        startTs = _startTs;
        endTs = _endTs;

        _tally = new uint256[](candidateNames.length);
        emit ElectionConfigured(_title, _startTs, _endTs);
    }

    /* ===================== Admin actions ===================== */

    function registerVoters(address[] calldata addrs) external onlyAdmin {
        require(block.timestamp < startTs, "registration closed");
        for (uint256 i = 0; i < addrs.length; i++) {
            registered[addrs[i]] = true;
            emit VoterRegistered(addrs[i]);
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

    /* ===================== Voting ===================== */

    function vote(uint256 optionIndex, bytes32 receipt) external inWindow {
        address voter = _msgSender(); // IMPORTANT: use meta-tx sender

        require(registered[voter], "not registered");
        require(!hasVoted[voter], "already voted");
        require(optionIndex < _tally.length, "bad option");
        require(!_receiptUsed[receipt], "receipt used");

        hasVoted[voter] = true;
        _receiptUsed[receipt] = true;

        _tally[optionIndex] += 1;

        emit VoteCast(voter, receipt);
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

    function electionInfo()
        external
        view
        returns (string memory, uint64, uint64)
    {
        return (title, startTs, endTs);
    }

    function status() public view returns (string memory) {
        if (block.timestamp < startTs) {
            return "PENDING";
        } else if (block.timestamp >= startTs && block.timestamp <= endTs) {
            return "OPEN";
        } else {
            return "CLOSED";
        }
    }
}
