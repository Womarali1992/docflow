/**
 * Generate a minimal, valid single-page PDF containing a title line.
 * Zero dependencies — used to give seeded documents a real, downloadable file
 * so the create → upload → download flow can be demoed end-to-end.
 */
export function makePlaceholderPdf(title: string): Buffer {
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const safeTitle = esc(title).slice(0, 120);
  const subtitle = esc('DocFlow placeholder document');

  const content =
    `BT /F1 20 Tf 72 720 Td (${safeTitle}) Tj ET\n` +
    `BT /F1 12 Tf 72 692 Td (${subtitle}) Tj ET\n`;
  const contentLen = Buffer.byteLength(content, 'latin1');

  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Length ${contentLen} >>\nstream\n${content}endstream`,
  ];

  let body = `%PDF-1.4\n`;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, 'latin1');
  const size = objects.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}
