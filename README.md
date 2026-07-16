Hypothesis client --- with AI suggestions
=================

The following README is almost entirely the README of the open source Hypothesis client our code extends. The extensions, as well as updates to the links below, will be added shortly.

[![npm version](https://img.shields.io/npm/v/hypothesis.svg)][npm]
[![BSD licensed](https://img.shields.io/badge/license-BSD-blue.svg)][license]

[gha]: https://github.com/hypothesis/client/actions?query=branch%3Amain
[npm]: https://www.npmjs.com/package/hypothesis
[license]: https://github.com/hypothesis/client/blob/main/LICENSE

The Hypothesis client is a browser-based tool for making annotations on web
pages. It’s a client for the [Hypothesis web annotation service][service].
It’s used by the [Hypothesis browser extension][ext], and can also be
[embedded directly into web pages][embed].

![Screenshot of Hypothesis client](/images/screenshot.png?raw=true)

[service]: https://github.com/hypothesis/h
[ext]: https://chrome.google.com/webstore/detail/hypothesis-web-pdf-annota/bjfhmglciegochdpefhhlphglcehbmek
[embed]: https://h.readthedocs.io/projects/client/en/latest/publishers/embedding.html

Development
-----------

See the client [Development Guide][developers] for instructions on building,
testing and contributing to the client.

[developers]: https://h.readthedocs.io/projects/client/en/latest/developers/

Community
---------

See our [Contact page to join us on Slack](https://web.hypothes.is/contact/), or
[log in once you've already created an account](https://hypothesis-open.slack.com/).

If you'd like to contribute to the project, you should consider subscribing to
the [development mailing list][ml], where we can help you plan your
contributions.

Please note that this project is released with a [Contributor Code of
Conduct][coc]. By participating in this project you agree to abide by its terms.

[ml]: https://groups.google.com/a/list.hypothes.is/g/dev
[coc]: https://github.com/hypothesis/client/blob/main/CODE_OF_CONDUCT

License
-------

The Hypothesis client is released under the [2-Clause BSD License][bsd2c],
sometimes referred to as the "Simplified BSD License". Some third-party
components are included. They are subject to their own licenses. All of the
license information can be found in the included [LICENSE][license] file.

[bsd2c]: http://www.opensource.org/licenses/BSD-2-Clause
[license]: https://github.com/hypothesis/client/blob/main/LICENSE

Building for the browser extension
----------------------------------

This client is bundled into the AI browser extension via a `portal:` dependency.
Clone both repos side by side:

```
some-folder/
  hypothesis-client-with-ai/               # this repo
  hypothesis-browser-extension-with-AI/
```

The extension's `package.json` should include:

```json
"hypothesis": "portal:../hypothesis-client-with-ai"
```

Install dependencies once per repo (`yarn install` in each), then build:

```bash
cd hypothesis-client-with-ai
make build

cd ../hypothesis-browser-extension-with-AI
make build SETTINGS_FILE=settings/chrome-prod.json
```

Use `settings/chrome-prod.json` for the production Hypothesis service. If you
omit `SETTINGS_FILE`, the extension Makefile defaults to `chrome-dev.json`
(`localhost`) and login will fail.

Load the unpacked extension from `hypothesis-browser-extension-with-AI/build/`
in `chrome://extensions/` (Developer mode → Load unpacked). After code changes,
re-run both build steps and refresh the extension card.

Tag inventory and experiment-log data persist in page `localStorage`
(`hypothesis.tagInventory.rows`, `hypothesis.aiSearch.experimentLog`). Inspect
exported logs with:

```bash
python scripts/inspect-experiment-log.py experiment-log-2026-03-27.json
```

# Todo's
- make sure clear error message pops up if API key is missing onSearch in AISearchPanel
- make sure to show user-friendly versions of console.log messages in UI