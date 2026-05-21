// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StrikeToken
 * @notice STRIKE — ERC-20 game token for ArcadeStrike.
 *
 * Tokenomics:
 *   - Fixed supply: 1,000,000,000 STRIKE (1 billion)
 *   - 3% of every wager pot is burned via the Escrow contract
 *   - Deflationary by design — total supply decreases with game activity
 *   - USD-backed real credits are handled off-chain by the treasury
 *
 * The treasury manages a 1:1 reserve. Real Credits are minted/burned
 * as users deposit/withdraw USD (via payment processor). The on-chain
 * STRIKE token is the unit of settlement between treasury and players.
 */
contract StrikeToken is ERC20, ERC20Burnable, Ownable {

    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    // Addresses authorized to mint (treasury only — for USD deposits)
    mapping(address => bool) public minters;

    event MinterSet(address indexed minter, bool authorized);

    error NotMinter();

    constructor(address treasury) ERC20("Strike", "STRIKE") Ownable(msg.sender) {
        _mint(treasury, INITIAL_SUPPLY);
    }

    /**
     * @notice Treasury mints STRIKE when a player deposits real USD.
     *         1 STRIKE represents $0.01 USD (100 STRIKE = $1.00).
     */
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        _mint(to, amount);
    }

    function setMinter(address minter, bool authorized) external onlyOwner {
        minters[minter] = authorized;
        emit MinterSet(minter, authorized);
    }

    /// @notice Decimals kept at 18 for standard ERC-20 compatibility
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
