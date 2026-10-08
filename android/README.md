# تطبيق أندرويد — الملاحظات اليومية

يغلّف صفحة `web/public/daily-notes.html` في تطبيق أندرويد (WebView) مع:
- زر **طباعة** يفتح نافذة الطباعة في أندرويد (طابعة أو حفظ PDF).
- زر **تحميل صورة** يحفظ الورقة في المعرض ويفتح المشاركة (واتساب).
- الخطوط مضمّنة، فيعمل بدون إنترنت. يتطلب أندرويد 10 أو أحدث.

## البناء
يحتاج مجلد `tools/` بجانب السكربت فيه:
`prebuilt/linux/aapt2_64` و `brut/androlib/android-framework.jar` (من Apktool 2.9.3)،
`android-all.jar` (org.robolectric:android-all:13-robolectric-9030017)،
`dx.jar` (com.jakewharton.android.repackaged:dalvik-dx:14.0.0_r21)،
`apksig.jar` (com.android.tools.build:apksig:2.3.0)،
ثم `javac -cp tools/apksig.jar -d signer signer/Sign.java` و:

```bash
./build.sh ../web/public/daily-notes.html   # الناتج: out/shams-daily-notes.apk
```

مفتاح التوقيع `shams.p12` لا يُرفع إلى المستودع. احتفظوا به: التحديثات اللاحقة يجب أن تُوقَّع بنفس المفتاح.
