import re, struct

with open(r'd:\AI3DViewMMD\Models\Vcreate_mmd.pmx', 'rb') as f:
    data = f.read()

enc = 'utf-16-le'

# UTF-16LE extensions to search
extensions = {
    b'\x2e\x00\x70\x00\x6e\x00\x67\x00': '.png',
    b'\x2e\x00\x73\x00\x70\x00\x68\x00': '.sph',
    b'\x2e\x00\x73\x00\x70\x00\x61\x00': '.spa',
    b'\x2e\x00\x62\x00\x6d\x00\x70\x00': '.bmp',
    b'\x2e\x00\x6a\x00\x70\x00\x67\x00': '.jpg',
    b'\x2e\x00\x74\x00\x67\x00\x61\x00': '.tga',
}

print('=== All file references in PMX (UTF-16LE) ===')
found_files = set()
for ext_bytes, ext_str in extensions.items():
    for m in re.finditer(re.escape(ext_bytes), data, re.IGNORECASE):
        start = max(0, m.start() - 200)
        chunk = data[start:m.end()]
        try:
            decoded = chunk.decode('utf-16-le', errors='ignore')
            # Find the last slash or null to trim prefix
            idx = max(decoded.rfind('/'), decoded.rfind('\\'), decoded.rfind('\x00'))
            filename = decoded[idx+1:] if idx >= 0 else decoded
            filename = filename.strip('\x00').strip()
            if filename:
                found_files.add(filename)
        except:
            pass

for f in sorted(found_files):
    print(f'  {f}')

print()

# Check for .sph references specifically
has_sph = any('.sph' in f.lower() or '.spa' in f.lower() for f in found_files)
print(f'Has sphere map (.sph/.spa) references: {has_sph}')

# Check the lighting setup issue: look for specPow > 50 in the data
# PMX material: diff(16) spec RGB(12) specPow(4) amb(12) -> specPow is at offset 28 after diffuse
# We can scan for float sequences that look like specular settings
print('\n=== Checking script.js for relevant settings ===')
with open(r'd:\AI3DViewMMD\script.js', 'r', encoding='utf-8') as f:
    script = f.read()

# Check renderer settings
for line in script.split('\n'):
    line = line.strip()
    if any(k in line for k in ['metalness', 'roughness', 'envMap', 'outputColorSpace', 'toneMapping', 'emissive']):
        print(f'  JS: {line}')
