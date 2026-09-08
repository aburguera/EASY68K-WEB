# Documentation

Two PDF documents, both built from LaTeX sources checked into this
directory:

- **`user_manual.pdf`** — what each button, panel, and window does, plus
  the warnings about the virtual file system (nothing here ever links to
  your real disk).
- **`trap15_reference.pdf`** — the full, task-by-task TRAP #15 reference:
  every task number, every register/parameter with its explicit size
  (`.B`/`.W`/`.L`), fully documented.

Both are also available inside the running application itself (the
**Help** button), and that in-app content is the actual source of truth:
`sections/*.tex` and `trap15_body.tex` are **generated**, not hand-written
— `extract_docs_content.py` pulls them directly out of
`src/web/gui_shell.html`'s own Help tabs, so this documentation can never
silently drift from what the application actually says.

## Regenerating the PDFs

If the in-app Help content changes, regenerate and recompile:

```bash
cd docs
python3 extract_docs_content.py      # refreshes sections/*.tex and trap15_body.tex
xelatex user_manual.tex && xelatex user_manual.tex        # run twice (TOC/references)
xelatex trap15_reference.tex && xelatex trap15_reference.tex
```

Requires a TeX distribution with `xelatex` (TeX Live or MacTeX; the
`fontspec`, `tcolorbox`, `overpic`, and `longtable` packages are used).

Never hand-edit `sections/*.tex` or `trap15_body.tex` directly — edit the
Help content in `gui_shell.html` instead, then re-run the extraction
script, or the next regeneration will silently overwrite your changes.

## Screenshots

`images/*.png` are real screenshots of the running application (captured
via headless Chrome), not mockups. If the UI changes enough to make one
misleading, retake it rather than editing the PNG by hand.
