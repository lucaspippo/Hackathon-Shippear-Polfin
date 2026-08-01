// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title e-Pagaré tokenizado de PolFin (RWA)
contract EPagare is ERC721, Ownable {
    enum Estado { Activo, Pagado, Vencido }

    struct Pagare {
        uint256 deudorId;
        uint256 acreedorId;
        uint256 monto;
        uint256 tasaTnaBps;
        uint256 plazoDias;
        uint256 fechaVencimiento;
        Estado estado;
    }

    uint256 private _proximoTokenId = 1;
    mapping(uint256 => Pagare) public pagares;

    event InstrumentoGenerado(uint256 indexed tokenId, uint256 indexed deudorId, uint256 indexed acreedorId, uint256 monto);
    event InstrumentoPagado(uint256 indexed tokenId);

    constructor() ERC721("PolFin e-Pagare", "PFPAG") Ownable(msg.sender) {}

    function generarInstrumento(
        uint256 deudorId,
        uint256 acreedorId,
        uint256 monto,
        uint256 tasaTnaBps,
        uint256 plazoDias,
        uint256 fechaVencimiento
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _proximoTokenId++;
        pagares[tokenId] = Pagare(deudorId, acreedorId, monto, tasaTnaBps, plazoDias, fechaVencimiento, Estado.Activo);
        _safeMint(msg.sender, tokenId);
        emit InstrumentoGenerado(tokenId, deudorId, acreedorId, monto);
    }

    function marcarPagado(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "instrumento inexistente");
        pagares[tokenId].estado = Estado.Pagado;
        emit InstrumentoPagado(tokenId);
    }
}
