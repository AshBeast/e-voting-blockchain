//
pragma solidity ^0.8.20;

/// @title Simple Voting MVP with Receipts
/// @notice Admin creates an election with candidates and a time window.
///         Voters must be registered. Each voter may vote once.
///         A vote stores only a receipt hash (not the choice or identity).
///         Tally is public and updated on each valid vote.
contract Voting {
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
        require(msg.sender == admin, "not admin");
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
        uint64 _endTs
    ) {
        require(candidateNames.length >= 2, "need >= 2 candidates");
        require(_endTs > _startTs, "bad time window");

        admin = msg.sender;
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

    /// @notice Admin can close election early in emergencies
    /// I have not fully thought this through yet
    function closeEarly() external onlyAdmin {
        require(block.timestamp < endTs, "already ended");
        endTs = uint64(block.timestamp);
        emit ElectionConfigured(title, startTs, endTs);
    }

    /// @notice Optional: allow admin to adjust the window *before* voting starts
    /// incase we want to delay an election for whatever reason
    function updateWindow(uint64 _startTs, uint64 _endTs) external onlyAdmin {
        require(block.timestamp < startTs, "already started");
        require(_endTs > _startTs, "bad time window");
        startTs = _startTs;
        endTs = _endTs;
        emit ElectionConfigured(title, _startTs, _endTs);
    }

    /* ===================== Voting ===================== */

    /// @notice Cast a vote for candidate `optionIndex` with a precomputed `receipt`.
    /// @dev receipt = keccak256(abi.encodePacked(voter, optionIndex, nonce));
    ///      `nonce` is chosen off-chain by the voter (random string/bytes).
    function vote(uint256 optionIndex, bytes32 receipt) external inWindow {
        require(registered[msg.sender], "not registered");
        require(!hasVoted[msg.sender], "already voted");
        require(optionIndex < _tally.length, "bad option");
        require(!_receiptUsed[receipt], "receipt used");

        hasVoted[msg.sender] = true;
        _receiptUsed[receipt] = true;

        _tally[optionIndex] += 1;

        emit VoteCast(msg.sender, receipt);
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

    /// @notice Verify inclusion proof by checking a receipt hash
    function hasReceipt(bytes32 receipt) external view returns (bool) {
        return _receiptUsed[receipt];
    }

    /// @notice Returns election title, start, and end timestamps
    function electionInfo()
        external
        view
        returns (string memory, uint64, uint64)
    {
        return (title, startTs, endTs);
    }

    /// @notice Returns current status: "PENDING", "OPEN", or "CLOSED"
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
