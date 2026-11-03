"""Regenerate the file table in INDEX.md.

Exports live next to INDEX.md: the project root if it has an INDEX.md,
otherwise chat-exports/. Exports that don't follow the naming rule yet
(e.g. LINE's default "[LINE]出走女子大群.txt") are renamed to
agoodwayout_YYYY-MM-DD.txt using the file's modified date. Each file's
date range and message count are filled in; the hand-written 用途／產出
column of existing rows is kept.

Usage: python3 tools/update_index.py
"""
import datetime
import re
from pathlib import Path

from line_chat import member_messages, parse

ROOT = Path(__file__).resolve().parent.parent
EXPORTS = ROOT if (ROOT / "INDEX.md").exists() else ROOT / "chat-exports"
INDEX = EXPORTS / "INDEX.md"
NAME_RE = re.compile(r"^agoodwayout_\d{4}-\d{2}-\d{2}\.txt$")
START, END = "<!-- INDEX:START -->", "<!-- INDEX:END -->"
HEADER = ("| 檔名 | 訊息起 | 訊息迄 | 涵蓋天數 | 成員訊息數 | 比上一份新增 | 用途／產出 |\n"
          "|---|---|---|---:|---:|---|---|")


def existing_notes(table):
    """Map file name -> 用途／產出 cell from the current table."""
    notes = {}
    for line in table.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 7 and cells[0].startswith("`"):
            notes[cells[0].strip("`")] = cells[6]
    return notes


def rename_new_exports():
    """Give exports that still have LINE's default name a dated name."""
    for path in sorted(EXPORTS.glob("*.txt")):
        if NAME_RE.match(path.name) or not parse(path):
            continue
        day = datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()
        target = EXPORTS / f"agoodwayout_{day}.txt"
        if target.exists():
            print(f"沒有改名（{target.name} 已經存在）：{path.name}")
            continue
        path.rename(target)
        print(f"已改名：{path.name} → {target.name}")


def main():
    rename_new_exports()
    text = INDEX.read_text(encoding="utf-8")
    before, rest = text.split(START, 1)
    table, after = rest.split(END, 1)
    notes = existing_notes(table)

    files = []
    for path in sorted(EXPORTS.glob("*.txt")):
        msgs = parse(path)
        if not msgs:
            print(f"略過（讀不到訊息）：{path.name}")
            continue
        files.append((msgs[0]["date"], msgs[-1]["date"], path.name,
                      len(member_messages(msgs))))
    files.sort(key=lambda f: (f[1], f[2]))

    rows, prev = [], None
    for first, last, name, count in files:
        days = (datetime.date.fromisoformat(last)
                - datetime.date.fromisoformat(first)).days + 1
        if prev is None:
            added = "（第一份）"
        elif last <= prev[1]:
            added = "無新內容"
        else:
            start = (datetime.date.fromisoformat(prev[1])
                     + datetime.timedelta(days=1)).isoformat()
            added = f"{start} ~ {last}"
        if prev is not None and first > prev[0]:
            added += " ⚠️ 開頭比上一份晚，手機裡的舊記錄可能不見了"
            print(f"注意：{name} 的開頭日期 {first} 比上一份的 {prev[0]} 晚")
        rows.append(f"| `{name}` | {first} | {last} | {days} | {count:,} | "
                    f"{added} | {notes.get(name, '')} |")
        prev = (first, last)

    INDEX.write_text(f"{before}{START}\n{HEADER}\n" + "\n".join(rows)
                     + f"\n{END}{after}", encoding="utf-8")
    print(f"已更新 {INDEX.relative_to(ROOT)}，共 {len(rows)} 份檔案")


if __name__ == "__main__":
    main()
