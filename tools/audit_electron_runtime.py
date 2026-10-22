#!/usr/bin/env python3
"""Review exact pinned upstream runtime constants; never weaken the raw scanner."""
import argparse
import getpass
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

PINNED_SHA256 = "790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b"
PATH_BYTES = re.compile(rb'''(?:[a-z]:[\\/]+(?:users|documents and settings)[\\/]+|/(?:home|Users)/)[^\s"'<>|]+''', re.I)
PATH_TEXT = re.compile(r'''(?:[a-z]:[\\/]+(?:users|documents and settings)[\\/]+|/(?:home|Users)/)[^\s"'<>|]+''', re.I)
SECRET = re.compile(rb"(?:\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bglpat-[A-Za-z0-9_-]{20,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{20,}|\b(?:sk|rk)_live_[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,})")
CREDENTIAL = re.compile(rb'''["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret|secret[_-]?access[_-]?key)["']?\s*[:=]\s*(["'])([^\r\n"']{8,})\1''', re.I)
PLACEHOLDER = re.compile(rb"^(?:\$\{|<|your[_ -]|example|sample|placeholder|change[_ -]?me|replace[_ -]?me|not[_ -]a[_ -]secret|undefined|null|false|true)", re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def contained(root, value):
    lexical = Path(__import__("os").path.abspath(root / value))
    if not lexical.is_relative_to(root):
        raise ValueError("input-outside-project")
    current = root
    for component in lexical.relative_to(root).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError("symlink-input-not-allowed")
    target = lexical.resolve()
    if not target.is_relative_to(root):
        raise ValueError("input-outside-project")
    return target


def sections(data):
    if data[:2] != b"MZ" or len(data) < 64:
        raise ValueError("invalid-pe")
    pe = struct.unpack_from("<I", data, 60)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("invalid-pe")
    count, optional = struct.unpack_from("<H", data, pe + 6)[0], struct.unpack_from("<H", data, pe + 20)[0]
    table = pe + 24 + optional
    result = {}
    for index in range(count):
        entry = table + index * 40
        if entry + 40 > len(data):
            raise ValueError("invalid-pe-section")
        name = data[entry:entry + 8].rstrip(b"\0").decode("ascii")
        virtual_size, virtual_address, size, offset = struct.unpack_from("<IIII", data, entry + 8)
        if name in result or offset + size > len(data):
            raise ValueError("invalid-pe-section")
        result[name] = {"sha256": digest(data[offset:offset + size]), "rawSize": size,
                        "virtualSize": virtual_size, "virtualAddress": virtual_address}
    return result


def path_constants(data):
    found = [("utf8", match.start(), match[0]) for match in PATH_BYTES.finditer(data)]
    # Both byte phases are necessary: a resource/overlay string need not start
    # at an even file offset. Preserve exact bytes, including lone surrogates.
    step, overlap = 2 * 1024 * 1024, 16384
    seen = set()
    for phase in (0, 1):
        for start in range(phase, len(data), step):
            begin = max(phase, start - overlap)
            chunk = data[begin:min(len(data), start + step)]
            chunk = chunk[:len(chunk) // 2 * 2]
            text = chunk.decode("utf-16le", errors="surrogatepass")
            for match in PATH_TEXT.finditer(text):
                offset = begin + match.start() * 2
                value = match[0].encode("utf-16le", errors="surrogatepass")
                key = (offset, value)
                if key not in seen:
                    found.append(("utf16le", offset, value))
                    seen.add(key)
    return found


def private_content(data, username):
    def sensitive(value):
        return SECRET.search(value) or any(not PLACEHOLDER.search(match[2]) for match in CREDENTIAL.finditer(value))
    if sensitive(data):
        return True
    # UTF-16 token strings need the same protection as UTF-8.
    for phase in (0, 1):
        for start in range(phase, len(data), 2 * 1024 * 1024):
            chunk = data[max(phase, start - 16384):start + 2 * 1024 * 1024]
            text = chunk[:len(chunk) // 2 * 2].decode("utf-16le", errors="surrogatepass")
            if sensitive(text.encode("utf8", errors="replace")):
                return True
    if username and username.lower() not in {"root", "user", "runner", "system", "admin", "administrator"}:
        return any(username.encode(encoding) in data for encoding in ("utf8", "utf-16le"))
    return False


def safe_filename(value, username):
    value = value.replace(username, "[redacted]") if username else value
    return SECRET.sub(b"[redacted]", value.encode("utf8")).decode("utf8")


def verify_decoded_asar(archive, directory):
    data = archive.read_bytes()
    header_size = struct.unpack_from("<I", data, 4)[0]
    json_size = struct.unpack_from("<I", data, 12)[0]
    header = json.loads(data[16:16 + json_size])
    base = 8 + header_size
    files = []

    def visit(entries, prefix=""):
        for name, entry in entries.items():
            relative = f"{prefix}/{name}".lstrip("/")
            if "files" in entry:
                visit(entry["files"], relative)
            elif "link" in entry or entry.get("unpacked"):
                raise ValueError("unsupported-asar-entry")
            else:
                target = contained(directory, relative)
                offset, size = base + int(entry["offset"]), int(entry["size"])
                if offset + size > len(data) or target.is_symlink() or digest(target.read_bytes()) != digest(data[offset:offset + size]):
                    raise ValueError("decoded-asar-mismatch")
                files.append(relative)

    visit(header["files"])
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()}
    if actual != set(files):
        raise ValueError("decoded-asar-file-set-mismatch")
    return len(files)


def audit_runtime(root, release_dir, electron_zip, scan_report, *, expected_digest=PINNED_SHA256,
                  username=None, decoded_asar_dir=None):
    """Fixture API may supply a digest; the public CLI never exposes that override."""
    root = Path(root).resolve()
    release, archive, report_file = [contained(root, item) for item in (release_dir, electron_zip, scan_report)]
    archive_hash = digest(archive.read_bytes())
    if archive_hash != expected_digest:
        raise ValueError("electron-zip-digest-mismatch")
    raw = json.loads(report_file.read_text(encoding="utf8"))
    username = getpass.getuser() if username is None else username
    result = {"schemaVersion": 1, "electronVersion": "44.4.3", "electronZipSha256": archive_hash,
              "rawFindingCount": len(raw["findings"]), "reviewedUpstreamConstants": 0,
              "matchedConstantCount": 0, "unresolved": 0, "reviews": [], "vendorFiles": [],
              "nonResourceSections": [], "archiveWarnings": [], "unresolvedDetails": [],
              "peVerificationScope": "Non-resource sections are hash-identical. PE headers, resources and overlay are not claimed byte-identical; path constants and private content are checked independently.",
              "policy": "Only exact pinned upstream constants are reviewed. Raw findings remain recorded; secrets and new paths are never exempted."}

    def unresolved(file, reason):
        result["unresolved"] += 1
        result["unresolvedDetails"].append({"file": safe_filename(file, username), "reason": reason})

    approved = set()
    with zipfile.ZipFile(archive) as vendor:
        names = set(vendor.namelist())
        for target in sorted(release.rglob("*")):
            if target.is_symlink():
                unresolved(target.relative_to(release).as_posix(), "symlink-not-reviewed")
                continue
            if not target.is_file():
                continue
            relative = target.relative_to(release).as_posix()
            if target.suffix.lower() == ".exe":
                baseline, actual = vendor.read("electron.exe"), target.read_bytes()
                left, right = sections(baseline), sections(actual)
                sections_match = set(left) == set(right) and all(left[name] == right[name] for name in left if name != ".rsrc")
                result["nonResourceSections"] = [{"name": name, **right[name]} for name in right if name != ".rsrc"]
                constants = path_constants(actual)
                result["matchedConstantCount"] += len(constants)
                constants_match = bool(constants) and all(value in baseline for _, _, value in constants)
                valid = sections_match and constants_match
                valid = valid and not private_content(actual, username)
                result["reviews"].append({"file": safe_filename(relative, username), "rule": "absolute-user-path", "matchedConstantCount": len(constants),
                    "constantHashes": sorted({digest(value) for _, _, value in constants}), "nonResourceSectionsMatch": sections_match,
                    "allMatchedConstantsExactUpstream": constants_match})
                if valid:
                    approved.add(target.resolve())
                else:
                    unresolved(relative, "modified-executable-or-unreviewed-private-content")
            elif relative in names:
                actual, baseline = target.read_bytes(), vendor.read(relative)
                valid = digest(actual) == digest(baseline)
                result["vendorFiles"].append({"file": safe_filename(relative, username), "sha256": digest(actual), "exactUpstreamBytes": valid})
                if not valid:
                    unresolved(relative, "vendor-file-not-byte-identical")
                if relative == "LICENSES.chromium.html":
                    constants = path_constants(actual)
                    result["matchedConstantCount"] += len(constants)
                    valid = valid and bool(constants) and all(value in baseline for _, _, value in constants) and not private_content(actual, username)
                    if valid:
                        approved.add(target.resolve())
                    else:
                        unresolved(relative, "license-constant-or-content-not-reviewed")
            elif relative == "LICENSE.project.txt":
                actual_hash = digest(target.read_bytes())
                valid = actual_hash == digest(contained(root, "LICENSE").read_bytes())
                result["authoredLicense"] = {"file": relative, "sha256": actual_hash, "matchesProjectLicense": valid}
                if not valid:
                    unresolved(relative, "authored-license-does-not-match-project-source")
            elif target.suffix.lower() in {".dll", ".pak"} or target.name.upper().startswith("LICENSE"):
                unresolved(relative, "unknown-vendor-file-not-allowlisted")
        for finding in raw["findings"]:
            target = None
            try:
                target = contained(root, finding["path"])
                reviewed = finding["rule"] == "absolute-user-path" and target in approved
            except (ValueError, KeyError):
                reviewed = False
            result["reviewedUpstreamConstants"] += int(reviewed)
            if not reviewed:
                label = target.relative_to(release).as_posix() if target is not None and target.is_relative_to(release) else "[outside-release]"
                unresolved(label, "raw-finding-not-exact-approved-upstream-path-rule")
        for warning in raw.get("warnings", []):
            target = contained(root, warning["path"])
            relative = target.relative_to(release).as_posix()
            if target.suffix.lower() == ".pak" and relative in names and digest(target.read_bytes()) == digest(vendor.read(relative)):
                coverage = "exact-pinned-upstream-bytes-not-decoded"
            elif relative == "resources/app.asar" and decoded_asar_dir:
                decoded = contained(root, decoded_asar_dir)
                count = verify_decoded_asar(target, decoded)
                command = ["node", str(root / "tools/check-public.mjs"), "--root", str(root), "--release-dir", str(decoded), "--json"]
                scan = subprocess.run(command, capture_output=True, text=True, encoding="utf8", check=False)
                decoded_scan = json.loads(scan.stdout)
                if scan.returncode or decoded_scan["findings"] or decoded_scan["warnings"]:
                    raise ValueError("decoded-asar-privacy-check-failed")
                coverage = "all-asar-files-hash-verified-and-decoded-privacy-scan-clean"
                result["decodedAsarFiles"] = count
                result["asarSha256"] = digest(target.read_bytes())
            else:
                coverage = "unresolved"
                unresolved(relative, "archive-warning-without-verified-coverage")
            result["archiveWarnings"].append({"file": safe_filename(relative, username), "rule": warning["rule"], "coverage": coverage})
    result["status"] = "reviewed-upstream-only" if result["unresolved"] == 0 else "unresolved"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "dir", "electron-zip", "scan-report", "out"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--decoded-asar-dir")
    args = parser.parse_args()
    try:
        result = audit_runtime(args.root, args.dir, args.electron_zip, args.scan_report,
                               decoded_asar_dir=args.decoded_asar_dir)
        root = Path(args.root).resolve()
        output = contained(root, args.out)
        if output.relative_to(root).parts[0] not in {"artifacts", ".local"} or output.suffix != ".json":
            raise ValueError("unsafe-report-output")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
        print(json.dumps({key: result[key] for key in ("rawFindingCount", "reviewedUpstreamConstants", "matchedConstantCount", "unresolved", "status")}))
        return 1 if result["unresolved"] else 0
    except Exception:
        print("Runtime provenance audit failed; no sensitive input values are reported.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
