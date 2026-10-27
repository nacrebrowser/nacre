# Localization

`src/i18n.cjs` defines the 20 supported languages. `src/locales/en.json` is the English fallback; every catalogue has the same keys. `languages.*` labels are autonyms, allowing users to recover from an unfamiliar selection. Catalogue `_status` records provenance, not a claim of native review.

## Supported languages

Arabic, Chinese (Simplified and Traditional), Dutch, English, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil), Russian, Spanish, Turkish, Ukrainian and Vietnamese.

The list was reduced from 79 languages and variants so that each one can be translated and checked properly. Persian and Russian are kept for people who rely on Tor against censorship. A profile set to a language that is no longer offered, and a system locale without its own catalogue, use the closest kept language (`closestLanguage`): Canadian French becomes French, European Portuguese becomes Brazilian Portuguese, Hong Kong Chinese becomes Traditional Chinese, and any other language becomes English.

The authoritative codes are in `SUPPORTED_LANGUAGES`; tests verify selector parity and reject unsupported values.

## Custom languages

Settings › Appearance › "Create a custom language…" writes `languages/customN.json` in the profile folder (`%APPDATA%\Nacre\languages`, or `NacreData\languages` for the portable version) and shows it in Explorer. The template holds every text of the current interface language (English for another one), plus `_name` (shown in the list), `_locale` (a language tag such as `sw`) and `_instructions`. Each file is offered as the private-use tag `<_locale>-x-<id>`, `id` being the first eight letters and digits of the file name, so `Intl`, the `lang` attribute and right-to-left detection work as for built-in languages.

These files are local input of unknown quality. At most 20 files of 2 MiB are read; symbolic links are ignored. Only texts whose key exists in English and whose placeholders match are used, at most 4,000 characters each, rendered as plain text like every message; anything else stays in English. An edited file is read again the next time the language is selected. A profile whose custom file was removed falls back to the closest built-in language of its `_locale`, otherwise English.

## First-run language

After installation Nacre takes the first language of the Windows preference list it supports (`preferredLanguage`), then the display language: "Swahili, French" gives French. No network request is made to guess a country.

## Rendering rules

Use `data-i18n` for static text and `data-i18n-attr` for `title`, `aria-label` and `placeholder`. The shared internal preload loads the selected catalogue and emits `nacre:locale-ready`; dynamic renderers refresh their own text. HTTP authentication has its own restricted preload and receives its catalogue through the existing authentication context channel.

Use catalogue keys directly for new messages. `message-localizer.cjs` and the equivalent restricted preload helper translate existing English/French diagnostic strings without changing internal state-machine values. Matching uses bounded strings and deterministic delimiters. Dynamic arguments remain text and are never interpreted as markup. Unknown third-party errors remain their original text; they are not sent to a translation service.

Never translate URLs, cookie names, user page titles, paths, saved workspace names or protocol identifiers. Preserve named placeholders exactly, including repetitions. Use `textContent` and safe attributes, never `innerHTML`. The interface locale must not overwrite the external web fingerprint language policy.

Arabic, Persian, Hebrew and Urdu set `dir=rtl`. Shared CSS isolates technical content and moves the vertical sidebar; main-process page bounds follow that position. Keyboard key names use the English technical key labels consistently.

## Tests

`node --test` checks that every catalogue has the same keys and placeholders as English, that static HTML is covered, that the language selector matches the supported list, that nothing is rendered as HTML, and that the interface language stays separate from the language websites see.

`node scripts/verify-localization-runtime.cjs` runs real Electron windows with a temporary profile and checks the internal pages, the browser chrome, native menus and HTTP authentication in every language.

## Translation quality

Most catalogues started as machine translations and were then checked one by one. They still need review by fluent speakers, especially the privacy and permission texts. Corrections are welcome.

## Translation workflow

`scripts/i18n-batches.cjs` exports texts in batches, lets you translate them with any tool or by hand, and imports them back. It never connects to anything.

1. `node scripts/i18n-batches.cjs status` lists what is left per language.
2. `node scripts/i18n-batches.cjs export` writes `translation-work/<code>/GUIDELINES.txt` and `batch-NN.json` files of about 150 English texts: texts still identical to English and translations with known defects (`--langs de,es` limits the languages, `--all` resends every text).
3. Save each translated batch as `translation-work/<code>/answers/batch-NN.json`.
4. `node scripts/i18n-batches.cjs import --dry-run`, then without `--dry-run`. Only texts with the same placeholders, line breaks, version numbers and protected terms are merged; the others stay for the next export. Texts deliberately kept in English are remembered in `kept-identical.json`.
5. Run `node --test` before committing. `translation-work/` is not tracked.
