// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ArcadeToken (ARCD)
 * @notice Utility token for ArcadeStrike ecosystem.
 *         3% of all wager fees are sent to this contract's burn address
 *         via the escrow buyback & burn model.
 */
contract ArcadeToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion ARCD
    address public minter;

    event MinterUpdated(address indexed oldMinter, address indexed newMinter);

    constructor() ERC20("ArcadeToken", "ARCD") Ownable(msg.sender) {
        // Initial supply: 20% to team/treasury, rest reserved for emissions
        _mint(msg.sender, 200_000_000 * 1e18);
    }

    modifier onlyMinter() {
        require(msg.sender == minter || msg.sender == owner(), "Not minter");
        _;
    }

    function setMinter(address _minter) external onlyOwner {
        emit MinterUpdated(minter, _minter);
        minter = _minter;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    /**
     * @notice Burns tokens received as fees (buyback & burn).
     *         Anyone can call this to burn tokens held by this contract.
     */
    function burnHeld() external {
        uint256 balance = balanceOf(address(this));
        require(balance > 0, "Nothing to burn");
        _burn(address(this), balance);
    }
}
