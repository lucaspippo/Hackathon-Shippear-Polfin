# PDF del e-pagaré al aprobar/emitir — diseño

Fecha: 2026-08-01

## Objetivo

Cuando se aprueba y emite un e-pagaré (flujo directo desde `NuevaVenta` o
vía el approval gate en `Aprobaciones`), el vendedor tiene que poder bajar
un PDF real del comprobante para entregárselo al cliente final, que no
entra a la app.

## Alcance

- Generación **client-side** con `jspdf` (pura JS, sin binarios nativos).
  El documento se dibuja programáticamente (texto/líneas) — NO es una
  captura de pantalla (`html2canvas`) del componente oscuro en pantalla,
  porque el resultado tiene que ser un documento claro, imprimible, apto
  para entregar.
- No toca el backend: `GET /api/instrumentos/:id` ya trae todos los datos
  necesarios (mismo fetch que ya usa `EPagare` en `documento.tsx`).
- Fuera de alcance: comprobante de pago en PDF, descarga automática sin
  click del usuario, persistencia del PDF en el backend, logo-imagen en el
  PDF (encabezado solo texto, para no depender de convertir el asset a
  base64).

## Cambios

### `frontend/package.json`
- Nueva dependencia: `jspdf`.

### `frontend/components/documento.tsx`
- Nueva función `descargarPdf(i: Instrumento)` que arma el PDF con `jsPDF`
  replicando los mismos campos que ya se ven en `EPagare`: encabezado
  PolFin, título + N.º + fecha de emisión, acreedor/deudor, caja de
  monto/tasa/plazo/vencimiento, párrafo de la obligación, bloque on-chain
  (red, contrato, tx hash, token id si aplica) y estado de aceptación.
  Nombre de archivo: `e-pagare-{id}.pdf`.
- Nuevo botón "Descargar PDF" al lado del "Descargar / Imprimir" existente
  (que se mantiene sin cambios).

### `frontend/components/aprobaciones.tsx`
- Recibe un nuevo prop `abrirDoc: (d: DocRef) => void` (mismo patrón que ya
  usa `Pagos`).
- En la tarjeta de una solicitud resuelta como aprobada, agrega un link
  "Ver documento →" que llama `abrirDoc({ tipo: "epagare", id:
  resuelta.instrumento.instrumento_id })`. Esto abre el mismo modal
  `Documento`, donde ya está el botón de descarga de PDF — así el flujo de
  aprobación asíncrona también llega al PDF, no solo la venta directa.
- El tipo `Resuelta` gana el campo `instrumento_id` (ya viene en la
  respuesta de `POST /api/solicitudes/:id/aprobar`, solo faltaba tiparlo).

### `frontend/components/shell.tsx`
- Pasa `abrirDoc={abrirDoc}` a `<Aprobaciones />` (mismo callback que ya
  existe y se usa en `<Pagos />`).

## Testing

No hay suite de tests en el repo. Verificación manual: levantar
`npm run dev`, abrir el modal del e-pagaré (vía Nueva venta o Aprobaciones)
y confirmar que "Descargar PDF" baja un PDF legible con los datos
correctos.
