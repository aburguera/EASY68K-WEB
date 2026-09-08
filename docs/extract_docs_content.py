#!/usr/bin/env python3
"""Regenerates docs/sections/*.tex and docs/trap15_body.tex directly from
src/web/gui_shell.html's own in-app Help content (the User Guide and TRAP
#15 Reference tabs), so the PDFs this content feeds into (user_manual.pdf,
trap15_reference.pdf) can never silently drift from what the application
itself already says and has been verified to say. Never hand-edit the
generated files in sections/ or trap15_body.tex directly - edit the
in-app Help content in gui_shell.html, re-run this script, then
recompile the PDFs (see README.md in this directory).

Usage: python3 extract_docs_content.py   (run from inside docs/)
"""
import re
import html as htmlmod
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(ROOT, '..', 'src', 'web', 'gui_shell.html')
SECTIONS_DIR = os.path.join(ROOT, 'sections')
TRAP15_OUT = os.path.join(ROOT, 'trap15_body.tex')

with open(SHELL, encoding='utf-8') as f:
    shell = f.read()

def extract_div(marker_id):
    """Pulls out the full content of the <div id="marker_id" ...> ... </div>
    that starts the in-app Help tab, up to the MATCHING close - both Help
    tabs contain their own nested <div>s (.info-line, .usage-note,
    .usage-warn), so this has to track nesting depth rather than just
    grabbing the next "</div>" (which used to stop at the first nested
    div's own close, silently truncating almost everything)."""
    start = shell.index(f'id="{marker_id}"')
    open_tag_end = shell.index('>', start) + 1
    depth = 1
    pos = open_tag_end
    tag_re = re.compile(r'<(/?)div\b[^>]*>')
    for m in tag_re.finditer(shell, open_tag_end):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return shell[open_tag_end:m.start()]
    raise RuntimeError(f"no matching </div> found for id={marker_id}")

# ---------------------------------------------------------------------
# TRAP #15 reference -> docs/trap15_body.tex
# ---------------------------------------------------------------------
def latex_escape(s):
    s = s.replace('\\', r'\textbackslash{}')
    repl = {
        '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_',
        '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}', '^': r'\textasciicircum{}',
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    return s

def clean(s):
    s = re.sub(r'</?(code|b|i)>', '', s.strip())
    return htmlmod.unescape(s)

def escape_with_links(s):
    """Like latex_escape, but turns an already-unescaped <a href="URL">text</a>
    (left intact by clean()) into \\href{URL}{text} instead of leaking raw
    HTML into the LaTeX source. Links are stashed behind a placeholder before
    latex_escape runs (it would otherwise mangle the URL/tag punctuation),
    then spliced back in afterwards."""
    links = []
    def stash(m):
        links.append((m.group(1), m.group(2)))
        return f'@@LINK{len(links) - 1}@@'
    s = re.sub(r'<a\s+href="([^"]*)"[^>]*>(.*?)</a>', stash, s, flags=re.S)
    result = latex_escape(s)
    for i, (url, text) in enumerate(links):
        result = result.replace(f'@@LINK{i}@@', r'\href{' + url + '}{' + latex_escape(text) + '}')
    return result

def build_trap15():
    src = extract_div('tab-trap15ref')
    section_re = re.compile(r'<div class="section-title"[^>]*>(.*?)</div>(.*?)(?=<div class="section-title"|\Z)', re.S)
    row_re = re.compile(r'<tr><td class="task">(.*?)</td><td class="params">(.*?)</td><td class="desc">(.*?)</td></tr>')
    infoline_re = re.compile(r'<div class="info-line"[^>]*>(.*?)</div>')

    events = []
    for sec_title, sec_body in section_re.findall(src):
        events.append(('SECTION', clean(sec_title)))
        for tok in re.split(r'(<div class="info-line"[^>]*>.*?</div>)', sec_body, flags=re.S):
            note_m = infoline_re.match(tok)
            if note_m:
                events.append(('NOTE', clean(note_m.group(1))))
            else:
                for task, params, desc in row_re.findall(tok):
                    events.append(('ROW', clean(task), clean(params), clean(desc)))

    HEADER = [
        r"\begin{longtable}{@{}p{1.7cm}p{5.2cm}p{7.3cm}@{}}",
        r"\toprule", r"\textbf{Task} & \textbf{Parameters} & \textbf{Action} \\", r"\midrule",
        r"\endfirsthead",
        r"\toprule", r"\textbf{Task} & \textbf{Parameters} & \textbf{Action} \\", r"\midrule",
        r"\endhead",
    ]
    FOOTER = [r"\bottomrule", r"\end{longtable}"]

    lines, table_open = [], False
    def close_table():
        nonlocal table_open
        if table_open:
            lines.extend(FOOTER)
            table_open = False

    for ev in events:
        if ev[0] == 'SECTION':
            close_table()
            lines.append(f"\\subsection*{{{latex_escape(ev[1])}}}")
        elif ev[0] == 'NOTE':
            close_table()
            lines.append(r"\par\noindent\textit{" + escape_with_links(ev[1]) + "}\\par\\medskip")
        elif ev[0] == 'ROW':
            if not table_open:
                lines.extend(HEADER)
                table_open = True
            lines.append(f"\\ttfamily {latex_escape(ev[1])} & {latex_escape(ev[2])} & {latex_escape(ev[3])} \\\\")
    close_table()

    with open(TRAP15_OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f"wrote {TRAP15_OUT} ({sum(1 for e in events if e[0]=='ROW')} tasks, {sum(1 for e in events if e[0]=='SECTION')} sections)")

# ---------------------------------------------------------------------
# User Guide -> docs/sections/*.tex (one file per <h3>)
# ---------------------------------------------------------------------
EMOJI_REPLACEMENTS = {'\U0001F5D1 ': '', '\U0001F319': '(moon)', '☀️': '(sun)', '☀': '(sun)', '\U0001F512': '(lock)'}

def inline(s):
    # Stash <a href="URL">text</a> links behind a placeholder first - the
    # tag_re loop below only knows about b/code/i/br, and a raw href
    # would otherwise get mangled by latex_escape along with everything else.
    links = []
    def stash(m):
        links.append((m.group(1), m.group(2)))
        return f'@@LINK{len(links) - 1}@@'
    s = re.sub(r'<a\s+href="([^"]*)"[^>]*>(.*?)</a>', stash, s, flags=re.S)

    out, pos = [], 0
    tag_re = re.compile(r'<(/?)(b|code|i|br\s*/?)>')
    for m in tag_re.finditer(s):
        out.append(latex_escape(htmlmod.unescape(s[pos:m.start()])))
        closing, tag = m.group(1), m.group(2).rstrip('/').strip()
        if tag == 'br':
            out.append(r'\par ')
        elif tag == 'b':
            out.append('}' if closing else r'\textbf{')
        elif tag == 'code':
            out.append('}' if closing else r'\texttt{')
        elif tag == 'i':
            out.append('}' if closing else r'\textit{')
        pos = m.end()
    out.append(latex_escape(htmlmod.unescape(s[pos:])))
    result = ''.join(out)
    for k, v in EMOJI_REPLACEMENTS.items():
        result = result.replace(k, v)
    for i, (url, text) in enumerate(links):
        result = result.replace(f'@@LINK{i}@@', r'\href{' + url + '}{' + latex_escape(htmlmod.unescape(text)) + '}')
    return result

def slugify(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')

def build_user_guide():
    os.makedirs(SECTIONS_DIR, exist_ok=True)
    for old in os.listdir(SECTIONS_DIR):
        if old.endswith('.tex'):
            os.remove(os.path.join(SECTIONS_DIR, old))

    src = extract_div('tab-userguide')
    parts = re.split(r'<h3>(.*?)</h3>', src, flags=re.S)
    token_re = re.compile(
        r'(<p>.*?</p>|<ul>.*?</ul>|<table.*?</table>|<div class="usage-note">.*?</div></div>|<div class="usage-warn">.*?</div></div>)',
        re.S)
    written = 0
    for i in range(1, len(parts), 2):
        title = inline(parts[i])
        slug = slugify(re.sub(r'<[^>]+>', '', parts[i]))
        lines = [f"\\subsection*{{{title}}}"]
        for tok in token_re.findall(parts[i+1]):
            if tok.startswith('<p>'):
                lines.append(inline(tok[3:-4]))
                lines.append('')
            elif tok.startswith('<ul>'):
                lines.append(r'\begin{itemize}')
                for li in re.findall(r'<li>(.*?)</li>', tok, re.S):
                    lines.append(r'\item ' + inline(li))
                lines.append(r'\end{itemize}')
            elif tok.startswith('<table'):
                rows = re.findall(r'<tr>(.*?)</tr>', tok, re.S)
                lines.append(r'\begin{longtable}{@{}p{3.0cm}p{3.4cm}p{7.8cm}@{}}')
                lines.append(r'\toprule')
                lines.append(r'\textbf{Group} & \textbf{Button} & \textbf{Does} \\')
                lines.append(r'\midrule')
                lines.append(r'\endfirsthead')
                lines.append(r'\toprule')
                lines.append(r'\textbf{Group} & \textbf{Button} & \textbf{Does} \\')
                lines.append(r'\midrule')
                lines.append(r'\endhead')
                for row in rows:
                    if row.strip().startswith('<th'):
                        continue
                    cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)
                    if len(cells) == 3:
                        group, button, does = cells
                        lines.append(f"{inline(group)} & {inline(button)} & {inline(does)} \\\\")
                    elif len(cells) == 2:
                        button, does = cells
                        lines.append(f" & {inline(button)} & {inline(does)} \\\\")
                lines.append(r'\bottomrule')
                lines.append(r'\end{longtable}')
            elif 'usage-note' in tok:
                inner = re.search(r'<div class="usage-note"><span>.*?</span><div>(.*?)</div></div>', tok, re.S)
                lines.append(r'\begin{tcolorbox}[colback=blue!5!white,colframe=blue!60!black,title=Note]')
                lines.append(inline(inner.group(1)) if inner else '')
                lines.append(r'\end{tcolorbox}')
            elif 'usage-warn' in tok:
                inner = re.search(r'<div class="usage-warn"><span>.*?</span><div>\s*(.*?)</div></div>', tok, re.S)
                lines.append(r'\begin{tcolorbox}[colback=red!5!white,colframe=red!60!black,title=Warning]')
                lines.append(inline(inner.group(1)) if inner else '')
                lines.append(r'\end{tcolorbox}')
        with open(f'{SECTIONS_DIR}/{slug}.tex', 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        written += 1
    print(f"wrote {written} section files to {SECTIONS_DIR}/")

if __name__ == '__main__':
    build_trap15()
    build_user_guide()
    print("Done. Now recompile: xelatex user_manual.tex (x2) && xelatex trap15_reference.tex (x2)")
