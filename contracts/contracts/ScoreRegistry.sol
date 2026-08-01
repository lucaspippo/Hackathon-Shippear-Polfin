// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Registro de reputación crediticia de PolFin
contract ScoreRegistry is Ownable {
    struct Score {
        uint256 valor;
        uint256 timestamp;
    }

    mapping(uint256 => Score) public scores;

    event ScoreRegistrado(uint256 indexed entidadId, uint256 score, uint256 timestamp);

    constructor() Ownable(msg.sender) {}

    function registrarScore(uint256 entidadId, uint256 score) external onlyOwner {
        require(score <= 1000, "score fuera de rango 0-1000");
        scores[entidadId] = Score(score, block.timestamp);
        emit ScoreRegistrado(entidadId, score, block.timestamp);
    }
}
