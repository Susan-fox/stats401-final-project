#!/usr/bin/env bash
# Download the 12 monthly BTS On-Time Performance files for 2024.
# Already-downloaded months are skipped.
set -euo pipefail
YEAR="${1:-2024}"
DEST="$(dirname "$0")/../data/raw"
mkdir -p "$DEST"; cd "$DEST"
BASE="https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present"
for m in $(seq 1 12); do
  f="On_Time_Reporting_Carrier_On_Time_Performance_1987_present_${YEAR}_${m}.zip"
  [ -f "$f" ] || wget --no-check-certificate -c "${BASE}_${YEAR}_${m}.zip"
done
unzip -o '*.zip'
rm -f readme.html
echo "unzipped into $DEST"
