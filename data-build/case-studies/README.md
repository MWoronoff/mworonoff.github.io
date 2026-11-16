# Case study builder

Rebuilds an Adtaxi case study in the restyled design (results first, Challenges/Solutions table, Key Insights, "The full story" in two columns).

    python3 build.py data/<file>.json out/          # needs Playwright + Chrome and the Poppins font
    python3 verify.py <original.pdf> out/<file>.pdf  # every word of the original must be in the rebuild

- `data/*.json`: copy carried over word for word from the original PDF; only the page-2 headline and the header tags are new.
- `photos/*_hdr.jpg`: header photos, already cropped to 990x640 with the black fade (hdr.py makes them).
- `assets/`: Adtaxi logo, ring graphics and the platform illustrations.
- The story auto-fits two pages (9pt, then 8.6pt, then 8.2pt) before it uses a third.
