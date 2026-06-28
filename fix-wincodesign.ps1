$cacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
if (!(Test-Path $cacheDir)) { New-Item -ItemType Directory -Force -Path $cacheDir }
cd $cacheDir
Invoke-WebRequest "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" -OutFile "winCodeSign.7z"
& "C:\Users\sonson\Desktop\YoutobeWedhook\node_modules\7zip-bin\win\x64\7za.exe" x winCodeSign.7z -owinCodeSign-2.6.0 -xr!darwin*
