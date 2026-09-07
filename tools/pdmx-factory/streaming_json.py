"""Standard-library JSON path iterator; retains at most one selected value.

Non-selected objects/arrays are walked without materializing them. Selected
values use Python's JSON decoder, preserving its float/int semantics exactly.
"""

import gzip
import json


class JsonReader:
    def __init__(self, stream):
        self.stream = stream
        self.buffer = ""
        self.position = 0
        self.eof = False
        self.decoder = json.JSONDecoder()

    def fill(self):
        self.buffer = self.buffer[self.position:]
        self.position = 0
        chunk = self.stream.read(65536)
        self.eof = not chunk
        self.buffer += chunk

    def peek(self):
        while True:
            while self.position < len(self.buffer):
                ch = self.buffer[self.position]
                if not ch.isspace():
                    return ch
                self.position += 1
            if self.eof:
                return ""
            self.fill()

    def take(self, expected):
        if self.peek() != expected:
            raise ValueError(f"Expected JSON token {expected!r}")
        self.position += 1

    def value(self):
        self.peek()
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.position)
                # Numbers may end exactly at a read boundary; obtain delimiter.
                if end == len(self.buffer) and not self.eof:
                    self.fill()
                    continue
                if end < len(self.buffer) and self.buffer[end] not in ' \t\r\n,]}:':
                    # raw_decode can accept a numeric prefix of a split exponent.
                    if self.eof:
                        raise ValueError('Invalid JSON value delimiter')
                    self.fill()
                    continue
                self.position = end
                return value
            except json.JSONDecodeError:
                if self.eof:
                    raise
                self.fill()

    def walk(self, path):
        if not path:
            self.take("[")
            if self.peek() != "]":
                while True:
                    yield self.value()
                    if self.peek() == "]":
                        break
                    self.take(",")
            self.take("]")
            return
        self.take("{")
        found = False
        if self.peek() != "}":
            while True:
                key = self.value()
                self.take(":")
                if key == path[0]:
                    found = True
                    yield from self.walk(path[1:])
                else:
                    self.skip()
                if self.peek() == "}":
                    break
                self.take(",")
        self.take("}")
        if not found:
            raise ValueError(f"Missing canonical JSON path: {path[0]}")

    def skip(self):
        ch = self.peek()
        if ch in ("{", "["):
            end = "}" if ch == "{" else "]"
            self.take(ch)
            if self.peek() != end:
                while True:
                    if ch == "{":
                        self.value()
                        self.take(":")
                    self.skip()
                    if self.peek() == end:
                        break
                    self.take(",")
            self.take(end)
        else:
            self.value()


def canonical_scopes(path):
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        reader = JsonReader(stream)
        yield from reader.walk(("sourceAlignment", "scopes"))
        if reader.peek():
            raise ValueError("Trailing content in canonical JSON")
