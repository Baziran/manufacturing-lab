#!/bin/sh
set -eu
source_file=$1
wal_name=$2
target=/wal-archive/$wal_name.gz
if [ -f "$target" ]; then
    gzip -dc "$target" > "$target.verify"
    cmp -s "$source_file" "$target.verify"
    rm "$target.verify"
else
    # PostgreSQL serializes archive_command. A crash leaves only a temporary file.
    gzip -c "$source_file" > "$target.tmp"
    sync "$target.tmp"
    mv "$target.tmp" "$target"
    sync /wal-archive
fi
