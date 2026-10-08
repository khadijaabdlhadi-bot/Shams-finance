# zipalign بسيط: يحاذي البيانات غير المضغوطة على 4 بايت (و resources.arsc)
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
with open(dst, 'wb') as fout:
    zout = zipfile.ZipFile(fout, 'w')
    for info in zin.infolist():
        data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        if ni.compress_type == zipfile.ZIP_STORED:
            off = fout.tell() + 30 + len(ni.filename.encode())
            pad = (-off) % 4
            ni.extra = b'\x00' * pad
        zout.writestr(ni, data)
    zout.close()
