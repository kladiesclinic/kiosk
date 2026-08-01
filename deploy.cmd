@echo off
rem Build locally and publish the dist folder to the gh-pages branch (GitHub Pages).
rem Live URL: https://kladiesclinic.github.io/kiosk/
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call "C:\Program Files\nodejs\npm.cmd" run build || exit /b 1
type nul > dist\.nojekyll
cd dist
git init -b gh-pages
git add -A
git -c user.name="kanekonodoka-dot" -c user.email="kanekonodoka@klcs.jp" commit -m "Deploy"
git push -f https://github.com/kladiesclinic/kiosk.git gh-pages
cd ..
rmdir /s /q dist\.git
echo Done. https://kladiesclinic.github.io/kiosk/
