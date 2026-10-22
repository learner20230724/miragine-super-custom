#!/usr/bin/env python3
"""Create a deterministic, clean portable ZIP without changing the build.

Every encountered entry is checked for symlinks/Windows reparse points BEFORE
exclusion. Real userdata/ and .tmp/ directories are skipped without traversing
their contents. Other private/cache/log directories fail closed. Outputs are
exclusively created: the ZIP, <ZIP>.inventory.json, and sibling SHA256SUMS.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile


TOP = "MiragineSuper/"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
EXCLUDED = {"userdata", ".tmp"}
PRIVATE = {
    "cache", "caches", "logs", "log", "private", "private-data", "private_data",
    "private-files", "private_files", "user-data", "user_data", "temp", "tmp",
    "node_modules", "artifacts", "output", "outputs", "dist", "recovered", "reference",
}
ROOT_DIRECTORIES = {"locales", "resources", "config", "docs", "ui-helper", "licenses"}
ROOT_FILES = {
    "miraginesuper.exe", "chrome_crashpad_handler.exe", "license", "license.project.txt", "licenses.chromium.html",
    "notice.txt", "readme.md", "readme.en.md", "start-game.cmd", "build-info.json", "version",
    "chrome_100_percent.pak", "chrome_200_percent.pak", "resources.pak", "icudtl.dat",
    "snapshot_blob.bin", "v8_context_snapshot.bin", "vk_swiftshader_icd.json",
    "d3dcompiler_47.dll", "ffmpeg.dll", "libegl.dll", "libglesv2.dll", "vk_swiftshader.dll",
    "vulkan-1.dll", "dxcompiler.dll", "dxil.dll",
}
SEMVER = re.compile(r"\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?", re.I)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def is_reparse(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def file_inventory(root: Path) -> tuple[list[tuple[str, Path]], list[str]]:
    files, excluded, names = [], [], set()

    def walk(directory: Path, parts: tuple[str, ...] = ()) -> None:
        for entry in sorted(directory.iterdir(), key=lambda item: item.name):
            relative_parts = (*parts, entry.name)
            relative = "/".join(relative_parts)
            info = entry.lstat()
            require(not is_reparse(info), f"Symlink/reparse point rejected: {relative}")
            folded = entry.name.casefold()
            require(entry.name not in (".", "..") and not any(c in entry.name for c in "\\:\r\n\x00"), f"Unsafe filename: {relative}")
            require(relative.casefold() not in names, f"Case-colliding archive path: {relative}")
            names.add(relative.casefold())
            if stat.S_ISDIR(info.st_mode):
                if folded in EXCLUDED:
                    excluded.append(relative)
                    continue  # Deliberately never inspect private excluded contents.
                require(not folded.startswith(".") and folded not in PRIVATE, f"Private/cache directory rejected: {relative}")
                if not parts:
                    require(folded in ROOT_DIRECTORIES, f"Unexpected portable directory: {relative}")
                walk(entry, relative_parts)
            else:
                require(stat.S_ISREG(info.st_mode), f"Nonregular file rejected: {relative}")
                require(not folded.startswith("."), f"Private dotfile rejected: {relative}")
                require(not re.search(r"(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens|id_rsa|id_ed25519)(?:[._-]|$)", folded), f"Private file rejected: {relative}")
                require(entry.suffix.casefold() not in {".log", ".pem", ".key", ".pfx", ".p12", ".swf", ".swc"}, f"Nonrelease file rejected: {relative}")
                if not parts:
                    require(folded in ROOT_FILES, f"Unexpected portable file: {relative}")
                files.append((relative, entry))

    walk(root)
    return sorted(files), sorted(excluded)


def validate_build_info(root: Path, files: list[tuple[str, Path]]) -> dict:
    available = {name for name, _ in files}
    for required in ("build-info.json", "MiragineSuper.exe", "resources/app.asar", "LICENSE", "config/custom.json", "ui-helper/original-graphics.js"):
        require(required in available, f"Missing portable file: {required}")
    info = json.loads((root / "build-info.json").read_text(encoding="utf-8"))
    require(isinstance(info, dict), "build-info.json must be an object")
    require(isinstance(info.get("version"), str) and SEMVER.fullmatch(info["version"]) is not None, "Invalid build-info version")
    require(isinstance(info.get("sourceCommit"), str) and re.fullmatch(r"[a-f0-9]{40}", info["sourceCommit"], re.I) is not None, "Invalid build-info sourceCommit")
    require(info.get("platform") == "win32" and info.get("arch") in {"x64", "arm64", "ia32"}, "Invalid Windows build platform/architecture")
    require(isinstance(info.get("electronVersion"), str) and SEMVER.fullmatch(info["electronVersion"]) is not None, "Invalid Electron version")
    return {key: info[key] for key in ("version", "sourceCommit", "platform", "arch", "electronVersion")}


def zip_info(name: str, *, directory: bool = False, size: int = 0) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_TIME)
    info.create_system = 3
    info.external_attr = ((stat.S_IFDIR | 0o755) if directory else (stat.S_IFREG | 0o644)) << 16
    if directory:
        info.external_attr |= 0x10
    info.compress_type = zipfile.ZIP_STORED if directory else zipfile.ZIP_DEFLATED
    info.file_size = size
    # Public property in Python >= 3.13; compatible fallback for older stdlib.
    if hasattr(info, "compress_level"):
        info.compress_level = 9
    else:
        info._compresslevel = 9
    return info


def create_archive(directory: Path, output: Path) -> dict:
    original = directory.absolute()
    require(not is_reparse(original.lstat()) and original.is_dir(), "Build root must be a real directory, not a symlink/junction")
    root = original.resolve(strict=True)
    destination = output.parent.resolve() / output.name
    require(destination.suffix.casefold() == ".zip", "Output filename must end in .zip")
    require(not destination.is_relative_to(root), "Output must be outside the original build")
    require(not any(c in destination.name for c in "\\:\r\n\x00"), "Unsafe output filename")
    inventory_file = destination.with_name(destination.name + ".inventory.json")
    checksums_file = destination.parent / "SHA256SUMS"
    for file in (destination, inventory_file, checksums_file):
        require(not os.path.lexists(file), f"Refusing to overwrite existing output: {file.name}")
    files, excluded = file_inventory(root)
    build_info = validate_build_info(root, files)
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = []
    records = []
    try:
        with destination.open("xb") as archive_stream:
            created.append(destination)
            with zipfile.ZipFile(archive_stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                archive.writestr(zip_info(TOP, directory=True), b"")
                for name, source in files:
                    before = source.lstat()
                    require(not is_reparse(before) and stat.S_ISREG(before.st_mode), f"Source type changed: {name}")
                    digest, count = hashlib.sha256(), 0
                    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
                    with os.fdopen(os.open(source, flags), "rb") as original_stream:
                        with archive.open(zip_info(TOP + name, size=before.st_size), "w") as target:
                            while chunk := original_stream.read(1024 * 1024):
                                digest.update(chunk)
                                count += len(chunk)
                                target.write(chunk)
                    after = source.lstat()
                    require(not is_reparse(after) and before.st_size == count == after.st_size and before.st_mtime_ns == after.st_mtime_ns, f"Source changed during archival: {name}")
                    records.append({"path": TOP + name, "bytes": count, "sha256": digest.hexdigest()})
        with destination.open("rb") as archive_stream:
            archive_hash = hashlib.file_digest(archive_stream, "sha256").hexdigest()
        inventory = {
            "schemaVersion": 1, **build_info, "archive": destination.name,
            "archiveRoot": TOP, "fileCount": len(records), "originalBytes": sum(record["bytes"] for record in records),
            "zipBytes": destination.stat().st_size, "sha256": archive_hash,
            "metadataTimestamp": "1980-01-01T00:00:00", "compression": "deflate-9",
            "exclusionPolicy": "Check encountered entry for symlink/reparse first; skip real userdata/.tmp directories without traversal; reject other private directories",
            "excludedDirectories": excluded, "files": records,
        }
        inventory_bytes = (json.dumps(inventory, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        with inventory_file.open("xb") as stream:
            created.append(inventory_file)
            stream.write(inventory_bytes)
        sums = f"{archive_hash}  {destination.name}\n{hashlib.sha256(inventory_bytes).hexdigest()}  {inventory_file.name}\n"
        with checksums_file.open("x", encoding="utf-8", newline="\n") as stream:
            created.append(checksums_file)
            stream.write(sums)
        return inventory
    except BaseException:
        # Only remove this invocation's newly created outputs, never build files.
        for file in reversed(created):
            file.unlink()
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, type=Path, help="Built portable directory (read-only input)")
    parser.add_argument("--out", required=True, type=Path, help="New ZIP outside the build; sidecars must not exist")
    args = parser.parse_args()
    try:
        inventory = create_archive(args.dir, args.out)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        message = error.strerror if isinstance(error, OSError) else str(error)
        parser.exit(1, f"Archive rejected: {message}\n")
    print(json.dumps({key: inventory[key] for key in ("archive", "version", "sourceCommit", "fileCount", "originalBytes", "zipBytes", "sha256")}, sort_keys=True))


if __name__ == "__main__":
    main()
