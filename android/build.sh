#!/bin/bash
set -euo pipefail
A="$(cd "$(dirname "$0")" && pwd)"; P=$A/proj; T=$A/tools; O=$A/out
SRC_HTML="$1"
rm -rf $O && mkdir -p $O/classes $O/res $O/assets
# الصفحة مع الخطوط المحلية بدل خطوط الإنترنت
python3 -I - "$SRC_HTML" "$P/assets/daily-notes.html" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
s=re.sub(r'<link rel="preconnect"[^>]*>\n?','',s)
import base64,os
fdir=os.path.join(os.path.dirname(sys.argv[2]),'fonts')
css=open(os.path.join(fdir,'fonts.css')).read()
css=re.sub(r"url\(fonts/([^)]+)\)", lambda m: "url(data:font/woff2;base64,"+base64.b64encode(open(os.path.join(fdir,m.group(1)),'rb').read()).decode()+")", css)
s=re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>', lambda m: '<style>'+css+'</style>', s)
s=re.sub(r'<link rel="(manifest|apple-touch-icon)"[^>]*>\n?','',s)
s=s.replace('<link rel="icon" type="image/png" href="daily-notes-192.png">\n','')
open(sys.argv[2],'w').write(s)
PY
cp $P/assets/daily-notes.html $O/assets/
$T/prebuilt/linux/aapt2_64 compile --dir $P/res -o $O/res.zip
$T/prebuilt/linux/aapt2_64 link -o $O/base.apk -I $T/brut/androlib/android-framework.jar \
  --manifest $P/AndroidManifest.xml -A $O/assets $O/res.zip --min-sdk-version 29 --target-sdk-version 34 --version-code 1 --version-name 1.0
javac -nowarn --release 8 -encoding UTF-8 -cp $T/android-all.jar -d $O/classes $(find $P/src -name '*.java') 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
java -cp $T/dx.jar com.android.dx.command.Main --dex --min-sdk-version=26 --output=$O/classes.dex $O/classes 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
python3 -I - $O/base.apk $O/classes.dex <<'PY'
import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'a',zipfile.ZIP_DEFLATED) as z: z.write(sys.argv[2],'classes.dex')
PY
[ -f $A/shams.p12 ] || keytool -genkeypair -keystore $A/shams.p12 -storetype PKCS12 -storepass shamsnotes -keypass shamsnotes -alias shams -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Shams Alwatan School, O=Shams Alwatan, C=LY" 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
python3 -I $A/zipalign.py $O/base.apk $O/aligned.apk
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-opens java.base/sun.security.x509=ALL-UNNAMED -cp $T/apksig.jar:$A/signer Sign $A/shams.p12 shamsnotes $O/aligned.apk $O/shams-daily-notes.apk 2>&1 | grep -v JAVA_TOOL_OPTIONS
ls -la $O/shams-daily-notes.apk
