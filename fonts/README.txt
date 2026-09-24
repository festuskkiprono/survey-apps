This folder needs three local font files for Lexend Deca:

  lexend-deca-400.woff2   (Regular)
  lexend-deca-600.woff2   (SemiBold)
  lexend-deca-700.woff2   (Bold)

How to get them:
1. Go to https://gwfh.mranftl.com/fonts (Google Webfonts Helper)
2. Search "Lexend Deca"
3. Select charset: latin
4. Select styles: 400, 600, 700
5. Download the .woff2 files (the "Modern Browsers" option only needs woff2)
6. Rename them to match the filenames above and drop them in this folder

Until these files are present, the browser will silently fall back to
the system font stack defined in css/tokens.css (var(--font-body)),
so the app still works and looks reasonable — it just won't be using
Lexend Deca specifically until the files are added.
