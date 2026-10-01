#!/usr/bin/env python3
"""Dev-only: writes small, text-based sample PDFs (fake data) into samples/.
Uses only the Python standard library. Run: python3 tools/make-sample-pdfs.py"""
from pathlib import Path

def pdf(lines, path):
    def esc(s):
        return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    # Text at x=50 starts a new line; any other x continues the current line (an amount column).
    y = 776
    ops = ['BT', '/F1 10 Tf']
    for text, x in lines:
        if x == 50:
            y -= 16
        ops.append(f'1 0 0 1 {x} {y} Tm ({esc(text)}) Tj')
    ops.append('ET')
    stream = '\n'.join(ops).encode('latin-1')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + o + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    Path(path).write_bytes(out)

root = Path(__file__).resolve().parent.parent / 'samples'
pdf([
    ('EXAMPLE BANK VISA SIGNATURE - FAKE SAMPLE STATEMENT', 50),
    ('Account Number: XXXX XXXX XXXX 4242', 50),
    ('Statement Period 12/05/2023 - 01/04/2024', 50),
    ('New Balance $1,482.37     Minimum Payment Due $40.00', 50),
    ('Purchase Annual Percentage Rate (APR) 22.74%', 50),
    ('Payments and Credits', 50),
    ('12/20 PAYMENT THANK YOU', 50), ('500.00', 450),
    ('12/28 RETURN: TARGET 00012345', 50), ('25.00', 450),
    ('Purchases', 50),
    ('12/06 12/07 KROGER #512 COLUMBUS OH', 50), ('83.19', 450),
    ('12/11 12/12 SHELL OIL 12345678', 50), ('41.02', 450),
    ('12/15 12/16 <script>alert("pdf")</script>', 50), ('9.99', 450),
    ('12/24 12/26 AMAZON.COM*AB12CD', 50), ('126.45', 450),
    ('01/02 01/03 NETFLIX.COM', 50), ('15.49', 450),
    ('Total purchases 276.14', 50),
], root / 'card-statement-text.pdf')
pdf([
    ('ACME CORP - EARNINGS STATEMENT (FAKE SAMPLE)', 50),
    ('Employee: Sample Person', 50),
    ('Pay Period 01/01/2024 - 01/14/2024     Pay Date 01/19/2024', 50),
    ('Gross Pay', 50), ('3,250.00', 400),
    ('Federal Income Tax', 50), ('341.20', 400),
    ('Social Security', 50), ('201.50', 400),
    ('Medicare', 50), ('47.13', 400),
    ('State Income Tax', 50), ('120.40', 400),
    ('401(k)', 50), ('162.50', 400),
    ('Medical Insurance', 50), ('88.27', 400),
    ('Net Pay', 50), ('2,289.00', 400),
], root / 'paystub-text.pdf')
print('wrote samples/card-statement-text.pdf and samples/paystub-text.pdf')
