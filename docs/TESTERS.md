# Testing Nacre

Thanks for trying Nacre. It is a young browser: please don't rely on it yet for anything sensitive.

## Install

Download one of these from the [releases page](https://github.com/nacrebrowser/nacre/releases):

- **Installer:** `Nacre-Setup-1.1.0.exe`. You can choose the folder and whether Tor is on by default.
- **Linux (beta):** `nacre_1.1.0_amd64.deb` for Ubuntu and Debian: `sudo apt install ./nacre_1.1.0_amd64.deb`.
- **Portable:** unzip **all** of `Nacre-1.1.0-Portable.zip` into a folder you can write to, then run **`Nacre Portable.cmd`**. Don't start `Nacre.exe` directly, or it would use the profile of an installed copy. Your data stays in the `NacreData` folder next to it.

### "Windows protected your PC"

This is expected: the installer is not signed yet. Click **More info**, then **Run anyway**. To check that the file was not modified, compare its hash with `SHA256SUMS-1.1.0.txt`:

```powershell
Get-FileHash .\Nacre-Setup-1.1.0.exe
```

## What to look at first

1. **Menus:** the three-dot menu, the Tor menu next to the address bar and the shield panel. They should open above the page, close when you click the page, and work with the keyboard (arrows, Esc).
2. **Tabs:** site icons, loading, closing, drag and drop, pinned tabs.
3. **Bookmarks bar:** the star in the address bar adds a bookmark, Ctrl+Shift+B shows the bar.
4. **Tor:** turn it on, change the exit country, use "New Tor identity".
5. **A school or office network:** do sites open? If not, keep Settings › Network and Tor › Secure DNS on "Automatic".
6. **The sites you use every day:** can you sign in, do videos play? Tell us which ones don't work.

Known not to work yet: Netflix, Disney+ and other services that need DRM (Widevine).

## Checking pages

- **Settings › Privacy check** reviews your settings, without any network test.
- **Diagnostics** (Settings › About › "Run all local diagnostics", or `nacre://leak-tests/#run`) measures the page itself. "Known limit" is neither a pass nor a failure: that measurement is not possible from inside the browser.

## Reporting a problem

Open an [issue](https://github.com/nacrebrowser/nacre/issues) with:

- what you were doing and what you expected;
- a screenshot or a short video;
- your Windows version;
- for a browsing problem: the site address, and whether Tor was on;
- if you can, the "Raw diagnostic data (JSON)" block from the diagnostics page. Your public IP address is partly hidden in it.

Never send passwords or the contents of your profile folder (`NacreData` or `%APPDATA%\Nacre`): it holds your cookies and bookmarks.

## Uninstall

Windows Settings › Apps › Nacre › Uninstall. Your data (bookmarks, settings, cookies) stays in `%APPDATA%\Nacre`: delete that folder to remove everything. For the portable version, just delete its folder.
