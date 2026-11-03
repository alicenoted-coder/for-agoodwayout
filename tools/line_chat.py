"""Parse a LINE chat-history export (.txt) into structured messages."""
import re

DATE_RE = re.compile(r"^(\d{4})\.(\d{2})\.(\d{2}) 星期.$")
MSG_RE = re.compile(r"^(\d{2}):(\d{2}) (.+)$")
SYSTEM_RE = re.compile(r"^(.+?)(加入聊天|已收回訊息|已刪除名字)$")
MEDIA = {"圖片", "貼圖", "影片", "照片", "檔案", "語音訊息"}
BOT_SENDERS = {"Auto-reply", "Spam Filter"}


def parse(path):
    """Return a list of messages: {date, time, sender, type, text[, event]}.

    type is "text", "media" or "system"; lines without a timestamp are
    continuations of the previous message.
    """
    msgs, date, cur = [], None, None
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            m = DATE_RE.match(line)
            if m:
                date = "-".join(m.groups())
                cur = None
                continue
            m = MSG_RE.match(line)
            if m and date:
                time, rest = f"{m.group(1)}:{m.group(2)}", m.group(3)
                sm = SYSTEM_RE.match(rest)
                if sm and " " not in sm.group(1):
                    cur = {"date": date, "time": time, "sender": sm.group(1),
                           "type": "system", "event": sm.group(2), "text": ""}
                else:
                    sender, _, text = rest.partition(" ")
                    kind = "media" if text.strip() in MEDIA else "text"
                    cur = {"date": date, "time": time, "sender": sender,
                           "type": kind, "text": text}
                msgs.append(cur)
            elif cur is not None and cur["type"] != "system":
                cur["text"] += "\n" + line
    return msgs


def member_messages(msgs):
    """Messages written by members: no system events, no LINE bots."""
    return [m for m in msgs
            if m["type"] != "system" and m["sender"] not in BOT_SENDERS]
