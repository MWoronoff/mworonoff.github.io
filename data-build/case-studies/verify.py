"""Every word of the original must appear in the rebuild (same counts). Prints words missing or added."""
import re, subprocess, sys
from collections import Counter
def words(pdf):
    t = subprocess.run(['pdftotext', pdf, '-'], capture_output=True, text=True).stdout
    t = t.replace('­', '').replace('-\n', '-').replace('’', "'").replace('‘', "'").replace('“','"').replace('”','"')
    return Counter(w.lower() for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9'%.$,+-]*[A-Za-z0-9%]|[A-Za-z0-9]", t))
o, n = words(sys.argv[1]), words(sys.argv[2])
miss = o - n; add = n - o
print('missing from rebuild:', dict(miss) or 'none'); print('added in rebuild:', dict(add) or 'none')
