import struct, os

path = r'd:\AI3DViewMMD\Models\textures\Vcreate_mmd.pmx'
with open(path, 'rb') as f:
    data = f.read()

import os
print(f'File size: {os.path.getsize(path):,} bytes')

magic = data[:4]
version = struct.unpack_from('<f', data, 4)[0]
globals_count = data[8]
text_encoding = data[9]
enc = 'utf-16-le' if text_encoding == 0 else 'utf-8'

print(f'Magic: {magic}')
print(f'Version: {version}')
print(f'Encoding: {"UTF-16LE" if text_encoding==0 else "UTF-8"}')

pos = 9 + globals_count

def read_text(pos):
    ln = struct.unpack_from('<i', data, pos)[0]
    pos += 4
    txt = data[pos:pos+ln].decode(enc, errors='replace')
    return txt, pos+ln

name_jp, pos = read_text(pos)
name_en, pos = read_text(pos)
comment_jp, pos = read_text(pos)
comment_en, pos = read_text(pos)
print(f'Model name JP : {name_jp}')
print(f'Model name EN : {name_en}')

vertex_count = struct.unpack_from('<i', data, pos)[0]
print(f'Vertex count  : {vertex_count:,}')
pos += 4

# Skip vertices (size per vertex varies)
# Just confirm face count further
print('PMX parse OK up to vertex count!')
