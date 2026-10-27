# How the protection dashboard names companies

The shield button shows the last things Nacre blocked on the current tab. The dashboard lists everything blocked, allowed or rewritten in the session, with search and filters by company.

Each row shows:

- the cookie name, or "cookie not observable" when the request was blocked before any header was sent;
- the domain and the site it was loaded from;
- what Nacre did: blocked the request, stopped a cookie from being sent or stored, or deleted it;
- the company and service it belongs to, when known, and why Nacre thinks so.

The counter counts Nacre's interventions, not people, companies or unique trackers.

## How attribution works

Nacre uses a small catalogue bundled with the app and never asks an online service. It compares the registrable domain exactly: `google-analytics.com` is Google, but `google.com.evil.test` is not.

A cookie name alone is only a hint. `_ga` is the usual Google Analytics cookie, but any site can use that name, so it is shown as a *possible* technology, not as proof. When the domain and the cookie name disagree, the domain wins. Unknown cookies stay unattributed, and a known company does not automatically mean tracking: a strict cookie policy can also filter useful cookies.

The catalogue currently recognises Google Analytics and Google Ads, Meta Pixel, Microsoft Clarity and Microsoft Advertising, and the LinkedIn Insight Tag. It is based on these companies' own documentation and needs updating over time.

## What is kept

- Everything stays in memory: at most 200 recent entries, gone when Nacre closes.
- Cookie values, full headers, page paths and URL parameters are never recorded.
- Each private tab has its own separate list, deleted when the tab closes.
- Clearing cookies, cache or site data also clears the list. It is never written to disk or exported unless you copy the report yourself.
