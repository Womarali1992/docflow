/**
 * Upload fixtures: small but *real* files, because the pipeline sniffs magic
 * bytes and a hand-waved buffer would not exercise it.
 *
 * The interesting ones are the bad citizens — `spoofPdf` (PNG bytes wearing a
 * .pdf name), `encryptedPdf`, and EICAR, the industry-standard harmless string
 * every scanner is required to flag. Together they cover the refusal paths the
 * pipeline exists to have.
 */

/** A minimal but structurally real PDF. */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n'
);

/** The same, but declaring encryption — a scanner cannot see inside it. */
export const ENCRYPTED_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF\n'
);

/** A real 1×1 PNG (signature + IHDR + IDAT + IEND). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** A real 1×1 GIF. */
export const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** A minimal ZIP, which is what an .xlsx/.docx looks like to a sniffer. */
export const ZIP = Buffer.from(
  'UEsDBAoAAAAAAImhSVsAAAAAAAAAAAAAAAAJAAAAdGVzdC50eHRQSwECFAAKAAAAAACJoUlbAAAAAAAAAAAAAAAACQAAAAAAAAAAACAAAAAAAAAAdGVzdC50eHRQSwUGAAAAAAEAAQA3AAAAJwAAAAAA',
  'base64'
);

export const CSV = Buffer.from('Date,Description,Amount\n2026-01-02,Opening balance,1000.00\n');
export const TXT = Buffer.from('Notes for the 2026 return.\nNothing unusual this year.\n');

/** Not text at all, despite what its name will claim. */
export const BINARY_JUNK = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00, 0x7f, 0x00, 0x00]);

/**
 * The EICAR test string. Harmless by design and flagged by every scanner, so it
 * is how the infected path is exercised without anything dangerous on disk.
 * Assembled in pieces so this source file does not itself trip a scanner.
 */
export const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*'].join('')
);

/** Every fixture, with the filename it should be uploaded under. */
export const FIXTURES = {
  pdf: { name: 'statement.pdf', bytes: PDF },
  png: { name: 'photo.png', bytes: PNG },
  gif: { name: 'scan.gif', bytes: GIF },
  csv: { name: 'ledger.csv', bytes: CSV },
  txt: { name: 'notes.txt', bytes: TXT },
  xlsx: { name: 'books.xlsx', bytes: ZIP },
  docx: { name: 'letter.docx', bytes: ZIP },
  /** PNG bytes under a .pdf name: the case magic-byte checking exists for. */
  spoofPdf: { name: 'statement.pdf', bytes: PNG },
  encryptedPdf: { name: 'locked.pdf', bytes: ENCRYPTED_PDF },
  /** Binary under a .txt name. */
  fakeText: { name: 'notes.txt', bytes: BINARY_JUNK },
  eicar: { name: 'harmless.txt', bytes: EICAR },
  exe: { name: 'installer.exe', bytes: Buffer.from('MZ\x90\x00') },
  empty: { name: 'empty.pdf', bytes: Buffer.alloc(0) },
} as const;
